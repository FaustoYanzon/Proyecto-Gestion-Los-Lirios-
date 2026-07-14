'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Cloud, ArrowRight, BarChart3, Wallet, Users } from 'lucide-react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'
import FincaMap from '@/components/map/FincaMap'
import Alertas from '@/components/Alertas'
import FenologiaNotificaciones from '@/components/FenologiaNotificaciones'
import { getPresupuestoVsReal, getKpiProduccionParcelas } from '@/lib/api/kpis'

const now = new Date()
const TEMPORADA = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const MESES_ORDER = [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4]
const MES_LABELS: Record<number, string> = {
  5: 'May', 6: 'Jun', 7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Oct',
  11: 'Nov', 12: 'Dic', 1: 'Ene', 2: 'Feb', 3: 'Mar', 4: 'Abr',
}
const fmtM = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? `$${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`
    : `$${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n)}`

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

function DireccionKpi({ label, value, hint, tone = 'neutral' }: {
  label: string; value: string; hint?: string; tone?: 'good' | 'bad' | 'neutral'
}) {
  const hintColor = tone === 'good' ? '#3f5c3a' : tone === 'bad' ? '#a3293a' : '#a09584'
  return (
    <div className="bg-white rounded-[10px] border border-[#fbfaf6] p-4"
      style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#5a544c]">{label}</p>
      <p className="text-xl font-bold text-[#1f1a17] mt-1">{value}</p>
      {hint && <p className="text-xs font-medium mt-0.5" style={{ color: hintColor }}>{hint}</p>}
    </div>
  )
}

// Weather widget. Data source today: /clima/actual (Open-Meteo, 30 min cache).
// Etapa 5: same slot will be fed by the Climagro (Pegasus) scraper — only the
// backend source changes, this component keeps consuming /clima/actual.
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

// ── Dirección section (gerencial roles only) ──────────────────────────────────

const DASHBOARD_LINKS = [
  { href: '/dashboard/produccion/dashboard', label: 'Producción', icon: BarChart3 },
  { href: '/dashboard/finanzas/dashboard', label: 'Finanzas', icon: Wallet },
  { href: '/dashboard/finanzas/mano-de-obra', label: 'Mano de Obra', icon: Users },
]

