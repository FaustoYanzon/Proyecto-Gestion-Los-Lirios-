'use client'

import { useAuthStore } from '@/store/authStore'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Cloud, ClipboardList, TrendingDown } from 'lucide-react'
import FincaMap from '@/components/map/FincaMap'
import Alertas from '@/components/Alertas'
import type { EgresoResponse } from '@/lib/api/egresos'

interface TrabajoItem { id: string }

// WMO weather code → short Spanish description
// Ref: https://open-meteo.com/en/docs#weathervariables
function wmoDescription(code: number): string {
  if (code === 0) return 'Despejado'
  if (code <= 2) return 'Parcialmente nublado'
  if (code === 3) return 'Nublado'
  if (code <= 49) return 'Niebla'
  if (code <= 59) return 'Llovizna'
  if (code <= 69) return 'Lluvia'
  if (code <= 79) return 'Nieve'
  if (code <= 84) return 'Chaparrón'
  if (code <= 99) return 'Tormenta'
  return 'Variable'
}

interface ClimaActualResponse {
  current: {
    temperature_2m: number
    weather_code: number
  }
  daily: {
    temperature_2m_max: number[]
    temperature_2m_min: number[]
  }
  _cached?: boolean
}

type LucideIcon = React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>

function KpiCard({
  label, icon: Icon, value, sub, isLoading,
}: {
  label: string; icon: LucideIcon; value: string | number
  sub?: string; isLoading: boolean
}) {
  return (
    <div
      className="bg-white rounded-[10px] border border-[#fbfaf6] p-4 flex-shrink-0"
      style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#5a544c]">{label}</span>
        <Icon size={16} strokeWidth={1.75} color="#a09584" />
      </div>
      {isLoading ? (
        <div className="h-7 bg-[#fbfaf6] rounded animate-pulse w-20" />
      ) : (
        <>
          <p className="text-xl font-bold text-[#1f1a17]">{value}</p>
          {sub && <p className="text-xs text-[#a09584] mt-0.5">{sub}</p>}
        </>
      )}
    </div>
  )
}

function ClimateCard() {
  const { data, isLoading, isError } = useQuery<ClimaActualResponse>({
    queryKey: ['clima-actual', 'los_mimbres'],
    queryFn: async () => {
      const { data } = await api.get<ClimaActualResponse>('/clima/actual', {
        params: { finca: 'los_mimbres' },
      })
      return data
    },
    // Cache 30 min client-side, matching backend TTL
    staleTime: 30 * 60 * 1000,
    retry: 1,
  })

  const temp = data ? Math.round(data.current.temperature_2m) : null
  const desc = data ? wmoDescription(data.current.weather_code) : null
  const max  = data?.daily.temperature_2m_max[0] != null ? Math.round(data.daily.temperature_2m_max[0]) : null
  const min  = data?.daily.temperature_2m_min[0] != null ? Math.round(data.daily.temperature_2m_min[0]) : null

  return (
    <div
      className="rounded-[10px] border border-[#fbfaf6] p-4 flex-shrink-0"
      style={{ backgroundColor: '#faf6ec', boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Cloud size={16} strokeWidth={1.75} color="#3d6b86" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#5a544c]">
          Clima — Los Mimbres
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
              <p>{desc}</p>
              {max !== null && min !== null && (
                <p className="text-[#a09584]">Máx {max}° · Mín {min}°</p>
              )}
            </div>
          </div>
          <p className="text-xs text-[#a09584] mt-2">
            {data?._cached ? 'Actualizado hace menos de 30 min' : 'Actualizado ahora'}
          </p>
        </>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)

  const today        = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const toISO        = (d: Date) => d.toISOString().split('T')[0]

  const todayLabel = today.toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const { data: trabajos, isLoading: loadingTrabajos } = useQuery({
    queryKey: ['dashboard-trabajos', toISO(firstOfMonth)],
    queryFn: async () => {
      const { data } = await api.get<TrabajoItem[]>('/produccion/trabajo/', {
        params: { fecha_desde: toISO(firstOfMonth), fecha_hasta: toISO(today), limit: 1000 },
      })
      return data
    },
  })

  const { data: egresos, isLoading: loadingEgresos } = useQuery({
    queryKey: ['dashboard-egresos', toISO(firstOfMonth)],
    queryFn: async () => {
      const { data } = await api.get<EgresoResponse[]>('/finanzas/egresos/', {
        params: { fecha_desde: toISO(firstOfMonth), fecha_hasta: toISO(today), moneda: 'ars', limit: 1000 },
      })
      return data
    },
  })

  const totalEgreso = egresos?.reduce((s, e) => s + Number(e.monto), 0) ?? 0
  const fmtARS = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  const firstName = user?.full_name.split(' ')[0] ?? ''

  return (
    <div className="flex flex-col gap-4" style={{ height: 'calc(100vh - 200px)' }}>
      {/* Header */}
      <div className="flex-shrink-0">
        <h1 className="text-2xl font-semibold text-[#1f1a17]">
          Bienvenido{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="text-sm text-[#a09584] mt-0.5 capitalize">{todayLabel}</p>
      </div>

      {/* Grid mapa + sidebar */}
      <div
        className="flex-1 min-h-0 grid gap-4"
        style={{ gridTemplateColumns: '2.2fr 1fr' }}
      >
        {/* Mapa */}
        <div
          className="rounded-[10px] overflow-hidden border border-[#fbfaf6]"
          style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}
        >
          <FincaMap compact height="100%" />
        </div>

        {/* Sidebar derecho */}
        <div className="flex flex-col gap-3 min-h-0 overflow-y-auto">
          <ClimateCard />
          <KpiCard
            label="Jornales este mes"
            icon={ClipboardList}
            value={trabajos?.length ?? '—'}
            sub={`desde el 1/${firstOfMonth.getMonth() + 1}`}
            isLoading={loadingTrabajos}
          />
          <KpiCard
            label="Egresos ARS este mes"
            icon={TrendingDown}
            value={loadingEgresos ? '—' : totalEgreso > 0 ? fmtARS(totalEgreso) : '$0'}
            sub={`desde el 1/${firstOfMonth.getMonth() + 1}`}
            isLoading={loadingEgresos}
          />
          <Alertas />
        </div>
      </div>
    </div>
  )
}
