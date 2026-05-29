'use client'

import FincaMap from '@/components/map/FincaMap'

export default function MapaPage() {
  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex-shrink-0">
        <h1 className="text-2xl font-semibold text-[#1f1a17]">Mapa de Finca</h1>
        <p className="text-sm text-[#a09584] mt-0.5">
          Hacé clic en una parcela para ver sus detalles.
        </p>
      </div>
      <div
        className="flex-1 min-h-0 rounded-[10px] overflow-hidden border border-[#fbfaf6]"
        style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}
      >
        <FincaMap height="100%" />
      </div>
    </div>
  )
}
