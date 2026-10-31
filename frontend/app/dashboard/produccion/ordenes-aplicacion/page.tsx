'use client'

import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ClipboardList, Plus, X, Loader2, ChevronDown, ChevronRight, Check, Pencil, Trash2, Undo2 } from 'lucide-react'
import {
  getOrdenesAplicacion,
  eliminarOrdenExtra,
  getValvulasARevisar,
  deshacerValvula,
  type OrdenAplicacion,
  type OrdenAplicacionLinea,
  type EstadoOrdenAplicacion,
  type ValvulaARevisar,
  type OrdenAplicacionValvula,
} from '@/lib/api/ordenesAplicacion'
import { getParcelas, VARIEDAD_LABELS } from '@/lib/api/produccion'
import AplicacionesRealizadas from '@/components/produccion/AplicacionesRealizadas'
import ARevisarPanel, { A_REVISAR_QUERY_KEY, productosDe } from '@/components/produccion/ARevisarPanel'
import NuevaOrdenAplicacion, { apiErrorMessage } from '@/components/produccion/NuevaOrdenAplicacion'
import { MESES, formatNum } from '@/components/produccion/formato'
import { getAvance } from '@/lib/api/planFitosanitario'
import { hoyArgentina } from '@/lib/api/riego'
import { useCampanaAnio, buildCampanas, campanaToAnio } from '@/store/contextStore'
import { useAuthStore } from '@/store/authStore'

// aniosAdelante=1: permite cargar órdenes de la próxima campaña antes de
// que empiece.
const AVAILABLE_YEARS = buildCampanas(1).map(campanaToAnio)

