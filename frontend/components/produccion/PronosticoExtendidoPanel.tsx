'use client'

import { useQuery } from '@tanstack/react-query'
import { Droplets, Wind, CloudRain } from 'lucide-react'
import { getPronosticoExtendido } from '@/lib/api/clima'
import { wmoDescription, wmoIcon, windDirectionLabel } from '@/lib/weather'

function fmtDia(iso: string, idx: number): string {
  const d = new Date(iso + 'T12:00:00')
  if (idx === 0) return 'Hoy'
  if (idx === 1) return 'Mañana'
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

export default function PronosticoExtendidoPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['clima-pronostico-extendido', 'media_agua'],
    queryFn: () => getPronosticoExtendido('media_agua'),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  })

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <p className="text-sm font-medium text-gray-800 mb-3">Pronóstico extendido — Media Agua</p>

      {isLoading && <div className="h-32 flex items-center justify-center text-sm text-gray-400">Cargando...</div>}
      {isError && <div className="h-32 flex items-center justify-center text-sm text-gray-400">Sin datos de pronóstico</div>}

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
          {data.daily.time.map((dia, i) => {
            const Icon = wmoIcon(data.daily.weather_code[i])
            const precip = data.daily.precipitation_sum[i]
            const precipProb = data.daily.precipitation_probability_max[i]
            return (
              <div key={dia} className="rounded-[10px] border border-[#e2dbcc] p-3 text-center" style={{ backgroundColor: '#faf6ec' }}>
                <p className="text-xs font-medium text-[#5a544c]">{fmtDia(dia, i)}</p>
                <Icon size={20} strokeWidth={1.75} color="#3d6b86" className="mx-auto my-1.5" />
                <p className="text-[11px] text-[#a09584] mb-1">{wmoDescription(data.daily.weather_code[i])}</p>
                <p className="text-sm font-semibold text-[#1f1a17]">
                  {Math.round(data.daily.temperature_2m_max[i])}° / {Math.round(data.daily.temperature_2m_min[i])}°
                </p>
                <div className="flex items-center justify-center gap-1 mt-2 text-[11px] text-[#5a544c]">
                  <CloudRain size={11} />
                  {precip > 0 ? `${precip.toFixed(1)}mm (${Math.round(precipProb)}%)` : `${Math.round(precipProb)}%`}
                </div>
                <div className="flex items-center justify-center gap-1 mt-1 text-[11px] text-[#5a544c]">
                  <Droplets size={11} />
                  {Math.round(data.daily.relative_humidity_2m_mean[i])}%
                </div>
                <div className="flex items-center justify-center gap-1 mt-1 text-[11px] text-[#5a544c]">
                  <Wind size={11} />
                  {Math.round(data.daily.wind_speed_10m_max[i])} km/h {windDirectionLabel(data.daily.wind_direction_10m_dominant[i])}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