function DireccionSection() {
  const { data: pvr = [] } = useQuery({
    queryKey: ['kpi-presup-real', TEMPORADA, 'ars'],
    queryFn: () => getPresupuestoVsReal({ temporada: TEMPORADA, moneda: 'ars' }),
    staleTime: 300_000,
    retry: false,
  })

  const { data: parcelasKpi = [] } = useQuery({
    queryKey: ['kpi-prod-parcelas', TEMPORADA],
    queryFn: () => getKpiProduccionParcelas(TEMPORADA),
    staleTime: 300_000,
    retry: false,
  })

  const resumen = useMemo(() => {
    let ingReal = 0, ingPresup = 0, egrReal = 0, egrPresup = 0
    for (const r of pvr) {
      if (r.concepto === 'ingreso') {
        ingReal += Number(r.monto_real); ingPresup += Number(r.monto_presupuesto)
      } else {
        egrReal += Number(r.monto_real); egrPresup += Number(r.monto_presupuesto)
      }
    }
    const kgTotal = parcelasKpi.reduce((s, p) => s + p.kg_total, 0)
    const conPlan = parcelasKpi.filter((p) => p.kg_plan != null)
    const kgPlan = conPlan.reduce((s, p) => s + Number(p.kg_plan), 0)
    const kgRealConPlan = conPlan.reduce((s, p) => s + p.kg_total, 0)
    const ha = parcelasKpi.reduce((s, p) => s + (p.superficie_ha ?? 0), 0)
    return {
      ingReal, ingPresup, egrReal, egrPresup,
      saldo: ingReal - egrReal,
      kgTotal,
      avancePlan: kgPlan > 0 ? (kgRealConPlan / kgPlan) * 100 : null,
      margenHa: ha > 0 ? (ingReal - egrReal) / ha : null,
    }
  }, [pvr, parcelasKpi])

  const curva = useMemo(() => {
    const base = MESES_ORDER.map((m) => ({
      label: MES_LABELS[m], mes: m, ingReal: 0, ingPresup: 0, egrReal: 0, egrPresup: 0,
    }))
    const idx = new Map(base.map((r) => [r.mes, r]))
    for (const r of pvr) {
      const row = idx.get(r.mes)
      if (!row) continue
      if (r.concepto === 'ingreso') {
        row.ingReal += Number(r.monto_real); row.ingPresup += Number(r.monto_presupuesto)
      } else {
        row.egrReal += Number(r.monto_real); row.egrPresup += Number(r.monto_presupuesto)
      }
    }
    let aIR = 0, aIP = 0, aER = 0, aEP = 0
    return base.map((r) => {
      aIR += r.ingReal; aIP += r.ingPresup; aER += r.egrReal; aEP += r.egrPresup
      return { label: r.label, 'Ingresos real': aIR, 'Ingresos presup.': aIP, 'Egresos real': aER, 'Egresos presup.': aEP }
    })
  }, [pvr])

  const hayDatos = pvr.length > 0 || parcelasKpi.length > 0
  if (!hayDatos) return null

  const pct = (real: number, presup: number) =>
    presup > 0 ? `${((real / presup) * 100).toFixed(0)}%` : '—'

  return (
    <div className="flex-shrink-0 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-[#5a544c]">
          Dirección · Campaña {TEMPORADA}/{TEMPORADA + 1}
        </h2>
        <div className="flex gap-2">
          {DASHBOARD_LINKS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg
                         border border-[#e6c8cd] text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors">
              <Icon size={13} strokeWidth={2} />
              {label}
              <ArrowRight size={12} />
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <DireccionKpi
          label="Kg vs plan"
          value={resumen.avancePlan != null ? `${resumen.avancePlan.toFixed(0)}%` : `${(resumen.kgTotal / 1000).toFixed(0)} t`}
          hint={resumen.avancePlan != null ? `${(resumen.kgTotal / 1000).toFixed(0)} t cosechadas` : 'sin metas cargadas'}
          tone={resumen.avancePlan == null ? 'neutral' : resumen.avancePlan >= 95 ? 'good' : 'bad'}
        />
        <DireccionKpi
          label="Ingresos vs presup."
          value={pct(resumen.ingReal, resumen.ingPresup)}
          hint={fmtM(resumen.ingReal)}
          tone={resumen.ingPresup === 0 ? 'neutral' : resumen.ingReal >= resumen.ingPresup * 0.9 ? 'good' : 'bad'}
        />
        <DireccionKpi
          label="Egresos vs presup."
          value={pct(resumen.egrReal, resumen.egrPresup)}
          hint={fmtM(resumen.egrReal)}
          tone={resumen.egrPresup === 0 ? 'neutral' : resumen.egrReal <= resumen.egrPresup * 1.1 ? 'good' : 'bad'}
        />
        <DireccionKpi
          label="Saldo campaña"
          value={fmtM(resumen.saldo)}
          hint="ARS · ingresos − egresos"
          tone={resumen.saldo >= 0 ? 'good' : 'bad'}
        />
        <DireccionKpi
          label="Margen bruto por ha"
          value={resumen.margenHa != null ? fmtM(resumen.margenHa) : '—'}
          hint="ARS/ha · campañas entre sí → comparar en USD"
        />
      </div>

      <div className="bg-white rounded-[10px] border border-[#fbfaf6] p-4"
        style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}>
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#5a544c] mb-2">
          Flujo acumulado: real vs presupuesto (ARS)
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={curva} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={55} tickFormatter={(v) => fmtM(Number(v))} />
            <Tooltip formatter={(v, name) => [fmtM(Number(v)), name]} contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="Ingresos real" stroke="#3f5c3a" strokeWidth={2} dot={false} />
            <Line dataKey="Ingresos presup." stroke="#3f5c3a" strokeWidth={1.5} strokeDasharray="6 4" dot={false} />
            <Line dataKey="Egresos real" stroke="#a3293a" strokeWidth={2} dot={false} />
            <Line dataKey="Egresos presup." stroke="#a3293a" strokeWidth={1.5} strokeDasharray="6 4" dot={false} />
            <ReferenceLine y={0} stroke="#5a544c" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
// Inicio queda reducido a lo esencial: Dirección (D1), mapa compacto,
// clima y notificaciones (alertas + fenología).

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const isGerencial = user?.role === 'super_admin' || user?.role === 'gerencial'

  const todayLabel = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const firstName = user?.full_name.split(' ')[0] ?? ''

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex-shrink-0">
        <h1 className="text-2xl font-semibold text-[#1f1a17]">
          Bienvenido{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="text-sm text-[#a09584] mt-0.5 capitalize">{todayLabel}</p>
      </div>

      {/* Dirección (gerencial only) */}
      {isGerencial && <DireccionSection />}

      {/* Grid mapa compacto + sidebar clima/alertas */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: '1.6fr 1fr', minHeight: 320, maxHeight: 380 }}
      >
        {/* Mapa (reducido) */}
        <div
          className="rounded-[10px] overflow-hidden border border-[#fbfaf6]"
          style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}
        >
          <FincaMap compact height="100%" />
        </div>

        {/* Sidebar derecho: clima + alertas */}
        <div className="flex flex-col gap-3 min-h-0 overflow-y-auto">
          <ClimateCard />
          <Alertas />
        </div>
      </div>

      {/* Notificación fenológica — franja completa debajo del mapa */}
      <div className="flex-shrink-0">
        <FenologiaNotificaciones />
      </div>
    </div>
  )
}
