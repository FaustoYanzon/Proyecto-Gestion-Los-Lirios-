'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, Cell, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Legend, AreaChart, Area,
} from 'recharts'
import { AlertTriangle } from 'lucide-react'
import { VARIEDAD_LABELS } from '@/lib/api/produccion'
import { getAlertasCarencia } from '@/lib/api/fitosanitarios'
import {
  getCosechaTotales,
  getCosechaResumenPorSemana,
  DESTINO_LABELS,
} from '@/lib/api/cosecha'
import type { DestinoCosecha } from '@/lib/api/cosecha'
import {
  getKpiProduccionParcelas,
  getKpiProduccionVariedades,
} from '@/lib/api/kpis'
import type { ProduccionParcelaKpi } from '@/lib/api/kpis'
import { useCampanaAnio, buildCampanas, campanaToAnio, useContextStore } from '@/store/contextStore'

// ── Constants ─────────────────────────────────────────────────────────────────

const AVAILABLE_YEARS = buildCampanas().map(campanaToAnio)

const FINCA_LABELS: Record<string, string> = { los_mimbres: 'Los Mimbres', media_agua: 'Media Agua' }

// Design-system colors per variedad (see docs/DESIGN_SYSTEM.md)
const VARIEDAD_COLORS: Record<string, string> = {
  flame: '#a3293a',
  red_globe: '#7a1f2c',
  fiesta: '#c89a3a',
  sultanina: '#3f5c3a',
  syrah: '#3d6b86',
  bonarda: '#8a5a2b',
  aspirant: '#9a3140',
  alfalfa: '#5a544c',
  otro: '#a09584',
}
const varColor = (v: string | null): string => VARIEDAD_COLORS[v ?? 'otro'] ?? '#a09584'

// ── Small UI pieces ───────────────────────────────────────────────────────────

function KpiCard({ label, value, hint, tone = 'neutral' }: {
  label: string
  value: string
  hint?: string
  tone?: 'good' | 'bad' | 'neutral'
}) {
  const hintCls =
    tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-700' : 'text-gray-400'
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      {hint && <p className={`text-xs font-medium mt-0.5 ${hintCls}`}>{hint}</p>}
    </div>
  )
}

