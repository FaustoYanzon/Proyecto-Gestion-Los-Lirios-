'use client'

import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Cloud, Wind, Droplets, Sunrise } from 'lucide-react'
import { useContextStore } from '@/store/contextStore'
import { wmoDescription, wmoIcon, windDirectionLabel, uvLevel } from '@/lib/weather'

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

/** Tarjeta completa — Inicio, sidebar de clima. */
export function ClimateCard() {
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

  return (
    <div
      className="rounded-[10px] border border-[#e2dbcc] p-4 flex-shrink-0 w-full"
      style={{ backgroundColor: '#faf6ec', boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} strokeWidth={1.75} color="#3d6b86" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#5a544c]">
          Clima — {FINCA_LABELS[finca] ?? finca}
        </span>
      </div>

      {isLoading && (
        <div className="space-y-1.5">
          <div className="h-8 bg-[#f0ead8] rounded animate-pulse w-16" />
          <div className="h-3 bg-[#f0ead8] rounded animate-pulse w-24" />
        </div>
      )}

      {isError && (
        <p className="text-xs text-[#a09584]">Sin datos de clima</p>
      )}

      {!isLoading && !isError && temp !== null && (
        <>
          <div className="flex items-end gap-3">
            <span className="text-3xl font-bold text-[#1f1a17]">{temp}°</span>
            <div className="text-xs text-[#5a544c] mb-1">
              <p>{desc}{feels !== null && feels !== temp ? ` · Sensación ${feels}°` : ''}</p>
              {max !== null && min !== null && (
                <p className="text-[#a09584]">Máx {max}° · Mín {min}°</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-[#f0ead8]">
            <div className="flex flex-col items-center gap-1">
              <Wind size={14} strokeWidth={1.75} color="#5a544c" />
              <span className="text-xs font-semibold text-[#1f1a17]">{wind} km/h</span>
              <span className="text-[10px] text-[#a09584]">{windDir}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Droplets size={14} strokeWidth={1.75} color="#5a544c" />
              <span className="text-xs font-semibold text-[#1f1a17]">{humidity}%</span>
              <span className="text-[10px] text-[#a09584]">Humedad</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Sunrise size={14} strokeWidth={1.75} color="#5a544c" />
              <span className="text-xs font-semibold" style={{ color: uvInfo?.color ?? '#1f1a17' }}>
                UV {uv}
              </span>
              <span className="text-[10px] text-[#a09584]">{uvInfo?.label}</span>
            </div>
          </div>

          <p className="text-xs text-[#a09584] mt-3">
            {data?._cached ? 'Actualizado hace menos de 30 min' : 'Actualizado ahora'}
          </p>
        </>
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
      <Icon size={16} strokeWidth={1.75} color="#3d6b86" />
      {temp}°
    </span>
  )
}
