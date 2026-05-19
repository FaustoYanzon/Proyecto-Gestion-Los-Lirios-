'use client'

import FincaMap from '@/components/map/FincaMap'

export default function MapaPage() {
  return (
    <div className="flex flex-col gap-3 h-full">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Mapa de Finca</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Hacé clic en una parcela para ver sus detalles. Usá el botón para cambiar la vista por tipo o variedad.
        </p>
      </div>
      <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-gray-200 shadow-sm" style={{ height: 'calc(100vh - 160px)' }}>
        <FincaMap height="100%" />
      </div>
    </div>
  )
}
