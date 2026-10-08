'use client'

import { Fragment, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Trash2, ChevronDown, ChevronRight, ChevronLeft, FileCheck } from 'lucide-react'
import { usePaginatedList } from '@/lib/usePaginatedList'
import { VARIEDAD_LABELS } from '@/lib/api/parcelas'
import { getCosechas, DESTINO_LABELS, type DestinoCosecha, type RegistroCosechaResponse } from '@/lib/api/cosecha'
import {
  getRemitos, createRemito, cargarComprobanteBodega, getCompradores, getLotesPasa,
  TIPO_REMITO_LABELS, errorDetail,
  type Remito, type TipoRemito,
} from '@/lib/api/altaProduccion'
import { useCampanaAnio } from '@/store/contextStore'
import FormError from '@/components/ui/FormError'

const PAGE_SIZE = 10
const KG_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fmtKg = (n: number) => KG_FMT.format(n)
const fmtFecha = (iso: string) => iso.split('-').reverse().join('/')
const TODAY = new Date().toISOString().split('T')[0]

const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
const selectFiltroCls = 'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'
const thCls = 'text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide'
const thRCls = thCls.replace('text-left', 'text-right')
const btnPrimary = 'px-4 py-2 bg-[#7a1f2c] text-white rounded-lg text-sm font-semibold hover:bg-[#5a1320] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
const btnSecondary = 'px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors'

const TIPO_BADGE: Record<TipoRemito, string> = {
  entrega_pasa: 'bg-amber-100 text-amber-700',
  salida_fresco: 'bg-green-100 text-green-700',
  salida_bodega: 'bg-blue-100 text-blue-700',
}

const decimalOk = (v: string) => /^\d+([.,]\d{1,2})?$/.test(v.trim()) && Number(v.replace(',', '.')) > 0

