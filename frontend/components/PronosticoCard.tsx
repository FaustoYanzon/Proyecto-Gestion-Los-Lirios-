'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CloudRain } from 'lucide-react'
import { getPronosticoExtendido } from '@/lib/api/clima'
import { useContextStore } from '@/store/contextStore'
import { wmoIcon } from '@/lib/weather'

const DIAS_VISIBLES = 5

function fmtDia(iso: string, idx: number): string {
  if (idx === 0) return 'Hoy'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '')
}

/** Aviso agronómico del período: lo más grave que aparezca en los próximos
 * días. Umbrales orientativos (helada ≤ 2 °C de mínima, viento ≥ 40 km/h,
 * códigos WMO 96/99 = tormenta con granizo). */
function alertaDelPeriodo(d: {
  time: string[]; temperature_2m_min: number[]; wind_speed_10m_max: number[]
  weather_code: number[]; precipitation_sum: number[]
}): { texto: string; grave: boolean } | null {
  const n = Math.min(DIAS_VISIBLES, d.time.length)
  for (let i = 0; i < n; i++) {
    const cuando = i === 0 ? 'hoy' : i === 1 ? 'mañana' : fmtDia(d.time[i], i)
    if (d.weather_code[i] === 96 || d.weather_code[i] === 99) return { texto: `Riesgo de granizo ${cuando}`, grave: true }
    if (d.temperature_2m_min[i] <= 2) return { texto: `Posible helada ${cuando} (mín ${Math.round(d.temperature_2m_min[i])}°)`, grave: true }
  }
  for (let i = 0; i < n; i++) {
    const cuando = i === 0 ? 'hoy' : i === 1 ? 'mañana' : fmtDia(d.time[i], i)
    if (d.wind_speed_10m_max[i] >= 40) return { texto: `Viento fuerte ${cuando} (${Math.round(d.wind_speed_10m_max[i])} km/h)`, grave: false }
  }
  const lluvia = d.precipitation_sum.slice(0, n).findIndex((p) => p >= 5)
  if (lluvia >= 0) {
    const cuando = lluvia === 0 ? 'hoy' : lluvia === 1 ? 'mañana' : fmtDia(d.time[lluvia], lluvia)
    return { texto: `Lluvia ${cuando} (${d.precipitation_sum[lluvia].toFixed(0)} mm)`, grave: false }
  }
  return null
}

/** Pronóstico de los próximos días para el encabezado del Inicio. */
export default function PronosticoCard() {
  const finca = useContextStore((s) => s.finca)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['clima-pronostico-extendido', finca],
    queryFn: () => getPronosticoExtendido(finca),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  })

  // Un dato inventado es peor que ninguno: si falla, no se muestra la tarjeta.
  if (isError) return null

  const d = data?.daily
  const alerta = d ? alertaDelPeriodo(d) : null

  return (
    <div
      className="rounded-[12px] border border-[#e2dbcc] bg-white p-4 flex-1 min-w-0"
      style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}
    >
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#5a544c]">
          Próximos días
        </span>
        {alerta && (
          <span
            className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={alerta.grave
              ? { backgroundColor: '#fbe9ec', color: '#a3293a' }
              : { backgroundColor: '#e8f0f5', color: '#2d5468' }}
          >
            {alerta.grave ? <AlertTriangle size={12} /> : <CloudRain size={12} />}
            {alerta.texto}
          </span>
        )}
      </div>

      {isLoading || !d ? (
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: DIAS_VISIBLES }).map((_, i) => (
            <div key={i} className="h-[84px] rounded-lg bg-[#f0ead8] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-2">
          {d.time.slice(0, DIAS_VISIBLES).map((dia, i) => {
            const Icon = wmoIcon(d.weather_code[i])
            const prob = Math.round(d.precipitation_probability_max[i])
            return (
              <div
                key={dia}
                className="rounded-lg py-2 px-1 text-center"
                style={{ backgroundColor: i === 0 ? '#f3e9e1' : '#faf6ec' }}
              >
                <p className="text-[11px] font-semibold capitalize text-[#5a544c]">{fmtDia(dia, i)}</p>
                <Icon size={22} strokeWidth={1.75} color="#3d6b86" className="mx-auto my-1" />
                <p className="text-sm font-bold text-[#1f1a17] leading-tight">
                  {Math.round(d.temperature_2m_max[i])}°
                  <span className="font-medium text-[#a09584]"> {Math.round(d.temperature_2m_min[i])}°</span>
                </p>
                <p className="text-[10px] text-[#3d6b86] mt-0.5">{prob > 0 ? `${prob}% lluvia` : ' '}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