const ESTADO_LABELS: Record<EstadoOrdenAplicacion, string> = {
  pendiente: 'Pendiente', en_curso: 'En curso', completada: 'Completada',
}
const ESTADO_STYLES: Record<EstadoOrdenAplicacion, string> = {
  pendiente: 'bg-amber-50 text-amber-700 border border-amber-200',
  en_curso: 'bg-blue-50 text-blue-700 border border-blue-200',
  completada: 'bg-green-50 text-green-700 border border-green-200',
}
const BAR_COLORS: Record<EstadoOrdenAplicacion, string> = {
  pendiente: 'bg-amber-400', en_curso: 'bg-blue-500', completada: 'bg-green-500',
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function Modal({
  title, onClose, children, wide = false,
}: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

// ── Tarjeta de orden ─────────────────────────────────────────────────────────

// Avance en unidades confirmables: cada válvula si la parcela las tiene, o la
// parcela entera (parcelas sin válvulas y órdenes anteriores al modelo).
function progresoOrden(orden: OrdenAplicacion) {
  let total = 0
  let hechas = 0
  for (const p of orden.parcelas) {
    const vs = p.valvulas ?? []
    if (vs.length === 0) {
      total += 1
      if (p.estado === 'aplicada') hechas += 1
    } else {
      total += vs.length
      hechas += vs.filter((v) => v.estado === 'aplicada').length
    }
  }
  return { total, hechas }
}

// Product lines of an order; orders served before the multi-product backend
// carry no `lineas`, so fall back to the single-product shim.
function lineasDe(orden: OrdenAplicacion): Pick<OrdenAplicacionLinea, 'insumo_id' | 'insumo_nombre' | 'insumo_unidad' | 'dosis_por_ha'>[] {
  if (orden.lineas?.length) return orden.lineas
  return [{
    insumo_id: orden.insumo_id,
    insumo_nombre: orden.insumo_nombre,
    insumo_unidad: orden.insumo_unidad,
    dosis_por_ha: orden.dosis_por_ha,
  }]
}

function variedadesTexto(orden: OrdenAplicacion): string {
  const variedades = orden.variedades?.length ? orden.variedades : [orden.variedad]
  return variedades.map((v) => VARIEDAD_LABELS[v] ?? v).join(', ')
}

function productosTexto(orden: OrdenAplicacion): string {
  return lineasDe(orden).map((l) => l.insumo_nombre).join(', ')
}

interface DeshacerTarget {
  ordenId: string
  ordenValvulaId: string
  valvulaNombre: string
  parcelaNombre: string
  // Every product of the valve: undoing reverts all of them together.
  productos: string[]
}

function OrdenCard({
  orden, puedeGestionar, onEditar, onEliminar, onDeshacer,
}: {
  orden: OrdenAplicacion
  puedeGestionar: boolean
  // Undefined when the user cannot undo (role below encargado).
  onDeshacer?: (orden: OrdenAplicacion, valvula: OrdenAplicacionValvula, parcelaNombre: string) => void
  onEditar: (orden: OrdenAplicacion) => void
  onEliminar: (orden: OrdenAplicacion) => void
}) {
  const [abierta, setAbierta] = useState(false)
  const { total, hechas: aplicadas } = progresoOrden(orden)
  const pct = total ? Math.round((100 * aplicadas) / total) : 0
  // Same rule as the backend (_get_orden_editable): any origin, while no
  // parcel or valve has been confirmed yet.
  const editable = puedeGestionar && aplicadas === 0

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setAbierta((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        {abierta ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900">{orden.objetivo}</span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-sm text-gray-600">{variedadesTexto(orden)}</span>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${ESTADO_STYLES[orden.estado]}`}>
              {ESTADO_LABELS[orden.estado]}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5" data-testid="productos-orden">
            {lineasDe(orden).map((l) => (
              <span
                key={l.insumo_id}
                className="inline-flex items-baseline gap-1 text-[11px] font-medium text-gray-700 bg-[#fbfaf6] border border-[#7a1f2c]/20 px-2 py-0.5 rounded-md"
              >
                {l.insumo_nombre}
                <span className="font-mono font-normal text-gray-500">
                  {formatNum(l.dosis_por_ha)} {l.insumo_unidad}/ha
                </span>
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">Planificada {orden.fecha_planificada}</p>
        </div>
        <div className="w-32 shrink-0">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>{aplicadas}/{total}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full ${BAR_COLORS[orden.estado]}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </button>

      {abierta && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3 mt-3">
            {orden.parcelas.map((p) => (
              <div key={p.id}>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md ${
                    p.estado === 'aplicada'
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-gray-50 text-gray-600 border border-gray-200'
                  }`}
                >
                  {p.estado === 'aplicada' && <Check size={11} />}
                  {p.parcela_nombre}
                  {(p.valvulas ?? []).length > 0 &&
                    ` · ${p.valvulas.filter((v) => v.estado === 'aplicada').length}/${p.valvulas.length}`}
                </span>
                {(p.valvulas ?? []).length > 0 && (
                  <ul className="mt-1.5 ml-2 space-y-1">
                    {p.valvulas.map((v) => (
                      <li key={v.id} className="text-xs text-gray-600">
                        <span className="font-medium text-gray-800">Válvula {v.valvula_nombre}</span>{' '}
                        {v.estado === 'pendiente' ? (
                          <span className="text-gray-400">pendiente</span>
                        ) : v.resultado === 'no_aplicada' ? (
                          <span className="text-red-600 font-medium">no aplicada</span>
                        ) : (
                          <span className="text-green-700">aplicada</span>
                        )}
                        {v.responsable && <span className="text-gray-500"> · {v.responsable}</span>}
                        {v.observaciones && <span className="italic text-gray-500"> · “{v.observaciones}”</span>}
                        {onDeshacer && v.estado !== 'pendiente' && (
                          <button
                            type="button"
                            aria-label={`Deshacer válvula ${v.valvula_nombre} de ${p.parcela_nombre}`}
                            onClick={() => onDeshacer(orden, v, p.parcela_nombre)}
                            className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium text-red-600 bg-white border border-red-200 rounded hover:bg-red-50 transition-colors"
                          >
                            <Undo2 size={11} />
                            Deshacer
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          {orden.notas && <p className="text-xs text-gray-500 mt-3">Notas: {orden.notas}</p>}
          {editable && (
            <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-gray-100">
              <button
                onClick={() => onEditar(orden)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                <Pencil size={13} />
                Editar
              </button>
              <button
                onClick={() => onEliminar(orden)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-md hover:bg-red-50 transition-colors"
              >
                <Trash2 size={13} />
                Eliminar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

// useSearchParams exige un Suspense arriba para el prerender estático.
export default function OrdenesAplicacionPage() {
  return (
    <Suspense>
      <OrdenesAplicacion />
    </Suspense>
  )
}

function OrdenesAplicacion() {
  const [temporada, setTemporada] = useCampanaAnio()

  const currentUser = useAuthStore((s) => s.user)
  const puedeCrear = currentUser
    ? ['super_admin', 'gerencial', 'encargado', 'regador'].includes(currentUser.role)
    : false

  // Pendientes = órdenes con alguna parcela sin confirmar (pendiente o en
  // curso). Aplicadas = historial de lo efectivamente aplicado, parcela por
  // parcela, con filtros de fecha (ex página "Fitosanitarios").
  const searchParams = useSearchParams()
  // Revisar lo no aplicado / observado es de encargado para arriba (mismo
  // criterio que el backend: el regador no ve esta pestaña).
  const puedeRevisar = currentUser
    ? ['super_admin', 'gerencial', 'encargado'].includes(currentUser.role)
    : false
  const vistaParam = searchParams.get('vista')
  const [vista, setVista] = useState<'pendientes' | 'aplicadas' | 'arevisar'>(
    vistaParam === 'aplicadas' ? 'aplicadas' : vistaParam === 'arevisar' && puedeRevisar ? 'arevisar' : 'pendientes',
  )
  const [repaso, setRepaso] = useState<ValvulaARevisar | null>(null)
  // Off by default and not persisted: completed orders only matter when undoing a valve.
  const [mostrarCompletadas, setMostrarCompletadas] = useState(false)
  const [nuevaAbierta, setNuevaAbierta] = useState(false)
  const [ordenEditar, setOrdenEditar] = useState<OrdenAplicacion | null>(null)
  const [ordenEliminar, setOrdenEliminar] = useState<OrdenAplicacion | null>(null)
  const [eliminando, setEliminando] = useState(false)
  const [eliminarError, setEliminarError] = useState<string | null>(null)
  // Shared by OrdenCard and the "A revisar" panel, so keep it a flat target.
  const [valvulaDeshacer, setValvulaDeshacer] = useState<DeshacerTarget | null>(null)
  const [deshaciendo, setDeshaciendo] = useState(false)
  const [deshacerError, setDeshacerError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  async function confirmarEliminar() {
    if (!ordenEliminar) return
    setEliminando(true)
    setEliminarError(null)
    try {
      await eliminarOrdenExtra(ordenEliminar.id)
      queryClient.invalidateQueries({ queryKey: ['ordenes-aplicacion', temporada] })
      setOrdenEliminar(null)
    } catch (e: unknown) {
      setEliminarError(apiErrorMessage(e, 'No se pudo eliminar la orden.'))
    } finally {
      setEliminando(false)
    }
  }

  function abrirDeshacer(target: DeshacerTarget) {
    setDeshacerError(null)
    setValvulaDeshacer(target)
  }

  async function confirmarDeshacer() {
    // Guard against double taps while the request is in flight.
    if (!valvulaDeshacer || deshaciendo) return
    setDeshaciendo(true)
    setDeshacerError(null)
    try {
      await deshacerValvula(valvulaDeshacer.ordenId, valvulaDeshacer.ordenValvulaId)
      queryClient.invalidateQueries({ queryKey: ['ordenes-aplicacion'] })
      queryClient.invalidateQueries({ queryKey: A_REVISAR_QUERY_KEY })
      // Stock and fito records changed too.
      queryClient.invalidateQueries({ queryKey: ['fitosanitarios'] })
      queryClient.invalidateQueries({ queryKey: ['fitosanitarios-alertas'] })
      queryClient.invalidateQueries({ queryKey: ['insumos'] })
      setValvulaDeshacer(null)
    } catch (e: unknown) {
      setDeshacerError(apiErrorMessage(e, 'No se pudo deshacer la válvula.'))
    } finally {
      setDeshaciendo(false)
    }
  }

  const { data: ordenes = [], isLoading } = useQuery({
    queryKey: ['ordenes-aplicacion', temporada],
    queryFn: () => getOrdenesAplicacion({ temporada }),
  })

  // Plan of the current month: products still missing, for the banner below.
  const hoy = hoyArgentina()
  const mesActual = Number(hoy.slice(5, 7))
  const temporadaActual = mesActual >= 5 ? Number(hoy.slice(0, 4)) : Number(hoy.slice(0, 4)) - 1
  const { data: avanceMes = [] } = useQuery({
    queryKey: ['plan-avance', temporadaActual, mesActual],
    queryFn: () => getAvance(temporadaActual, mesActual),
    staleTime: 60_000,
  })
  const faltantesPlan = avanceMes.filter((a) => a.estado === 'pendiente' || a.estado === 'bajo')
  const variedadesFaltantes = new Set(faltantesPlan.map((a) => a.variedad)).size

  const { data: aRevisar = [] } = useQuery({
    queryKey: A_REVISAR_QUERY_KEY,
    queryFn: getValvulasARevisar,
    enabled: puedeRevisar,
    staleTime: 30_000,
  })

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas'],
    queryFn: getParcelas,
    staleTime: 300_000,
  })

  const ordenesPendientes = useMemo(
    () => ordenes
      .filter((o) => o.estado !== 'completada')
      .sort((a, b) => a.fecha_planificada.localeCompare(b.fecha_planificada)),
    [ordenes],
  )

  // Completed orders are listed after the open ones so the pending work stays on top.
  const ordenesVisibles = useMemo(
    () => (mostrarCompletadas
      ? [
          ...ordenesPendientes,
          ...ordenes
            .filter((o) => o.estado === 'completada')
            .sort((a, b) => b.fecha_planificada.localeCompare(a.fecha_planificada)),
        ]
      : ordenesPendientes),
    [ordenes, ordenesPendientes, mostrarCompletadas],
  )

  const TABS: { value: 'pendientes' | 'aplicadas' | 'arevisar'; label: string }[] = [
    { value: 'pendientes', label: `Pendientes${ordenesPendientes.length ? ` (${ordenesPendientes.length})` : ''}` },
    { value: 'aplicadas', label: 'Aplicadas' },
    ...(puedeRevisar
      ? [{ value: 'arevisar' as const, label: `A revisar${aRevisar.length ? ` (${aRevisar.length})` : ''}` }]
      : []),
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-gray-700" />
            <h1 className="text-2xl font-semibold text-gray-900">Órdenes de Aplicación</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            El operario confirma en mobile qué aplicó y dónde -- producto, dosis y carencia ya vienen fijados acá
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={temporada}
            onChange={(e) => setTemporada(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>Campaña {y}/{y + 1}</option>)}
          </select>
          {puedeCrear && (
            <button
              onClick={() => setNuevaAbierta(true)}
              data-testid="nueva-orden"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
            >
              <Plus size={16} />
              Nueva orden
            </button>
          )}
        </div>
      </div>

      {faltantesPlan.length > 0 && (
        <div
          data-testid="banner-plan"
          className="flex items-center justify-between gap-3 flex-wrap rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            {MESES[mesActual - 1]}: faltan {faltantesPlan.length} {faltantesPlan.length === 1 ? 'producto' : 'productos'} del
            plan en {variedadesFaltantes} {variedadesFaltantes === 1 ? 'variedad' : 'variedades'}
          </span>
          <Link href="/dashboard/produccion/cumplimiento-fitosanitario" className="font-medium underline">
            Ver cumplimiento
          </Link>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setVista(t.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              vista === t.value
                ? 'bg-[#7a1f2c] text-white'
                : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {vista === 'arevisar' ? (
        <ARevisarPanel
          onCrearRepaso={setRepaso}
          onDeshacer={(v) => abrirDeshacer({
            ordenId: v.orden_id,
            ordenValvulaId: v.id,
            valvulaNombre: v.valvula_nombre,
            parcelaNombre: v.parcela_nombre,
            productos: productosDe(v).map((p) => p.insumo_nombre),
          })}
        />
      ) : vista === 'aplicadas' ? (
        <AplicacionesRealizadas temporada={temporada} />
      ) : (
      <div className="space-y-2">
        {puedeRevisar && (
          <label className="flex items-center gap-2 text-sm text-gray-600 w-fit cursor-pointer">
            <input
              type="checkbox"
              checked={mostrarCompletadas}
              onChange={(e) => setMostrarCompletadas(e.target.checked)}
              className="rounded border-gray-300"
            />
            Mostrar completadas
          </label>
        )}
        {isLoading ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
            Cargando…
          </div>
        ) : ordenesVisibles.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
            Sin órdenes pendientes para esta temporada.
          </div>
        ) : (
          ordenesVisibles.map((o) => (
            <OrdenCard
              key={o.id}
              orden={o}
              puedeGestionar={puedeCrear}
              onDeshacer={puedeRevisar
                ? (orden, valvula, parcelaNombre) => abrirDeshacer({
                    ordenId: orden.id,
                    ordenValvulaId: valvula.id,
                    valvulaNombre: valvula.valvula_nombre,
                    parcelaNombre,
                    productos: lineasDe(orden).map((l) => l.insumo_nombre),
                  })
                : undefined}
              onEditar={setOrdenEditar}
              onEliminar={(orden) => { setEliminarError(null); setOrdenEliminar(orden) }}
            />
          ))
        )}
      </div>
      )}

      {nuevaAbierta && (
        <Modal title="Nueva orden de aplicación" wide onClose={() => setNuevaAbierta(false)}>
          <NuevaOrdenAplicacion
            parcelas={parcelas}
            temporada={temporada}
            onSuccess={() => setNuevaAbierta(false)}
            onCancel={() => setNuevaAbierta(false)}
          />
        </Modal>
      )}

      {ordenEditar && (
        <Modal title="Editar orden" wide onClose={() => setOrdenEditar(null)}>
          <NuevaOrdenAplicacion
            parcelas={parcelas}
            temporada={ordenEditar.temporada}
            orden={ordenEditar}
            onSuccess={() => setOrdenEditar(null)}
            onCancel={() => setOrdenEditar(null)}
          />
        </Modal>
      )}

      {repaso && (
        <Modal title="Orden de repaso" wide onClose={() => setRepaso(null)}>
          <NuevaOrdenAplicacion
            parcelas={parcelas}
            temporada={temporada}
            repaso={repaso}
            onSuccess={() => setRepaso(null)}
            onCancel={() => setRepaso(null)}
          />
        </Modal>
      )}

      {ordenEliminar && (
        <Modal title="Eliminar orden" onClose={() => setOrdenEliminar(null)}>
          <p className="text-sm text-gray-700">
            ¿Eliminar la orden <strong>{ordenEliminar.objetivo}</strong> ({productosTexto(ordenEliminar)}) para{' '}
            {variedadesTexto(ordenEliminar)} ({ordenEliminar.parcelas.length}{' '}
            {ordenEliminar.parcelas.length === 1 ? 'parcela' : 'parcelas'})? También desaparece de la app de los operarios.
          </p>
          {eliminarError && <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{eliminarError}</p>}
          <div className="flex items-center justify-end gap-3 mt-5 pt-3 border-t border-gray-100">
            <button onClick={() => setOrdenEliminar(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button
              onClick={confirmarEliminar}
              disabled={eliminando}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-60 transition-colors"
            >
              {eliminando && <Loader2 size={14} className="animate-spin" />}
              Eliminar
            </button>
          </div>
        </Modal>
      )}

      {valvulaDeshacer && (
        <Modal title="Deshacer válvula" onClose={() => { if (!deshaciendo) setValvulaDeshacer(null) }}>
          <p className="text-sm text-gray-700">
            ¿Deshacer la confirmación de la válvula <strong>{valvulaDeshacer.valvulaNombre}</strong> de{' '}
            {valvulaDeshacer.parcelaNombre}?{' '}
            {valvulaDeshacer.productos.length > 1
              ? `Se revierten todos sus productos (${valvulaDeshacer.productos.join(', ')}): se devuelve el stock de cada uno y se borran sus registros fitosanitarios.`
              : `Se devuelve el stock de ${valvulaDeshacer.productos[0] ?? 'el insumo'} y se borra el registro fitosanitario.`}{' '}
            La válvula vuelve a quedar pendiente.
          </p>
          {deshacerError && <p className="mt-3 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{deshacerError}</p>}
          <div className="flex items-center justify-end gap-3 mt-5 pt-3 border-t border-gray-100">
            <button
              onClick={() => setValvulaDeshacer(null)}
              disabled={deshaciendo}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-60 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={confirmarDeshacer}
              disabled={deshaciendo}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-60 transition-colors"
            >
              {deshaciendo && <Loader2 size={14} className="animate-spin" />}
              Deshacer
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
