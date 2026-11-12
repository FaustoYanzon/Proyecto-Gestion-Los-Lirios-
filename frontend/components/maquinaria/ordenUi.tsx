import {
  ESTADO_ORDEN_LABELS,
  GRAVEDAD_FALLA_LABELS,
  type EstadoOrden,
  type GravedadFalla,
} from '@/lib/api/maquinaria'

// Shared presentational helpers of the Maquinaria orders screens.

const ESTADO_ORDEN_STYLES: Record<EstadoOrden, string> = {
  reportada: 'bg-red-50 text-red-700 border-red-200',
  diagnosticada: 'bg-amber-50 text-amber-700 border-amber-200',
  presupuesto_pendiente: 'bg-amber-50 text-amber-700 border-amber-200',
  presupuesto_aprobado: 'bg-sky-50 text-sky-700 border-sky-200',
  enviada_taller: 'bg-blue-50 text-blue-700 border-blue-200',
  en_reparacion: 'bg-blue-50 text-blue-700 border-blue-200',
  lista_retirar: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  pendiente_validacion: 'bg-purple-50 text-purple-700 border-purple-200',
  cerrada: 'bg-green-50 text-green-700 border-green-200',
  cancelada: 'bg-gray-100 text-gray-600 border-gray-200',
}

export function OrdenEstadoBadge({ estado }: { estado: EstadoOrden }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${ESTADO_ORDEN_STYLES[estado]}`}
    >
      {ESTADO_ORDEN_LABELS[estado]}
    </span>
  )
}

export function GravedadBadge({ gravedad }: { gravedad: GravedadFalla }) {
  const cls =
    gravedad === 'parada'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-amber-50 text-amber-700 border-amber-200'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${cls}`}
    >
      {GRAVEDAD_FALLA_LABELS[gravedad]}
    </span>
  )
}

const MS_DAY = 86_400_000

// Days an order has been open (closed/cancelled ones stop counting at their last update).
export function diasAbierta(createdAt: string, updatedAt: string, abierta: boolean): number {
  const end = abierta ? Date.now() : new Date(updatedAt).getTime()
  return Math.max(0, Math.floor((end - new Date(createdAt).getTime()) / MS_DAY))
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Plain dates (YYYY-MM-DD) are parsed as local to avoid a one-day shift.
export function fmtDate(isoDate: string): string {
  const d = isoDate.length === 10 ? new Date(`${isoDate}T00:00:00`) : new Date(isoDate)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export const inputCls =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
export const labelCls = 'block text-sm font-medium text-gray-700 mb-1'
export const errCls = 'mt-1 text-xs text-red-600'
export const btnPrimary =
  'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 disabled:cursor-not-allowed transition-colors'
export const btnSecondary =
  'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors'
export const btnDanger =
  'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors'
