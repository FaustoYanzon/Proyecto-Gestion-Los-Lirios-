'use client'

import type { CumplimientoEstadoItem } from '@/lib/api/trazabilidad'

function fmt(d: string) {
  return d.split('-').reverse().join('/')
}

export default function RiegoPorEstado({ items }: { items: CumplimientoEstadoItem[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Cumplimiento de riego por estado de campaña</h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Sin estados de campaña en el período elegido.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-1.5 pr-2 font-medium">Estado</th>
                <th className="py-1.5 pr-2 font-medium">Desde</th>
                <th className="py-1.5 pr-2 font-medium">Hasta</th>
                <th className="py-1.5 pr-2 font-medium text-right">mm aplicados</th>
                <th className="py-1.5 pr-2 font-medium text-right">m³ aplicados</th>
                <th className="py-1.5 font-medium text-right">Cumplimiento</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                // cumplido === null: parcela without surface, compliance unknown -> neutral
                const rowCls =
                  e.cumplido === null ? 'bg-gray-50' : e.cumplido ? 'bg-green-50/50' : 'bg-red-50/50'
                const pctCls =
                  e.cumplido === null ? 'text-gray-500' : e.cumplido ? 'text-green-700' : 'text-red-700'
                return (
                <tr key={e.estado_campana + e.fecha_inicio} className={`border-b border-gray-50 ${rowCls}`}>
                  <td className="py-1.5 pr-2 text-gray-800">{e.estado_campana_label}</td>
                  <td className="py-1.5 pr-2 text-gray-500">{fmt(e.fecha_inicio)}</td>
                  <td className="py-1.5 pr-2 text-gray-500">{fmt(e.fecha_fin)}</td>
                  <td className="py-1.5 pr-2 text-right text-gray-700">{e.mm_aplicados ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right text-gray-700">
                    {(e.litros_aplicados / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}
                  </td>
                  <td className={`py-1.5 text-right font-medium ${pctCls}`}>
                    {e.cumplimiento_pct === null ? '—' : `${e.cumplimiento_pct}%`}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
