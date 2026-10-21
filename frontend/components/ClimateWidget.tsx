'use client'

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Cloud, Wind, Droplets, Sunrise } from 'lucide-react'
import { useContextStore } from '@/store/contextStore'
import { wmoDescription, wmoIcon, windDirectionLabel, uvLevel, weatherTheme } from '@/lib/weather'

// Fuente: /clima/actual (Open-Meteo, 30 min cache, sin API key). Media Agua no
// tiene estación propia expuesta por API — Open-Meteo interpola por
// coordenadas exactas, con resolución de pocos km. Evaluado scrapear
// Climagro (estación real en la finca) el 2026-08-05 y descartado por ahora:
// requiere login+parseo de HTML sin API, mantenimiento frágil. Revisar de
// nuevo solo si el dato de Open-Meteo se demuestra insuficiente para
// decisiones de riego.

const FINCA_LABELS: Record<string, string> = { los_mimbres: 'Los Mimbres', media_agua: 'Media Agua' }

interface ClimaActualResponse {
  current: {
    temperature_2m: number
    apparent_temperature: number
    relative_humidity_2m: number
    wind_speed_10m: number
    wind_direction_10m: number
    weather_code: number
  }
  daily: {
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    uv_index_max: number[]
  }
  _cached?: boolean
}

function useClimaActual() {
  const finca = useContextStore((s) => s.finca)
  const query = useQuery<ClimaActualResponse>({
    queryKey: ['clima-actual', finca],
    queryFn: async () => {
      const { data } = await api.get<ClimaActualResponse>('/clima/actual', {
        params: { finca },
      })
      return data
    },
    // Cache 30 min client-side, matching backend TTL
    staleTime: 30 * 60 * 1000,
    retry: 1,
  })
  return { finca, ...query }
}

/** Tarjeta de clima con color según el cielo. `banner` = horizontal, para el
 * encabezado del Inicio; `card` = apilada (ancho completo). */
export function ClimateCard({ variant = 'card' }: { variant?: 'card' | 'banner' }) {
  const { finca, data, isLoading, isError } = useClimaActual()

  const temp   = data ? Math.round(data.current.temperature_2m) : null
  const feels  = data ? Math.round(data.current.apparent_temperature) : null
  const desc   = data ? wmoDescription(data.current.weather_code) : null
  const Icon   = data ? wmoIcon(data.current.weather_code) : Cloud
  const max    = data?.daily.temperature_2m_max[0] != null ? Math.round(data.daily.temperature_2m_max[0]) : null
  const min    = data?.daily.temperature_2m_min[0] != null ? Math.round(data.daily.temperature_2m_min[0]) : null
  const wind   = data ? Math.round(data.current.wind_speed_10m) : null
  const windDir = data ? windDirectionLabel(data.current.wind_direction_10m) : null
  const humidity = data ? Math.round(data.current.relative_humidity_2m) : null
  const uv = data?.daily.uv_index_max[0] != null ? Math.round(data.daily.uv_index_max[0]) : null
  const uvInfo = uv !== null ? uvLevel(uv) : null
  const theme = weatherTheme(data?.current.weather_code ?? 3)
  const banner = variant === 'banner'

  const stats = [
    { Ico: Wind, value: `${wind} km/h`, label: windDir },
    { Ico: Droplets, value: `${humidity}%`, label: 'Humedad' },
    { Ico: Sunrise, value: `UV ${uv}`, label: uvInfo?.label },
  ]

  return (
    <div
      className={`rounded-[12px] p-4 flex-shrink-0 text-white ${banner ? 'w-full md:w-auto md:min-w-[460px]' : 'w-full'}`}
      style={{
        background: `linear-gradient(135deg, ${theme.from}, ${theme.to})`,
        boxShadow: '0 4px 14px rgba(31,26,23,0.18)',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-white/80">
          Clima — {FINCA_LABELS[finca] ?? finca}
        </span>
        <span className="text-[11px] text-white/70">
          {data?._cached ? 'hace <30 min' : 'ahora'}
        </span>
      </div>

      {isLoading && (
        <div className="space-y-1.5">
          <div className="h-8 bg-white/25 rounded animate-pulse w-16" />
          <div className="h-3 bg-white/25 rounded animate-pulse w-24" />
        </div>
      )}

      {isError && <p className="text-xs text-white/80">Sin datos de clima</p>}

      {!isLoading && !isError && temp !== null && (
        <div className={banner ? 'flex flex-wrap items-center gap-x-6 gap-y-3' : ''}>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line react-hooks/static-components -- wmoIcon()
                only selects among fixed, statically-imported lucide-react icons
                (never constructs a new component); false positive for this rule. */}
            <Icon size={banner ? 40 : 44} strokeWidth={1.5} color="#ffffff" />
            <span className="text-4xl font-bold leading-none">{temp}°</span>
            <div className="text-xs text-white/90">
              <p className="font-semibold">{desc}</p>
              {feels !== null && feels !== temp && <p>Sensación {feels}°</p>}
              {max !== null && min !== null && (
                <p className="text-white/75">Máx {max}° · Mín {min}°</p>
              )}
            </div>
          </div>

          <div
            className={`grid grid-cols-3 gap-2 ${banner ? 'flex-1 min-w-[200px]' : 'mt-3 pt-3 border-t border-white/25'}`}
          >
            {stats.map(({ Ico, value, label }) => (
              <div key={value + label} className="flex flex-col items-center gap-0.5 rounded-lg bg-white/15 py-1.5 px-1">
                <Ico size={14} strokeWidth={1.75} color="#ffffff" />
                <span className="text-xs font-semibold">{value}</span>
                <span className="text-[10px] text-white/75">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Variante mini — topbar del shell. Un guion mientras carga; nada si falla:
 * un dato de clima inventado es peor que ningún dato. */
export function ClimateMini() {
  const { data, isLoading, isError } = useClimaActual()

  if (isError) return null

  if (isLoading || !data) {
    return <span className="text-sm text-[#5a544c]">—</span>
  }

  const temp = Math.round(data.current.temperature_2m)
  const Icon = wmoIcon(data.current.weather_code)

  return (
    <span className="flex items-center gap-1.5 text-sm text-[#5a544c]" aria-label="Clima">
      {/* eslint-disable-next-line react-hooks/static-components -- wmoIcon()
          only selects among fixed, statically-imported lucide-react icons
          (never constructs a new component); false positive for this rule. */}
      <Icon size={16} strokeWidth={1.75} color="#3d6b86" />
      {temp}°
    </span>
  )
}
