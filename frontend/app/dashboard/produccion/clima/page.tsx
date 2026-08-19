'use client'

import TermografoPanel from '@/components/produccion/TermografoPanel'
import PronosticoExtendidoPanel from '@/components/produccion/PronosticoExtendidoPanel'

export default function ClimaPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Clima</h1>
      </div>

      <TermografoPanel />
      <PronosticoExtendidoPanel />
    </div>
  )
}
