'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Plus, X, Loader2, ChevronDown, ChevronRight, Check } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  getOrdenesAplicacion,
  crearOrdenDesdePlan,
  crearOrdenExtra,
  type OrdenAplicacion,
  type EstadoOrdenAplicacion,
} from '@/lib/api/ordenesAplicacion'
import { getPlanFitosanitario, type PlanFitosanitario } from '@/lib/api/planFitosanitario'
import { getParcelas, VARIEDAD_LABELS, type ParcelaItem } from '@/lib/api/produccion'
import InsumoSelect from '@/components/produccion/InsumoSelect'
import type { InsumoResponse } from '@/lib/api/insumos'
import { useContextStore, campanaToAnio } from '@/store/contextStore'
import { useAuthStore } from '@/store/authStore'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const AVAILABLE_YEARS = [DEFAULT_YEAR - 1, DEFAULT_YEAR, DEFAULT_YEAR + 1]
const TODAY = now.toISOString().split('T')[0]

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err = 'mt-1 text-xs text-red-600'

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
const ORIGEN_LABELS: Record<string, string> = { plan: 'Del plan', extra: 'Fuera de plan' }

// ── Modal ─────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
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

// ── Selector de parcelas (toda la variedad, o restringido) ─────────────────────

function ParcelaPicker({
  parcelasVariedad, restringir, setRestringir, seleccionadas, setSeleccionadas,
}: {
  parcelasVariedad: ParcelaItem[]
  restringir: boolean
  setRestringir: (v: boolean) => void
  seleccionadas: string[]
  setSeleccionadas: (v: string[]) => void
}) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
        <input
          type="checkbox"
          checked={restringir}
          onChange={(e) => { setRestringir(e.target.checked); if (!e.target.checked) setSeleccionadas([]) }}
        />
        Restringir a parcelas específicas (si no, incluye toda la variedad)
      </label>
      {restringir && (
        <div className="grid grid-cols-2 gap-1.5 border border-gray-200 rounded-md p-3 max-h-40 overflow-y-auto">
          {parcelasVariedad.length === 0 && (
            <p className="col-span-2 text-xs text-gray-400">Sin parcelas activas para esta variedad.</p>
          )}
          {parcelasVariedad.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={seleccionadas.includes(p.id)}
                onChange={(e) => {
                  setSeleccionadas(
                    e.target.checked ? [...seleccionadas, p.id] : seleccionadas.filter((id) => id !== p.id),
                  )
                }}
              />
              {p.nombre}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Form: generar orden desde una línea del plan ────────────────────────────

const schemaDesdePlan = z.object({
  plan_fitosanitario_id: z.string().min(1, 'Elegí una línea del plan'),
  dias_carencia: z.coerce.number().int().min(0),
  dias_reingreso: z.coerce.number().int().min(0),
  fecha_planificada: z.string().min(1, 'Requerido'),
  notas: z.string().optional(),
})
type FormDesdePlan = z.infer<typeof schemaDesdePlan>

function FormOrdenDesdePlan({
  planes, parcelas, temporada, onSuccess, onCancel,
}: {
  planes: PlanFitosanitario[]
  parcelas: ParcelaItem[]
  temporada: number
  onSuccess: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [restringir, setRestringir] = useState(false)
  const [seleccionadas, setSeleccionadas] = useState<string[]>([])

  const {
    register, handleSubmit, watch, formState: { errors, isSubmitting },
  } = useForm<FormDesdePlan>({
    resolver: zodResolver(schemaDesdePlan) as Resolver<FormDesdePlan>,
    defaultValues: { dias_carencia: 7, dias_reingreso: 2, fecha_planificada: TODAY, notas: '' },
  })

  const planIdW = watch('plan_fitosanitario_id')
  const planElegido = planes.find((p) => p.id === planIdW)
  const parcelasVariedad = useMemo(
    () => (planElegido ? parcelas.filter((p) => p.is_active && p.variedad === planElegido.variedad) : []),
    [parcelas, planElegido],
  )

  async function onSubmit(data: FormDesdePlan) {
    try {
      setSubmitError(null)
      if (restringir && seleccionadas.length === 0) {
        setSubmitError('Elegí al menos una parcela, o desmarcá la restricción.')
        return
      }
      await crearOrdenDesdePlan({
        ...data,
        notas: data.notas || undefined,
        parcela_ids: restringir ? seleccionadas : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['ordenes-aplicacion', temporada] })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitError(typeof detail === 'string' ? detail : 'Error al generar la orden.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className={label}>Línea del plan</label>
        <select {...register('plan_fitosanitario_id')} className={field}>
          <option value="">Elegí una línea…</option>
          {planes.map((p) => (
            <option key={p.id} value={p.id}>
              {VARIEDAD_LABELS[p.variedad] ?? p.variedad} · Nº{p.numero_aplicacion} · {MESES[p.mes - 1]} · {p.insumo_nombre} ({p.dosis_por_ha} {p.insumo_unidad}/ha)
            </option>
          ))}
        </select>
        {errors.plan_fitosanitario_id && <p className={err}>{errors.plan_fitosanitario_id.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Días carencia</label>
          <input type="number" min="0" {...register('dias_carencia')} className={field} />
        </div>
        <div>
          <label className={label}>Días reingreso</label>
          <input type="number" min="0" {...register('dias_reingreso')} className={field} />
        </div>
      </div>

      <div>
        <label className={label}>Fecha planificada</label>
        <input type="date" {...register('fecha_planificada')} className={field} />
        {errors.fecha_planificada && <p className={err}>{errors.fecha_planificada.message}</p>}
      </div>

      {planElegido && (
        <ParcelaPicker
          parcelasVariedad={parcelasVariedad}
          restringir={restringir}
          setRestringir={setRestringir}
          seleccionadas={seleccionadas}
          setSeleccionadas={setSeleccionadas}
        />
      )}

      <div>
        <label className={label}>Notas (opcional)</label>
        <textarea rows={2} {...register('notas')} className={field} />
      </div>

      {submitError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{submitError}</p>}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 transition-colors">
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Generar orden
        </button>
      </div>
    </form>
  )
}

// ── Form: orden extra (fuera de plan) ───────────────────────────────────────

const schemaExtra = z.object({
  variedad: z.string().min(1, 'Requerido'),
  insumo_id: z.string().min(1, 'Elegí un insumo de la lista'),
  dosis_por_ha: z.coerce.number().positive('Debe ser mayor a 0'),
  objetivo: z.string().min(1, 'Requerido'),
  dias_carencia: z.coerce.number().int().min(0),
  dias_reingreso: z.coerce.number().int().min(0),
  fecha_planificada: z.string().min(1, 'Requerido'),
  notas: z.string().optional(),
})
type FormExtra = z.infer<typeof schemaExtra>

function FormOrdenExtra({
  parcelas, variedadesDisponibles, temporada, onSuccess, onCancel,
}: {
  parcelas: ParcelaItem[]
  variedadesDisponibles: string[]
  temporada: number
  onSuccess: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [insumoNombre, setInsumoNombre] = useState('')
  const [insumoInfo, setInsumoInfo] = useState<InsumoResponse | null>(null)
  const [restringir, setRestringir] = useState(false)
  const [seleccionadas, setSeleccionadas] = useState<string[]>([])

  const {
    register, handleSubmit, watch, setValue, formState: { errors, isSubmitting },
  } = useForm<FormExtra>({
    resolver: zodResolver(schemaExtra) as Resolver<FormExtra>,
    defaultValues: {
      variedad: variedadesDisponibles[0] ?? '',
      insumo_id: '', objetivo: '', dias_carencia: 7, dias_reingreso: 2,
      fecha_planificada: TODAY, notas: '',
    },
  })

  const variedadW = watch('variedad')
  const insumoIdW = watch('insumo_id')
  const parcelasVariedad = useMemo(
    () => parcelas.filter((p) => p.is_active && p.variedad === variedadW),
    [parcelas, variedadW],
  )

  async function onSubmit(data: FormExtra) {
    try {
      setSubmitError(null)
      if (restringir && seleccionadas.length === 0) {
        setSubmitError('Elegí al menos una parcela, o desmarcá la restricción.')
        return
      }
      await crearOrdenExtra({
        ...data,
        temporada,
        notas: data.notas || undefined,
        parcela_ids: restringir ? seleccionadas : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['ordenes-aplicacion', temporada] })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitError(typeof detail === 'string' ? detail : 'Error al crear la orden.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className={label}>Variedad</label>
        <select {...register('variedad')} className={field}>
          {variedadesDisponibles.map((v) => (
            <option key={v} value={v}>{VARIEDAD_LABELS[v] ?? v}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={label}>Producto</label>
        <InsumoSelect
          value={insumoNombre}
          insumoId={insumoIdW}
          onChange={(nombre, insumoId, insumo) => {
            setInsumoNombre(nombre)
            setInsumoInfo(insumo ?? null)
            setValue('insumo_id', insumoId ?? '', { shouldValidate: true })
          }}
          className={field}
          error={errors.insumo_id?.message}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Objetivo / Plaga</label>
          <input type="text" placeholder="Ej: Botritis" {...register('objetivo')} className={field} />
          {errors.objetivo && <p className={err}>{errors.objetivo.message}</p>}
        </div>
        <div>
          <label className={label}>Dosis {insumoInfo ? `(${insumoInfo.unidad}/ha)` : '/ha'}</label>
          <input type="number" step="0.01" min="0" placeholder="0.00" {...register('dosis_por_ha')} className={field} />
          {errors.dosis_por_ha && <p className={err}>{errors.dosis_por_ha.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Días carencia</label>
          <input type="number" min="0" {...register('dias_carencia')} className={field} />
        </div>
        <div>
          <label className={label}>Días reingreso</label>
          <input type="number" min="0" {...register('dias_reingreso')} className={field} />
        </div>
      </div>

      <div>
        <label className={label}>Fecha planificada</label>
        <input type="date" {...register('fecha_planificada')} className={field} />
        {errors.fecha_planificada && <p className={err}>{errors.fecha_planificada.message}</p>}
      </div>

      <ParcelaPicker
        parcelasVariedad={parcelasVariedad}
        restringir={restringir}
        setRestringir={setRestringir}
        seleccionadas={seleccionadas}
        setSeleccionadas={setSeleccionadas}
      />

      <div>
        <label className={label}>Notas (opcional)</label>
        <textarea rows={2} {...register('notas')} className={field} />
      </div>

      {submitError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{submitError}</p>}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 transition-colors">
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Crear orden
        </button>
      </div>
    </form>
  )
}

// ── Tarjeta de orden ─────────────────────────────────────────────────────────

function OrdenCard({ orden }: { orden: OrdenAplicacion }) {
  const [abierta, setAbierta] = useState(false)
  const total = orden.parcelas.length
  const aplicadas = orden.parcelas.filter((p) => p.estado === 'aplicada').length
  const pct = total ? Math.round((100 * aplicadas) / total) : 0

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setAbierta((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        {abierta ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900">{orden.insumo_nombre}</span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-sm text-gray-600">{VARIEDAD_LABELS[orden.variedad] ?? orden.variedad}</span>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${ESTADO_STYLES[orden.estado]}`}>
              {ESTADO_LABELS[orden.estado]}
            </span>
            <span className="text-[11px] font-medium text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200">
              {ORIGEN_LABELS[orden.origen] ?? orden.origen}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {orden.dosis_por_ha} {orden.insumo_unidad}/ha · {orden.objetivo} · Planificada {orden.fecha_planificada}
          </p>
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
          <div className="flex flex-wrap gap-2 mt-3">
            {orden.parcelas.map((p) => (
              <span
                key={p.id}
                className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md ${
                  p.estado === 'aplicada'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-gray-50 text-gray-600 border border-gray-200'
                }`}
              >
                {p.estado === 'aplicada' && <Check size={11} />}
                {p.parcela_nombre}
              </span>
            ))}
          </div>
          {orden.notas && <p className="text-xs text-gray-500 mt-3">Notas: {orden.notas}</p>}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OrdenesAplicacionPage() {
  const campanaGlobal = useContextStore((s) => s.campana)
  const [temporada, setTemporada] = useState(() => campanaToAnio(campanaGlobal))

  const [prevCampanaGlobal, setPrevCampanaGlobal] = useState(campanaGlobal)
  if (prevCampanaGlobal !== campanaGlobal) {
    setPrevCampanaGlobal(campanaGlobal)
    setTemporada(campanaToAnio(campanaGlobal))
  }

  const currentUser = useAuthStore((s) => s.user)
  const puedeCrear = currentUser
    ? ['super_admin', 'gerencial', 'encargado', 'regador'].includes(currentUser.role)
    : false

  const [estadoFiltro, setEstadoFiltro] = useState<EstadoOrdenAplicacion | 'todas'>('todas')
  const [modal, setModal] = useState<'desde-plan' | 'extra' | null>(null)

  const { data: ordenes = [], isLoading } = useQuery({
    queryKey: ['ordenes-aplicacion', temporada],
    queryFn: () => getOrdenesAplicacion({ temporada }),
  })

  const { data: planes = [] } = useQuery({
    queryKey: ['plan-fitosanitario', temporada],
    queryFn: () => getPlanFitosanitario(temporada),
  })

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas'],
    queryFn: getParcelas,
    staleTime: 300_000,
  })

  const variedadesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const p of parcelas) if (p.is_active && p.variedad) set.add(p.variedad)
    return Array.from(set).sort((a, b) => (VARIEDAD_LABELS[a] ?? a).localeCompare(VARIEDAD_LABELS[b] ?? b))
  }, [parcelas])

  const ordenesFiltradas = useMemo(
    () => (estadoFiltro === 'todas' ? ordenes : ordenes.filter((o) => o.estado === estadoFiltro))
      .sort((a, b) => b.fecha_planificada.localeCompare(a.fecha_planificada)),
    [ordenes, estadoFiltro],
  )

  const TABS: { value: EstadoOrdenAplicacion | 'todas'; label: string }[] = [
    { value: 'todas', label: 'Todas' },
    { value: 'pendiente', label: 'Pendientes' },
    { value: 'en_curso', label: 'En curso' },
    { value: 'completada', label: 'Completadas' },
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
        <div className="flex items-center gap-3">
          <select
            value={temporada}
            onChange={(e) => setTemporada(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>Campaña {y}/{y + 1}</option>)}
          </select>
          {puedeCrear && (
            <>
              <button
                onClick={() => setModal('desde-plan')}
                disabled={planes.length === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-40 transition-colors"
                title={planes.length === 0 ? 'No hay plan cargado para esta temporada' : undefined}
              >
                <Plus size={16} />
                Generar desde plan
              </button>
              <button
                onClick={() => setModal('extra')}
                disabled={variedadesDisponibles.length === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#7a1f2c] bg-white border border-[#7a1f2c] rounded-md hover:bg-[#fbfaf6] disabled:opacity-40 transition-colors"
              >
                <Plus size={16} />
                Orden extra
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setEstadoFiltro(t.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              estadoFiltro === t.value
                ? 'bg-[#7a1f2c] text-white'
                : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
            Cargando…
          </div>
        ) : ordenesFiltradas.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
            Sin órdenes {estadoFiltro !== 'todas' ? ESTADO_LABELS[estadoFiltro].toLowerCase() : ''} para esta temporada.
          </div>
        ) : (
          ordenesFiltradas.map((o) => <OrdenCard key={o.id} orden={o} />)
        )}
      </div>

      {modal === 'desde-plan' && (
        <Modal title="Generar orden desde el plan" onClose={() => setModal(null)}>
          <FormOrdenDesdePlan
            planes={planes}
            parcelas={parcelas}
            temporada={temporada}
            onSuccess={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}

      {modal === 'extra' && (
        <Modal title="Nueva orden fuera de plan" onClose={() => setModal(null)}>
          <FormOrdenExtra
            parcelas={parcelas}
            variedadesDisponibles={variedadesDisponibles}
            temporada={temporada}
            onSuccess={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  )
}