function ChartCard({ title, subtitle, children, flex }: {
  title: string
  subtitle?: string
  children: React.ReactNode
  flex?: string
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5" style={flex ? { flex } : undefined}>
      <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      {subtitle && <p className="text-xs text-gray-400 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </div>
  )
}

const EmptyChart = ({ msg }: { msg: string }) => (
  <div className="flex items-center justify-center h-64 text-gray-400 text-sm text-center px-6">{msg}</div>
)

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProduccionDashboardPage() {
  const finca = useContextStore((s) => s.finca)
  const [anio, setAnio] = useCampanaAnio()
  const [variedadFilter, setVariedadFilter] = useState<string>('todas')

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: parcelasKpi = [] } = useQuery({
    queryKey: ['kpi-prod-parcelas', anio, finca],
    queryFn: () => getKpiProduccionParcelas(anio, finca),
    staleTime: 300_000,
  })

  const { data: variedadesKpi = [] } = useQuery({
    queryKey: ['kpi-prod-variedades', anio, finca],
    queryFn: () => getKpiProduccionVariedades(anio, finca),
    staleTime: 300_000,
  })

  const { data: cosechaTotales } = useQuery({
    queryKey: ['cosecha-totales', anio],
    queryFn: () => getCosechaTotales(anio),
    staleTime: 60_000,
  })

  const { data: semanasActual = [] } = useQuery({
    queryKey: ['cosecha-semanas', anio],
    queryFn: () => getCosechaResumenPorSemana(anio),
    staleTime: 300_000,
  })

  const { data: semanasAnterior = [] } = useQuery({
    queryKey: ['cosecha-semanas', anio - 1],
    queryFn: () => getCosechaResumenPorSemana(anio - 1),
    staleTime: 300_000,
  })

  const { data: alertasCarencia = [] } = useQuery({
    queryKey: ['alertas-carencia'],
    queryFn: () => getAlertasCarencia(),
    staleTime: 60_000,
  })

  // ── Derived data ───────────────────────────────────────────────────────────

  // Variedades present in this season's data (for the filter dropdown)
  const variedadesDisponibles = useMemo(
    () => Array.from(new Set(parcelasKpi.map((p) => p.variedad ?? 'otro'))).sort(),
    [parcelasKpi],
  )

  // Variety filter drives KPI cards + per-parcel charts.
  // Curva S and mix por destino stay unfiltered (their endpoints aggregate whole finca).
  const parcelasFiltradas = useMemo(
    () =>
      variedadFilter === 'todas'
        ? parcelasKpi
        : parcelasKpi.filter((p) => (p.variedad ?? 'otro') === variedadFilter),
    [parcelasKpi, variedadFilter],
  )

  const kpis = useMemo(() => {
    const kgTotal = parcelasFiltradas.reduce((s, p) => s + p.kg_total, 0)
    const haConDatos = parcelasFiltradas.reduce((s, p) => s + (p.superficie_ha ?? 0), 0)
    // Weighted average, not average of per-parcel kg/ha values
    const kgHa = haConDatos > 0 ? kgTotal / haConDatos : null
    const litros = parcelasFiltradas.reduce((s, p) => s + (p.litros_riego_estimados ?? 0), 0)
    const litrosPorKg = kgTotal > 0 && litros > 0 ? litros / kgTotal : null
    const conPlan = parcelasFiltradas.filter((p) => p.kg_plan != null)
    const kgPlan = conPlan.reduce((s, p) => s + Number(p.kg_plan), 0)
    const kgRealConPlan = conPlan.reduce((s, p) => s + p.kg_total, 0)
    const avancePlan = kgPlan > 0 ? (kgRealConPlan / kgPlan) * 100 : null
    return { kgTotal, kgHa, litrosPorKg, avancePlan, nParcelas: parcelasFiltradas.length }
  }, [parcelasFiltradas])

  const kgHaData = useMemo(
    () =>
      parcelasFiltradas
        .filter((p) => p.kg_ha != null)
        .map((p) => ({
          parcela: p.parcela_nombre,
          kg_ha: Number(p.kg_ha),
          variedad: p.variedad,
        })),
    [parcelasFiltradas],
  )

  // Weighted plan target line: total kg_plan / total ha of parcelas with plan
  const objetivoKgHa = useMemo(() => {
    const conPlan = parcelasFiltradas.filter((p) => p.kg_plan != null && p.superficie_ha)
    const ha = conPlan.reduce((s, p) => s + (p.superficie_ha ?? 0), 0)
    const plan = conPlan.reduce((s, p) => s + Number(p.kg_plan), 0)
    return ha > 0 ? plan / ha : null
  }, [parcelasFiltradas])

  const variedadData = useMemo(
    () =>
      variedadesKpi
        .filter((v) => v.kg_ha != null)
        .map((v) => ({
          variedad: VARIEDAD_LABELS[v.variedad ?? 'otro'] ?? v.variedad ?? 'Otro',
          key: v.variedad,
          kg_ha: Number(v.kg_ha),
        })),
    [variedadesKpi],
  )

  const desvioData = useMemo(
    () =>
      parcelasFiltradas
        .filter((p) => p.desvio_plan_pct != null)
        .map((p) => ({ parcela: p.parcela_nombre, desvio: Number(p.desvio_plan_pct) }))
        .sort((a, b) => b.desvio - a.desvio),
    [parcelasFiltradas],
  )

  const curvaS = useMemo(() => {
    const acum = (rows: { semana: number; kg_total: number }[]) => {
      const sorted = [...rows].sort((a, b) => a.semana - b.semana)
      let sum = 0
      const map = new Map<number, number>()
      for (const r of sorted) {
        sum += r.kg_total
        map.set(r.semana, sum)
      }
      return map
    }
    const actual = acum(semanasActual)
    const anterior = acum(semanasAnterior)
    const semanas = Array.from(new Set([...actual.keys(), ...anterior.keys()])).sort((a, b) => a - b)
    // Carry last cumulative value forward so lines don't drop to gaps
    let lastA: number | null = null
    let lastB: number | null = null
    const result = []
    for (const s of semanas) {
      lastA = actual.get(s) ?? lastA
      lastB = anterior.get(s) ?? lastB
      result.push({ semana: `S${s}`, actual: lastA, anterior: lastB })
    }
    return result
  }, [semanasActual, semanasAnterior])

  const scatterData = useMemo(
    () =>
      parcelasFiltradas
        .filter((p) => p.litros_riego_estimados && p.superficie_ha && p.kg_ha != null)
        .map((p) => ({
          x: Number((p.litros_riego_estimados! / p.superficie_ha! / 1_000_000).toFixed(2)),
          y: Number(p.kg_ha),
          name: p.parcela_nombre,
          variedad: p.variedad,
          lkg: p.litros_por_kg != null ? Number(p.litros_por_kg) : null,
        })),
    [parcelasFiltradas],
  )

  // Progresión semanal (movido acá desde la pestaña Cosecha) — kg por semana
  // sin acumular, sólo de la temporada seleccionada.
  const progresionSemanal = useMemo(
    () => [...semanasActual].sort((a, b) => a.semana - b.semana).map((s) => ({ semana: `S${s.semana}`, kg_total: s.kg_total })),
    [semanasActual],
  )

  // Kg por origen (propio vs. tercero) — de dónde vienen los kilos de la
  // temporada. Viene de cosechaTotales (todos los registros), no de
  // parcelasKpi (que sólo incluye cosechas con parcela propia).
  const origenData = useMemo(
    () => cosechaTotales?.resumen_por_origen ?? [],
    [cosechaTotales],
  )

  // Kg propios = TODO lo cosechado con origen=propio, tenga o no parcela
  // vinculada (a diferencia de kpis.kgTotal, que sólo cuenta lo que tiene
  // parcela — ese número sigue siendo la base del kg/ha, que sí necesita
  // superficie para calcularse).
  const kgPropios = useMemo(
    () => origenData.find((o) => o.origen === 'propio')?.kg_total ?? null,
    [origenData],
  )

  const fmtT = (kg: number) => `${(kg / 1000).toFixed(1)} t`

  // Date.now() no es puro para llamarlo directo en render (rechazado por
  // react-hooks/static-components/impure-render), y useEffect es el lugar
  // correcto para leer el reloj del sistema -- pero un efecto que solo hace
  // setState también choca con react-hooks/set-state-in-effect. Ninguna de
  // las dos reglas tiene un patrón limpio para "refrescar la hora actual
  // cuando cambian los datos"; se desactiva puntualmente.
  // Depende de .length (primitivo), no del array -- `data: alertasCarencia
  // = []` crea un array nuevo en cada render mientras la query está
  // cargando, lo que reactivaría este efecto sin parar (y con Date.now()
  // de por medio, cada disparo generaría un valor distinto, así que nunca
  // se estabilizaría).
  const [alertasNow, setAlertasNow] = useState(() => Date.now())
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAlertasNow(Date.now()) }, [alertasCarencia.length])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard Producción</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            ¿Qué parrales rinden, cuáles no, y a qué costo hídrico? · Campaña {anio}/{anio + 1}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={finca}
            disabled
            title="Se cambia con el selector de Finca del encabezado"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-gray-50 text-gray-600 focus:outline-none"
          >
            <option value={finca}>{FINCA_LABELS[finca] ?? finca}</option>
          </select>
          <select
            value={variedadFilter}
            onChange={(e) => setVariedadFilter(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="todas">Todas las variedades</option>
            {variedadesDisponibles.map((v) => (
              <option key={v} value={v}>{VARIEDAD_LABELS[v] ?? v}</option>
            ))}
          </select>
          <select
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>{y}/{y + 1}</option>)}
          </select>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Kg totales"
          value={cosechaTotales ? fmtT(cosechaTotales.kg_total) : '—'}
          hint="propios + terceros · toda la finca"
        />
        <KpiCard
          label="Kg propios"
          value={kgPropios != null ? fmtT(kgPropios) : '—'}
          hint="con y sin parcela vinculada · toda la finca"
        />
        <KpiCard
          label="Kg/ha promedio"
          value={kpis.kgHa != null ? Math.round(kpis.kgHa).toLocaleString('es-AR') : '—'}
          hint="ponderado por superficie"
        />
        <KpiCard
          label="Eficiencia hídrica"
          value={kpis.litrosPorKg != null ? `${kpis.litrosPorKg.toFixed(0)} L/kg` : '—'}
          hint="estimada (16.000 L/h por válvula)"
        />
        <KpiCard
          label="Avance vs plan"
          value={kpis.avancePlan != null ? `${kpis.avancePlan.toFixed(0)}%` : '—'}
          hint={kpis.avancePlan == null ? 'sin metas cargadas' : 'kg reales / kg plan'}
          tone={kpis.avancePlan == null ? 'neutral' : kpis.avancePlan >= 95 ? 'good' : 'bad'}
        />
      </div>

      {/* Row 1: kg/ha por parral + por variedad */}
      <div className="flex gap-5 items-start flex-wrap">
        <ChartCard title="Kg/ha por parral" subtitle="color = variedad · línea = objetivo plan" flex="1 1 55%">
          {kgHaData.length === 0 ? (
            <EmptyChart msg="Sin cosechas con superficie cargada para esta campaña" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={kgHaData} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="parcela" tick={{ fontSize: 10 }} angle={-40} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} width={60}
                  label={{ value: 'kg/ha', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <Tooltip
                  formatter={(v) => [`${Number(v).toLocaleString('es-AR')} kg/ha`, 'Rinde']}
                  labelFormatter={(l, payload) => {
                    const v = payload?.[0]?.payload?.variedad as string | null
                    return `${l}${v ? ` · ${VARIEDAD_LABELS[v] ?? v}` : ''}`
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                {objetivoKgHa != null && (
                  <ReferenceLine y={objetivoKgHa} stroke="#1f1a17" strokeDasharray="6 4"
                    label={{ value: 'objetivo', fontSize: 10, position: 'right' }} />
                )}
                <Bar dataKey="kg_ha" radius={[3, 3, 0, 0]} maxBarSize={28}>
                  {kgHaData.map((d, i) => <Cell key={i} fill={varColor(d.variedad)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Kg/ha por variedad" subtitle="ponderado por superficie" flex="1 1 38%">
          {variedadData.length === 0 ? (
            <EmptyChart msg="Sin datos por variedad" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={variedadData} margin={{ top: 5, right: 20, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="variedad" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={60} />
                <Tooltip formatter={(v) => [`${Number(v).toLocaleString('es-AR')} kg/ha`, 'Rinde']}
                  contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="kg_ha" radius={[3, 3, 0, 0]} maxBarSize={40}>
                  {variedadData.map((d, i) => <Cell key={i} fill={varColor(d.key)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 2: curva S + desvío vs plan */}
      <div className="flex gap-5 items-start flex-wrap">
        <ChartCard title="Avance de cosecha acumulado" subtitle={`kg acumulados por semana · ${anio}/${anio + 1} vs ${anio - 1}/${anio} · toda la finca (no filtra por variedad)`} flex="1 1 55%">
          {curvaS.length === 0 ? (
            <EmptyChart msg="Sin registros de cosecha con semana cargada" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={curvaS} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="semana" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={70}
                  tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}t`} />
                <Tooltip formatter={(v, name) => [fmtT(Number(v)),
                  name === 'actual' ? `Campaña ${anio}` : `Campaña ${anio - 1}`]}
                  contentStyle={{ fontSize: 12 }} />
                <Legend formatter={(v) => (v === 'actual' ? `Campaña ${anio}/${anio + 1}` : `Campaña ${anio - 1}/${anio}`)} />
                <Line type="monotone" dataKey="actual" stroke="#7a1f2c" strokeWidth={2} dot={false} connectNulls />
                <Line type="monotone" dataKey="anterior" stroke="#a09584" strokeWidth={2}
                  strokeDasharray="6 4" dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Desvío de rinde vs plan" subtitle="% sobre kg plan por parral" flex="1 1 38%">
          {desvioData.length === 0 ? (
            <EmptyChart msg="Cargá los kg plan por parral en Producción → Metas para ver desvíos" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={desvioData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} unit="%" domain={[-50, 50]} />
                <YAxis type="category" dataKey="parcela" tick={{ fontSize: 10 }} width={110} />
                <Tooltip formatter={(v) => [`${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}%`, 'Desvío']}
                  contentStyle={{ fontSize: 12 }} />
                <ReferenceLine x={0} stroke="#5a544c" />
                <Bar dataKey="desvio" radius={[0, 3, 3, 0]} maxBarSize={18}>
                  {desvioData.map((d, i) => (
                    <Cell key={i} fill={d.desvio < -25 ? '#a3293a' : d.desvio < -10 ? '#c89a3a' : '#3f5c3a'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 3: eficiencia hídrica + mix destino */}
      <div className="flex gap-5 items-start flex-wrap">
        <ChartCard title="Eficiencia hídrica por parral"
          subtitle="millones de L/ha aplicados (estimado) vs kg/ha · abajo-derecha = mucha agua, poco rinde" flex="1 1 55%">
          {scatterData.length === 0 ? (
            <EmptyChart msg="Sin registros de riego para la campaña seleccionada" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 5, right: 20, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" dataKey="x" tick={{ fontSize: 11 }}
                  label={{ value: 'millones L/ha (estimado)', position: 'insideBottom', offset: -10, fontSize: 11 }} />
                <YAxis type="number" dataKey="y" tick={{ fontSize: 11 }}
                  label={{ value: 'kg/ha', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }) => {
                    if (!payload?.length) return null
                    const d = payload[0].payload as (typeof scatterData)[0]
                    return (
                      <div className="bg-white border border-gray-200 rounded-lg shadow p-3 text-xs">
                        <p className="font-semibold text-gray-800">{d.name}</p>
                        <p className="text-gray-600">Agua: {d.x} M L/ha</p>
                        <p className="text-gray-600">Rinde: {d.y.toLocaleString('es-AR')} kg/ha</p>
                        {d.lkg != null && <p className="text-green-700 font-semibold">{d.lkg} L/kg</p>}
                      </div>
                    )
                  }}
                />
                <Scatter data={scatterData}>
                  {scatterData.map((d, i) => <Cell key={i} fill={varColor(d.variedad)} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Mix por destino" subtitle="kg por destino comercial · toda la finca (no filtra por variedad)" flex="1 1 38%">
          {!cosechaTotales || cosechaTotales.kg_total === 0 ? (
            <EmptyChart msg="Sin cosechas registradas" />
          ) : (
            <div className="space-y-1.5 pt-2">
              {cosechaTotales.resumen_por_destino.map((d) => {
                const pct = Math.round((d.kg_total / cosechaTotales.kg_total) * 100)
                return (
                  <div key={d.destino} className="flex items-center gap-2 text-xs">
                    <span className="w-28 text-gray-500 truncate">
                      {DESTINO_LABELS[d.destino as DestinoCosecha] ?? d.destino}
                    </span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                      <div className="h-2.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: '#7a1f2c' }} />
                    </div>
                    <span className="w-16 text-right font-medium text-gray-700">{fmtT(d.kg_total)}</span>
                    <span className="w-8 text-right text-gray-400">{pct}%</span>
                  </div>
                )
              })}
            </div>
          )}
        </ChartCard>
      </div>

      {/* Row 4: progresión semanal (movido desde Cosecha) + origen de los kilos */}
      <div className="flex gap-5 items-start flex-wrap">
        <ChartCard title="Progresión Semanal" subtitle={`kg cosechados por semana · ${anio}/${anio + 1} · toda la finca (no filtra por variedad)`} flex="1 1 55%">
          {progresionSemanal.length === 0 ? (
            <EmptyChart msg="Sin registros de cosecha con semana cargada" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={progresionSemanal} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="semana" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={55} tickFormatter={(v) => `${(Number(v) / 1000).toFixed(0)}t`} />
                <Tooltip formatter={(v) => [fmtT(Number(v)), 'Cosechado']} labelFormatter={(l) => `Semana ${l}`}
                  contentStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="kg_total" stroke="#2563eb" strokeWidth={2}
                  fill="#dbeafe" fillOpacity={0.4} dot={{ r: 3, fill: '#2563eb' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Origen de los kilos" subtitle="propio vs. comprado a terceros · toda la finca (no filtra por variedad)" flex="1 1 38%">
          {origenData.length === 0 || !cosechaTotales || cosechaTotales.kg_total === 0 ? (
            <EmptyChart msg="Sin cosechas registradas" />
          ) : (
            <div className="space-y-3 pt-2">
              {origenData.map((o) => {
                const pct = Math.round((o.kg_total / cosechaTotales.kg_total) * 100)
                const color = o.origen === 'propio' ? '#3f5c3a' : '#c89a3a'
                return (
                  <div key={o.origen}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-gray-700">
                        {o.origen === 'propio' ? 'Propio' : 'Tercero (comprado)'}
                      </span>
                      <span className="text-gray-500">{fmtT(o.kg_total)} · {pct}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-3">
                      <div className="h-3 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                )
              })}
              <p className="text-xs text-gray-400 pt-1">{cosechaTotales.n_registros} remitos en total</p>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Alertas carencia (operational, kept from previous dashboard) */}
      {alertasCarencia.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-800">
              Aplicaciones con período de carencia vigente ({alertasCarencia.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {alertasCarencia.map((f) => {
              const diasRestantes = Math.ceil(
                (new Date(f.fecha_habilitacion_cosecha).getTime() - alertasNow) / 86400000,
              )
              const textCls = diasRestantes <= 7 ? 'text-red-700' : diasRestantes <= 15 ? 'text-amber-700' : 'text-green-700'
              return (
                <div key={f.id} className="bg-white rounded-md p-3 border border-amber-200">
                  <p className="text-sm font-semibold text-gray-800">{f.producto_nombre}</p>
                  <p className={`text-xs font-semibold ${textCls} mt-1`}>
                    {diasRestantes} días — habilita {f.fecha_habilitacion_cosecha.split('-').reverse().join('/')}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
