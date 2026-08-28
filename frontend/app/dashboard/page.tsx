'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BarChart3, Wallet, Users } from 'lucide-react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'
import FincaMap from '@/components/map/FincaMap'
import Alertas from '@/components/Alertas'
import FenologiaNotificaciones from '@/components/FenologiaNotificaciones'
import RiegosEnCurso from '@/components/produccion/RiegosEnCurso'
import { ClimateCard } from '@/components/ClimateWidget'
import { getPresupuestoVsReal, getKpiProduccionParcelas } from '@/lib/api/kpis'
import { getParcelasMapa } from '@/lib/api/produccion'

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

function DireccionKpi({ label, value, hint, tone = 'neutral' }: {
  label: string; value: string; hint?: string; tone?: 'good' | 'bad' | 'neutral'
}) {
  const hintColor = tone === 'good' ? '#3f5c3a' : tone === 'bad' ? '#a3293a' : '#a09584'
  return (
    <div className="bg-white rounded-[10px] border border-[#e2dbcc] p-4"
      style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-[#5a544c]">{label}</p>
      <p className="text-xl font-bold text-[#1f1a17] mt-1">{value}</p>
      {hint && <p className="text-xs font-medium mt-0.5" style={{ color: hintColor }}>{hint}</p>}
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

      <div className="bg-white rounded-[10px] border border-[#e2dbcc] p-4"
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

  const todayLabelRaw = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const todayLabel = todayLabelRaw.charAt(0).toUpperCase() + todayLabelRaw.slice(1)

  const firstName = user?.full_name.split(' ')[0] ?? ''

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas-mapa'],
    queryFn: getParcelasMapa,
    staleTime: 5 * 60_000,
  })

  function parcelaNombre(id: string): string {
    return parcelas.find((p) => p.id === id)?.nombre ?? id
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex-shrink-0">
        <h1 className="text-2xl font-semibold text-[#1f1a17]">
          Bienvenido{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="text-sm text-[#a09584] mt-0.5">{todayLabel}</p>
      </div>

      {/* Dirección (gerencial only) */}
      {isGerencial && <DireccionSection />}

      {/* Grid mapa compacto + sidebar clima/alertas */}
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: '1fr 1fr', height: 460 }}
      >
        {/* Mapa (reducido) — clickeable, lleva al mapa completo */}
        <Link
          href="/dashboard/mapa"
          className="group relative rounded-[10px] overflow-hidden border border-[#e2dbcc] block"
          style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}
        >
          <FincaMap compact height="100%" />
          <span className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none" />
          <span
            className="absolute bottom-3 right-3 text-xs font-semibold text-white px-3 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ backgroundColor: '#1f1a17cc' }}
          >
            Ver mapa completo →
          </span>
        </Link>

        {/* Sidebar derecho: clima + alertas + riegos en curso */}
        <div className="flex flex-col gap-3 min-h-0 overflow-y-auto">
          <ClimateCard />
          <Alertas />
          <RiegosEnCurso
            parcelaNombre={parcelaNombre}
            showTerminar={false}
            iniciarHref="/dashboard/produccion/riego"
            collapsed
          />
        </div>
      </div>

      {/* Notificación fenológica — franja completa debajo del mapa */}
      <div className="flex-shrink-0">
        <FenologiaNotificaciones />
      </div>
    </div>
  )
}
