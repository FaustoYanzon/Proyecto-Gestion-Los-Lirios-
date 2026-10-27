'use client'

import { CalendarDays } from 'lucide-react'
import type { RondaPendiente } from '@/lib/api/planFitosanitario'
import { VARIEDAD_LABELS } from '@/lib/api/produccion'

export const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

// Decimal fields may arrive as strings; always format through Number().
export function formatNum(value: number | string, maxDecimals = 3): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '–'
  return n.toLocaleString('es-AR', { maximumFractionDigits: maxDecimals })
}

// Stable identity for a card: the backend splits cards by round, objective and
// product/dose set, so the same triple never repeats.
export function rondaKey(r: RondaPendiente): string {
  const lineas = r.lineas.map((l) => `${l.insumo_id}:${Number(l.dosis_por_ha)}`).sort().join(',')
  return `${r.numero_aplicacion}|${r.objetivo}|${lineas}`
}

export default function RondaCard({
  ronda, selected = false, onSelect,
}: {
  ronda: RondaPendiente
  selected?: boolean
  onSelect: (ronda: RondaPendiente) => void
}) {
  const haTotal = ronda.variedades.reduce((acc, v) => acc + Number(v.ha_pendientes), 0)

  return (
    <button
      type="button"
      data-testid="ronda-card"
      onClick={() => onSelect(ronda)}
      aria-pressed={selected}
      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
        selected
          ? 'border-[#7a1f2c] bg-[#fbfaf6] ring-1 ring-[#7a1f2c]'
          : 'border-gray-200 bg-white hover:border-[#7a1f2c]/60 hover:bg-[#fbfaf6]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            <span className="text-gray-400 font-medium">Nº{ronda.numero_aplicacion} · </span>
            {ronda.objetivo}
          </p>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">
          <CalendarDays size={11} />
          {MESES[ronda.mes - 1] ?? `Mes ${ronda.mes}`}
        </span>
      </div>

      <ul className="mt-2 space-y-0.5">
        {ronda.lineas.map((l) => (
          <li key={l.insumo_id} className="flex items-baseline justify-between gap-3 text-xs text-gray-700">
            <span className="truncate">{l.insumo_nombre}</span>
            <span className="shrink-0 font-mono text-gray-500">
              {formatNum(l.dosis_por_ha)} {l.unidad}/ha
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap items-center gap-1.5">
        {ronda.variedades.map((v) => (
          <span
            key={v.variedad}
            className="text-[11px] font-medium text-gray-600 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-md"
          >
            {VARIEDAD_LABELS[v.variedad] ?? v.variedad} · {formatNum(v.ha_pendientes, 2)} ha
          </span>
        ))}
        <span className="ml-auto text-[11px] text-gray-500">{formatNum(haTotal, 2)} ha pendientes</span>
      </div>
    </button>
  )
}