export default function RemitosPage() {
  const qc = useQueryClient()
  const [tipo, setTipo] = useState<'' | TipoRemito>('')
  const [showNuevo, setShowNuevo] = useState(false)
  const [abiertoId, setAbiertoId] = useState<string | null>(null)
  const [comprobanteDe, setComprobanteDe] = useState<Remito | null>(null)

  const { data: remitos = [], isLoading, error: loadError } = useQuery({
    queryKey: ['ap-remitos', tipo],
    queryFn: () => getRemitos({ tipo: tipo || undefined }),
    staleTime: 30_000,
  })
  const { data: compradores = [] } = useQuery({ queryKey: ['ap-compradores'], queryFn: () => getCompradores(), staleTime: 60_000 })
  const nombreComprador = (id: string) => compradores.find((c) => c.id === id)?.nombre ?? '–'
  const { page, setPage, totalPages, paged } = usePaginatedList(remitos, PAGE_SIZE)

  const refrescar = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['ap-remitos'] }),
    qc.invalidateQueries({ queryKey: ['ap-lotes'] }),
    qc.invalidateQueries({ queryKey: ['ap-cosechas-remito'] }),
  ])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Remitos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Entregas de pasa, salidas de fresco y salidas a bodega (solo kilos)</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={tipo} onChange={(e) => setTipo(e.target.value as '' | TipoRemito)} className={selectFiltroCls}>
            <option value="">Todos los tipos</option>
            <option value="entrega_pasa">Pasa (PAS)</option>
            <option value="salida_fresco">Fresco (FRE)</option>
            <option value="salida_bodega">Bodega (BOD)</option>
          </select>
          <button
            onClick={() => setShowNuevo(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#7a1f2c] text-white text-sm font-semibold rounded-lg hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={16} /> Nuevo remito
          </button>
        </div>
      </div>

      {loadError && <FormError description={errorDetail(loadError, 'No se pudo cargar el listado')} />}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Remitos emitidos</h3>
          <span className="text-xs text-gray-400">{remitos.length} registros</span>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : remitos.length === 0 ? (
          <p className="px-5 py-10 text-center text-gray-400 text-sm">No hay remitos para mostrar</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls} />
                  <th className={thCls}>Fecha</th>
                  <th className={thCls}>Tipo</th>
                  <th className={thCls}>N°</th>
                  <th className={thCls}>Comprador</th>
                  <th className={thCls}>Patente</th>
                  <th className={thRCls}>Kg total</th>
                  <th className={thCls}>Comprobante INV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paged.map((r) => {
                  const abierto = abiertoId === r.id
                  return (
                    <Fragment key={r.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-2 py-2.5">
                          <button onClick={() => setAbiertoId(abierto ? null : r.id)} className="p-1 text-gray-400 hover:text-gray-700" title="Ver líneas">
                            {abierto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtFecha(r.fecha)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${TIPO_BADGE[r.tipo]}`}>
                            {TIPO_REMITO_LABELS[r.tipo]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-gray-900">{r.numero}</td>
                        <td className="px-4 py-2.5 text-gray-700">{nombreComprador(r.comprador_id)}</td>
                        <td className="px-4 py-2.5 text-gray-500">{r.vehiculo_patente ?? '–'}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-gray-900">{fmtKg(r.kg_total)}</td>
                        <td className="px-4 py-2.5">
                          {r.tipo !== 'salida_bodega' ? (
                            <span className="text-gray-300">–</span>
                          ) : r.comprobante_bodega ? (
                            <span className={`text-xs font-mono ${r.comprobante_bodega.diferencia_kg < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                              SUV {r.comprobante_bodega.numero_suv} · dif. {fmtKg(r.comprobante_bodega.diferencia_kg)} kg
                            </span>
                          ) : (
                            <button
                              onClick={() => setComprobanteDe(r)}
                              className="flex items-center gap-1 text-xs font-medium text-[#7a1f2c] hover:underline"
                            >
                              <FileCheck size={13} /> Cargar comprobante
                            </button>
                          )}
                        </td>
                      </tr>
                      {abierto && (
                        <tr className="bg-gray-50">
                          <td />
                          <td colSpan={7} className="px-4 py-3">
                            <ul className="text-xs text-gray-600 space-y-1">
                              {r.lineas.map((l) => (
                                <li key={l.id}>
                                  {l.lote_label ?? l.cosecha_label ?? `${l.lote_id ? 'Lote' : 'Cosecha'} ${(l.lote_id ?? l.cosecha_id ?? '').slice(0, 8)}`}
                                  {' · '}<b className="font-mono">{fmtKg(l.kg)} kg</b>
                                </li>
                              ))}
                            </ul>
                            {r.comprobante_bodega && (
                              <p className="text-xs text-gray-600 mt-2">
                                Comprobante SUV {r.comprobante_bodega.numero_suv}: recibidos <b>{fmtKg(r.comprobante_bodega.kg_recibidos)} kg</b>
                                {' · '}diferencia <b className={r.comprobante_bodega.diferencia_kg < 0 ? 'text-red-600' : ''}>{fmtKg(r.comprobante_bodega.diferencia_kg)} kg</b>
                                {r.comprobante_bodega.fecha ? ` · ${fmtFecha(r.comprobante_bodega.fecha)}` : ''}
                              </p>
                            )}
                            {r.observaciones && <p className="text-xs text-gray-500 mt-1">{r.observaciones}</p>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && totalPages > 1 && (
          <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="text-xs text-gray-500">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, remitos.length)} de {remitos.length}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {showNuevo && (
        <NuevoRemitoModal
          compradores={compradores.filter((c) => c.is_active)}
          onClose={() => setShowNuevo(false)}
          onCreated={async () => { await refrescar(); setShowNuevo(false) }}
        />
      )}
      {comprobanteDe && (
        <ComprobanteModal
          remito={comprobanteDe}
          onClose={() => setComprobanteDe(null)}
          onSaved={async () => { await refrescar(); setComprobanteDe(null) }}
        />
      )}
    </div>
  )
}

// ── Nuevo remito ──────────────────────────────────────────────────────────────

type Linea = { fuente: string; kg: string }

function cosechaLabel(c: RegistroCosechaResponse): string {
  const origen = c.origen === 'tercero' ? (c.proveedor_tercero ?? 'Tercero') : (c.parcela_nombre ?? 'Sin parcela')
  return `${fmtFecha(c.fecha)} · ${origen} · ${c.variedad ?? 's/variedad'} · ${fmtKg(c.kg_total)} kg cosechados · saldo ${c.saldo_kg != null ? fmtKg(c.saldo_kg) : '–'} kg (${DESTINO_LABELS[c.destino]})`
}

function NuevoRemitoModal({
  compradores, onClose, onCreated,
}: {
  compradores: { id: string; nombre: string }[]
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [temporada] = useCampanaAnio()
  const [tipo, setTipo] = useState<TipoRemito>('entrega_pasa')
  const [fecha, setFecha] = useState(TODAY)
  const [compradorId, setCompradorId] = useState('')
  const [numero, setNumero] = useState('')
  const [patente, setPatente] = useState('')
  const [obs, setObs] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([{ fuente: '', kg: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const esPasa = tipo === 'entrega_pasa'

  const { data: lotes = [] } = useQuery({
    queryKey: ['ap-lotes', 'cerrados-con-saldo'],
    queryFn: () => getLotesPasa({ estado: 'cerrado', con_saldo: true }),
    enabled: esPasa,
  })
  const destinos: DestinoCosecha[] = tipo === 'salida_bodega' ? ['BODEGA'] : ['MI', 'EXPO']
  const { data: cosechas = [] } = useQuery({
    queryKey: ['ap-cosechas-remito', temporada, tipo],
    queryFn: async () => {
      const r = await Promise.all(destinos.map((d) => getCosechas({ temporada, destino: d, limit: 500 })))
      // Solo cosechas con saldo sin despachar (null = el backend no lo informa: se ofrece igual).
      return r.flat().filter((c) => c.saldo_kg == null || c.saldo_kg > 0).sort((a, b) => b.fecha.localeCompare(a.fecha))
    },
    enabled: !esPasa,
  })

  function cambiarTipo(t: TipoRemito) {
    setTipo(t)
    setLineas([{ fuente: '', kg: '' }]) // las fuentes son distintas según el tipo
  }
  const setLinea = (i: number, patch: Partial<Linea>) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const lineasValidas = lineas.every((l) => l.fuente && decimalOk(l.kg))
  const total = lineas.reduce((s, l) => s + (decimalOk(l.kg) ? Number(l.kg.replace(',', '.')) : 0), 0)

  // Líneas repetidas del mismo lote se suman en el backend: se avisa si excede el saldo.
  const pedidoPorLote = new Map<string, number>()
  if (esPasa) {
    for (const l of lineas) {
      if (l.fuente && decimalOk(l.kg)) {
        pedidoPorLote.set(l.fuente, (pedidoPorLote.get(l.fuente) ?? 0) + Number(l.kg.replace(',', '.')))
      }
    }
  }
  // Cosechas: se avisa pero se deja enviar (el backend responde 409 si corresponde).
  const pedidoPorCosecha = new Map<string, number>()
  if (!esPasa) {
    for (const l of lineas) {
      if (l.fuente && decimalOk(l.kg)) {
        pedidoPorCosecha.set(l.fuente, (pedidoPorCosecha.get(l.fuente) ?? 0) + Number(l.kg.replace(',', '.')))
      }
    }
  }
  const cosechasExcedidas = cosechas.filter(
    (c) => c.saldo_kg != null && (pedidoPorCosecha.get(c.id) ?? 0) > c.saldo_kg,
  )
  const excedidos = lotes.filter((l) => (pedidoPorLote.get(l.id) ?? 0) > l.saldo_kg)

  async function guardar() {
    setSaving(true)
    setError(null)
    try {
      await createRemito({
        tipo, fecha, comprador_id: compradorId,
        numero: numero.trim() || null,
        vehiculo_patente: patente.trim() || null,
        observaciones: obs.trim() || null,
        lineas: lineas.map((l) => ({
          kg: l.kg.trim().replace(',', '.'),
          ...(esPasa ? { lote_id: l.fuente } : { cosecha_id: l.fuente }),
        })),
      })
      await onCreated()
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Nuevo remito</h2>
          <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Tipo</label>
              <select value={tipo} onChange={(e) => cambiarTipo(e.target.value as TipoRemito)} className={inputCls}>
                {(Object.entries(TIPO_REMITO_LABELS) as [TipoRemito, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Fecha <span className="text-red-500">*</span></label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Comprador <span className="text-red-500">*</span></label>
              <select value={compradorId} onChange={(e) => setCompradorId(e.target.value)} className={inputCls}>
                <option value="">— Seleccionar —</option>
                {compradores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>N° de remito</label>
              <input type="text" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Vacío = correlativo automático" maxLength={50} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Patente del vehículo</label>
              <input type="text" value={patente} onChange={(e) => setPatente(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-700">
              {esPasa ? 'Líneas (lotes cerrados con saldo)' : `Líneas (cosechas con destino ${destinos.map((d) => DESTINO_LABELS[d]).join(' / ')})`}
            </p>
            {lineas.map((l, i) => (
              <div key={i} className="flex items-start gap-2">
                <select value={l.fuente} onChange={(e) => setLinea(i, { fuente: e.target.value })} className={`${inputCls.replace('w-full', '')} min-w-0 flex-1`}>
                  <option value="">— Seleccionar {esPasa ? 'lote' : 'cosecha'} —</option>
                  {esPasa
                    ? lotes.map((x) => (
                        <option key={x.id} value={x.id}>
                          {VARIEDAD_LABELS[x.variedad]} C{x.calidad} N° {x.numero} · saldo {fmtKg(x.saldo_kg)} kg
                        </option>
                      ))
                    : cosechas.map((c) => <option key={c.id} value={c.id}>{cosechaLabel(c)}</option>)}
                </select>
                <input
                  type="text" inputMode="decimal" placeholder="Kg" value={l.kg}
                  onChange={(e) => setLinea(i, { kg: e.target.value })}
                  className={`${inputCls.replace('w-full', '')} w-28 shrink-0`}
                />
                <button
                  onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                  disabled={lineas.length === 1}
                  title="Quitar línea"
                  className="p-2 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button onClick={() => setLineas((ls) => [...ls, { fuente: '', kg: '' }])} className="flex items-center gap-1 text-xs font-medium text-[#7a1f2c] hover:underline">
              <Plus size={13} /> Agregar línea
            </button>
            {esPasa && excedidos.map((l) => (
              <p key={l.id} className="text-xs text-red-600">
                El lote {VARIEDAD_LABELS[l.variedad]} C{l.calidad} N° {l.numero} tiene saldo {fmtKg(l.saldo_kg)} kg y estás pidiendo {fmtKg(pedidoPorLote.get(l.id) ?? 0)} kg (las líneas del mismo lote se suman).
              </p>
            ))}
            {cosechasExcedidas.map((c) => (
              <p key={c.id} className="text-xs text-amber-700">
                Atención: la cosecha del {fmtFecha(c.fecha)} ({c.variedad ?? 's/variedad'}) tiene saldo {fmtKg(c.saldo_kg ?? 0)} kg y estás pidiendo {fmtKg(pedidoPorCosecha.get(c.id) ?? 0)} kg.
              </p>
            ))}
            <p className="text-xs text-gray-600 text-right">Total: <b className="font-mono">{fmtKg(total)} kg</b></p>
          </div>

          <div>
            <label className={labelCls}>Observaciones</label>
            <textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} className={inputCls} />
          </div>
          {error && <FormError description={error} />}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={saving || !compradorId || !fecha || !lineasValidas || excedidos.length > 0} className={btnPrimary}>
            {saving ? 'Guardando...' : 'Emitir remito'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Comprobante de bodega ─────────────────────────────────────────────────────

function ComprobanteModal({
  remito, onClose, onSaved,
}: {
  remito: Remito
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [suv, setSuv] = useState('')
  const [kg, setKg] = useState('')
  const [fecha, setFecha] = useState(TODAY)
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dif = decimalOk(kg) ? Number(kg.replace(',', '.')) - remito.kg_total : null

  async function guardar() {
    setSaving(true)
    setError(null)
    try {
      await cargarComprobanteBodega(remito.id, {
        numero_suv: suv.trim(), kg_recibidos: kg.trim().replace(',', '.'),
        fecha: fecha || null, observaciones: obs.trim() || null,
      })
      await onSaved()
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Comprobante de bodega · remito {remito.numero}</h2>
          <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-500">Kg despachados en el remito: <b className="font-mono">{fmtKg(remito.kg_total)}</b>. Se carga una sola vez.</p>
          <div>
            <label className={labelCls}>N° SUV <span className="text-red-500">*</span></label>
            <input type="text" value={suv} onChange={(e) => setSuv(e.target.value)} maxLength={50} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Kg recibidos por la bodega <span className="text-red-500">*</span></label>
            <input type="text" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} className={inputCls} />
            {dif != null && (
              <p className={`text-xs mt-1 ${dif < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                Diferencia: {fmtKg(dif)} kg {dif < 0 ? '(la bodega recibió menos)' : ''}
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Fecha</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Observaciones</label>
            <textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} className={inputCls} />
          </div>
          {error && <FormError description={error} />}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={saving || !suv.trim() || !decimalOk(kg)} className={btnPrimary}>
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
