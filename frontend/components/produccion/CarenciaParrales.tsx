'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { formatFecha, diasEntre, type CarenciaParcela } from '@/lib/fitosanitariosAgrupar'

interface Props {
  carencia: Map<string, CarenciaParcela>
  parcelaNombre: (id: string) => string
  hoy: string
}

// More days left = more restricted parcel, so the colour warms up with time.
export function claseCarencia(dias: number): string {
  if (dias >= 15) return 'bg-red-50 text-red-700 border-red-200'
  if (dias >= 7) return 'bg-amber-50 text-amber-800 border-amber-200'
  return 'bg-yellow-50 text-yellow-800 border-yellow-200'
}

export function textoDias(dias: number): string {
  return dias === 1 ? '1 día' : `${dias} días`
}

// One chip per parcel with the days left until its farthest habilitation date
// (replaces the old banner that listed every parcel x product).
export default function CarenciaParrales({ carencia, parcelaNombre, hoy }: Props) {
  const [abierta, setAbierta] = useState<string | null>(null)
  if (carencia.size === 0) return null

  // Ties on days fall back to the name so chips don't shuffle between reloads.
  const items = [...carencia.values()].sort((a, b) =>
    b.dias - a.dias
    || parcelaNombre(a.parcelaId).localeCompare(parcelaNombre(b.parcelaId), 'es', { numeric: true }),
  )
  const detalle = abierta ? carencia.get(abierta) : undefined

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm" data-testid="carencia-parrales">
      <div className="flex items-center gap-2 mb-2 text-sm font-medium text-gray-700">
        <AlertTriangle size={15} className="text-amber-500" />
        {items.length === 1 ? '1 parcela en carencia' : `${items.length} parcelas en carencia`}
        <span className="text-xs font-normal text-gray-400">· hasta la fecha más lejana de cada una</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((c) => (
          <button
            key={c.parcelaId}
            type="button"
            onClick={() => setAbierta(abierta === c.parcelaId ? null : c.parcelaId)}
            aria-expanded={abierta === c.parcelaId}
            title={`Habilita el ${formatFecha(c.hasta)}. Limita: ${c.limitantes.map((r) => r.producto_nombre).join(', ')}`}
            className={`text-sm px-2.5 py-1 rounded-md border transition-colors hover:brightness-95 ${claseCarencia(c.dias)} ${abierta === c.parcelaId ? 'ring-2 ring-[#7a1f2c]/40' : ''}`}
          >
            <span className="font-medium">{parcelaNombre(c.parcelaId)}</span>
            <span className="ml-1.5">{textoDias(c.dias)}</span>
          </button>
        ))}
      </div>

      {detalle && (
        <div className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-600" data-testid="carencia-detalle">
          <p className="mb-1 font-medium text-gray-700">
            {parcelaNombre(detalle.parcelaId)} habilita el {formatFecha(detalle.hasta)}
          </p>
          <ul className="space-y-0.5">
            {detalle.vigentes.map((r) => (
              <li key={r.id} className={r.fecha_habilitacion_cosecha === detalle.hasta ? 'font-medium text-gray-800' : ''}>
                {r.producto_nombre} · aplicado el {formatFecha(r.fecha)} · carencia {r.dias_carencia} d ·
                habilita el {formatFecha(r.fecha_habilitacion_cosecha)} ({textoDias(diasEntre(hoy, r.fecha_habilitacion_cosecha))})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
