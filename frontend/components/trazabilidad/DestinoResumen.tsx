'use client'

import type { ResumenDestinoItem } from '@/lib/api/trazabilidad'

export default function DestinoResumen({ items }: { items: ResumenDestinoItem[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Destino de la producción</h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Sin cosechas en el período elegido.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((d) => (
            <li key={d.destino} className="flex items-center justify-between text-sm">
              <span className="text-gray-700">{d.destino_label}</span>
              <span className="text-gray-500">
                {d.kg_total.toLocaleString('es-AR')} kg <span className="text-gray-400">({d.pct_del_total}%)</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
