'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Legend, BarChart, Bar,
} from 'recharts'
import { DollarSign, Users, Star, TrendingUp } from 'lucide-react'
import { getTrabajos, getParcelas, TEMPORADA_LABELS } from '@/lib/api/produccion'
import { getEgresos } from '@/lib/api/egresos'
import { formatParcelaLabel } from '@/lib/api/produccion'

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_HA = 51
const NUM_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const NUM_FMT2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const TEMPORADA_COLORS: Record<string, string> = {
  verano: '#f97316', invierno: '#3b82f6', primavera: '#22c55e',
  otono: '#f59e0b', general: '#94a3b8',
}

const TEMPORADA_COLORS_AREA: Record<string, string> = {
  verano: '#f97316', invierno: '#3b82f6', primavera: '#22c55e',
  otono: '#f59e0b', general: '#94a3b8',
}

const CLASES = ['verano', 'invierno', 'primavera', 'otono', 'general'] as const

const TEMPORADA_OPTIONS = [
  { value: 'general',   label: 'General' },
  { value: 'verano',    label: 'Verano' },
  { value: 'otono',     label: 'Otoño' },
  { value: 'invierno',  label: 'Invierno' },
  { value: 'primavera', label: 'Primavera' },
]

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtARS(n: number) {
  return `$${NUM_FMT.format(n)}`
}
function fmtARS2(n: number) {
  return `$${NUM_FMT2.format(n)}`
}
function fmtM(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}
function isoToday() {
  return new Date().toISOString().split('T')[0]
}
function isoCampaignStart() {
  const now = new Date()
  const year = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
  return `${year}-05-01`
}

function toggleSet(prev: Set<string>, v: string): Set<string> {
  const next = new Set(prev)
  next.has(v) ? next.delete(v) : next.add(v)
  return next
}

interface AppliedFilters {
  desde: string; hasta: string
  temporadas: Set<string>
  tarea: string
  parcelaId: string
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, iconBg }: {
  label: string; value: string; sub?: string
  icon: React.ReactNode; iconBg: string
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex items-center gap-4">
      <div className={`p-2.5 rounded-lg flex-shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-gray-900 truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
      </div>
    </div>
  )
}

function CheckboxGroup({
  options, selected, onChange,
}: {
  options: { value: string; label: string }[]
  selected: Set<string>
  onChange: (v: string) => void
}) {
  return (
    <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-44 overflow-y-auto">
      {options.map((opt) => (
        <label key={opt.value} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.has(opt.value)}
            onChange={() => onChange(opt.value)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">{opt.label}</span>
        </label>
      ))}
    </div>
  )
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      {label && <p className="font-semibold text-gray-700 mb-1">{label}</p>}
      <p className="font-mono text-blue-700">{fmtARS(payload[0].value)}</p>
    </div>
  )
}

function PieTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number }[] }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gray-700">{payload[0].name}</p>
      <p className="font-mono text-gray-800 mt-0.5">{fmtARS(payload[0].value)}</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ManoDeObraPage() {
  const [activeTab, setActiveTab] = useState<'jornales' | 'movimientos'>('jornales')
  const [verPor, setVerPor] = useState<'mes' | 'semana'>('mes')

  // Pending filter state (form)
  const [pDesde, setPDesde] = useState(isoCampaignStart())
  const [pHasta, setPHasta] = useState(isoToday())
  const [pTemporadas, setPTemporadas] = useState<Set<string>>(new Set())
  const [pTarea, setPTarea] = useState('')
  const [pParcelaId, setPParcelaId] = useState('')

  // Applied filter state (drives queries)
  const [applied, setApplied] = useState<AppliedFilters>({
    desde: isoCampaignStart(),
    hasta: isoToday(),
    temporadas: new Set(),
    tarea: '',
    parcelaId: '',
  })

  function applyFilters() {
    setApplied({
      desde: pDesde, hasta: pHasta,
      temporadas: new Set(pTemporadas),
      tarea: pTarea,
      parcelaId: pParcelaId,
    })
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas'],
    queryFn: getParcelas,
    staleTime: 300_000,
  })

  const { data: trabajos = [], isLoading: loadingTrabajos } = useQuery({
    queryKey: ['mdo-trabajos', applied.desde, applied.hasta, applied.tarea, applied.parcelaId],
    queryFn: () => getTrabajos({
      fecha_desde: applied.desde,
      fecha_hasta: applied.hasta,
      tarea: applied.tarea || undefined,
      parcela_id: applied.parcelaId || undefined,
      limit: 1000,
    }),
    staleTime: 30_000,
  })

  const { data: movimientos = [], isLoading: loadingMov } = useQuery({
    queryKey: ['mdo-movimientos', applied.desde, applied.hasta],
    queryFn: () => getEgresos({
      fecha_desde: applied.desde,
      fecha_hasta: applied.hasta,
      tipo: 'sueldos_personal',
      clasificacion: 'obreros',
      moneda: 'ars',
      limit: 1000,
    }),
    enabled: activeTab === 'movimientos',
    staleTime: 30_000,
  })

  // ── Client-side temporada filter ─────────────────────────────────────────

  const filtered = useMemo(
    () => applied.temporadas.size === 0
      ? trabajos
      : trabajos.filter((t) => applied.temporadas.has(t.clasificacion)),
    [trabajos, applied.temporadas]
  )

  // ── KPIs ─────────────────────────────────────────────────────────────────

  const costoTotal = useMemo(() => filtered.reduce((s, t) => s + Number(t.monto_total), 0), [filtered])

  const trabajadoresActivos = useMemo(
    () => new Set(filtered.map((t) => t.trabajador_nombre)).size,
    [filtered]
  )

  const masProductivo = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of filtered) {
      map[t.trabajador_nombre] = (map[t.trabajador_nombre] ?? 0) + Number(t.monto_total)
    }
    const entries = Object.entries(map)
    if (!entries.length) return null
    entries.sort((a, b) => b[1] - a[1])
    return { nombre: entries[0][0], monto: entries[0][1] }
  }, [filtered])

  const costoPorHa = costoTotal / TOTAL_HA

  // ── Stacked evolution by temporada ───────────────────────────────────────

  const stackedEvolutionData = useMemo(() => {
    if (verPor === 'mes') {
      const map: Record<string, Record<string, number>> = {}
      for (const t of filtered) {
        const key = t.fecha.slice(0, 7)
        if (!map[key]) map[key] = {}
        map[key][t.clasificacion] = (map[key][t.clasificacion] ?? 0) + Number(t.monto_total)
      }
      return Object.entries(map)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, byClase]) => {
          const m = Number(key.slice(5, 7))
          return { label: MONTH_NAMES[m - 1], ...byClase }
        })
    } else {
      const map: Record<string, Record<string, number>> = {}
      for (const t of filtered) {
        const d = new Date(t.fecha + 'T00:00:00')
        const day = d.getDay()
        const monday = new Date(d)
        monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
        const key = monday.toISOString().split('T')[0]
        if (!map[key]) map[key] = {}
        map[key][t.clasificacion] = (map[key][t.clasificacion] ?? 0) + Number(t.monto_total)
      }
      return Object.entries(map)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, byClase]) => {
          const d = new Date(key + 'T00:00:00')
          return { label: d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }), ...byClase }
        })
    }
  }, [filtered, verPor])

  // ── Temporada distribution ────────────────────────────────────────────────

  const temporadaData = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of filtered) map[t.clasificacion] = (map[t.clasificacion] ?? 0) + Number(t.monto_total)
    return TEMPORADA_OPTIONS
      .map((opt) => ({ name: opt.label, value: map[opt.value] ?? 0, key: opt.value, fill: TEMPORADA_COLORS[opt.value] ?? '#94a3b8' }))
      .filter((d) => d.value > 0)
  }, [filtered])

  // ── Resumen por tarea ─────────────────────────────────────────────────────

  const resumenTareas = useMemo(() => {
    const map: Record<string, { registros: number; costoTotal: number; cantidad: number; clasificacion: string }> = {}
    for (const t of filtered) {
      if (!map[t.tarea]) map[t.tarea] = { registros: 0, costoTotal: 0, cantidad: 0, clasificacion: t.clasificacion }
      map[t.tarea].registros++
      map[t.tarea].costoTotal += Number(t.monto_total)
      map[t.tarea].cantidad += Number(t.cantidad)
    }
    const total = Object.values(map).reduce((s, v) => s + v.costoTotal, 0) || 1
    return Object.entries(map)
      .map(([tarea, d]) => ({
        tarea,
        clasificacion: d.clasificacion,
        registros: d.registros,
        costoTotal: d.costoTotal,
        costoPromedio: d.costoTotal / d.registros,
        eficiencia: d.cantidad > 0 ? d.costoTotal / d.cantidad : 0,
        pctTotal: (d.costoTotal / total) * 100,
      }))
      .sort((a, b) => b.costoTotal - a.costoTotal)
  }, [filtered])

  // ── Top 10 trabajadores ───────────────────────────────────────────────────

  const top10Trabajadores = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of filtered) map[t.trabajador_nombre] = (map[t.trabajador_nombre] ?? 0) + Number(t.monto_total)
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .reverse()
      .map(([nombre, monto]) => ({ nombre, monto }))
  }, [filtered])

  const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="space-y-5">

      {/* Header + tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Análisis de Jornales</h1>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-gray-300">
          {(['jornales', 'movimientos'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors capitalize ${
                activeTab === tab
                  ? 'bg-gray-800 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'jornales' && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Costo Total"
              value={fmtARS2(costoTotal)}
              icon={<DollarSign size={20} className="text-blue-600" />}
              iconBg="bg-blue-50"
            />
            <KpiCard
              label="Trabajadores Activos"
              value={String(trabajadoresActivos)}
              icon={<Users size={20} className="text-green-600" />}
              iconBg="bg-green-50"
            />
            <KpiCard
              label="Más Productivo"
              value={masProductivo?.nombre ?? 'N/A'}
              sub={masProductivo ? fmtARS(masProductivo.monto) : '$0'}
              icon={<Star size={20} className="text-amber-500" />}
              iconBg="bg-amber-50"
            />
            <KpiCard
              label="Costo por Hectárea"
              value={fmtARS(costoPorHa)}
              sub={`${TOTAL_HA} ha parrales`}
              icon={<TrendingUp size={20} className="text-purple-600" />}
              iconBg="bg-purple-50"
            />
          </div>

          {/* Chart + filter sidebar */}
          <div className="flex gap-5 items-start">
            <div className="flex-1 space-y-5 min-w-0">
            {/* Evolución de costos */}
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-700">Evolución de Costos</h3>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  Ver por:
                  <select
                    value={verPor}
                    onChange={(e) => setVerPor(e.target.value as 'mes' | 'semana')}
                    className="border border-gray-300 rounded px-2 py-1 text-sm bg-white focus:outline-none"
                  >
                    <option value="mes">Mes</option>
                    <option value="semana">Semana</option>
                  </select>
                </div>
              </div>
              <div style={{ height: 280 }}>
                {loadingTrabajos ? (
                  <div className="h-full bg-gray-50 animate-pulse rounded" />
                ) : stackedEvolutionData.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">Sin registros en el período</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stackedEvolutionData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={fmtM} tick={{ fontSize: 11 }} width={70} />
                      <Tooltip
                        formatter={(value, name) => [fmtARS(Number(value ?? 0)), TEMPORADA_LABELS[String(name)] ?? String(name)]}
                        contentStyle={{ fontSize: 12 }}
                      />
                      <Legend formatter={(v) => TEMPORADA_LABELS[v] ?? v} />
                      {CLASES.map((clase) => (
                        <Area
                          key={clase}
                          type="monotone"
                          dataKey={clase}
                          stackId="1"
                          stroke={TEMPORADA_COLORS_AREA[clase]}
                          fill={TEMPORADA_COLORS_AREA[clase]}
                          fillOpacity={0.7}
                          name={clase}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Top 10 trabajadores por costo */}
            {top10Trabajadores.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">Top 10 Trabajadores por Costo</h3>
                <ResponsiveContainer width="100%" height={Math.max(top10Trabajadores.length * 34 + 20, 180)}>
                  <BarChart
                    data={top10Trabajadores}
                    layout="vertical"
                    margin={{ top: 0, right: 70, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="nombre" tick={{ fontSize: 11, fill: '#374151' }} width={130} />
                    <Tooltip formatter={(v) => [fmtARS(Number(v ?? 0)), 'Total ARS']} contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="monto" fill="#7c3aed" radius={[0, 4, 4, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            </div>

            {/* Filter sidebar */}
            <div className="w-64 flex-shrink-0">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 sticky top-4 space-y-4">
                <h3 className="text-base font-semibold text-gray-900">Filtros</h3>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Fecha Desde</label>
                  <input type="date" value={pDesde} onChange={(e) => setPDesde(e.target.value)} className={inputCls} />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Fecha Hasta</label>
                  <input type="date" value={pHasta} onChange={(e) => setPHasta(e.target.value)} className={inputCls} />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Temporada</label>
                  <CheckboxGroup
                    options={TEMPORADA_OPTIONS}
                    selected={pTemporadas}
                    onChange={(v) => setPTemporadas((p) => toggleSet(p, v))}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Tarea</label>
                  <input
                    type="text"
                    value={pTarea}
                    onChange={(e) => setPTarea(e.target.value)}
                    placeholder="Filtrar por tarea..."
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Ubicación</label>
                  <select value={pParcelaId} onChange={(e) => setPParcelaId(e.target.value)} className={inputCls}>
                    <option value="">Todas las parcelas</option>
                    {parcelas.filter((p) => p.is_active).map((p) => (
                      <option key={p.id} value={p.id}>{formatParcelaLabel(p.nombre)}</option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={applyFilters}
                  className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Aplicar Filtros
                </button>

              </div>
            </div>
          </div>

          {/* Costos por Tarea (top 10 horizontal bar) */}
          {resumenTareas.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Costos por Tarea</h3>
              <ResponsiveContainer width="100%" height={Math.min(resumenTareas.length * 34 + 20, 360)}>
                <BarChart
                  data={resumenTareas.slice(0, 10).map((t) => ({ tarea: t.tarea, monto: t.costoTotal, fill: TEMPORADA_COLORS[t.clasificacion] ?? '#94a3b8' }))}
                  layout="vertical"
                  margin={{ top: 0, right: 70, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="tarea" tick={{ fontSize: 11, fill: '#374151' }} width={120} />
                  <Tooltip formatter={(v) => [fmtARS(Number(v ?? 0)), 'Total ARS']} contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="monto" radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
              {/* Leyenda temporadas */}
              <div className="flex flex-wrap gap-3 mt-3">
                {Object.entries(TEMPORADA_LABELS).map(([k, v]) => (
                  <span key={k} className="flex items-center gap-1 text-xs text-gray-500">
                    <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: TEMPORADA_COLORS[k] }} />
                    {v}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Distribución + Análisis por Temporada */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Distribución por Temporada</h3>
              <div style={{ height: 260 }}>
                {temporadaData.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">Sin datos</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={temporadaData}
                        cx="50%"
                        cy="45%"
                        outerRadius={90}
                        dataKey="value"
                        nameKey="name"
                      />
                      <Tooltip content={<PieTooltip />} />
                      <Legend formatter={(v) => <span style={{ fontSize: 11 }}>{v}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Análisis por Temporada</h3>
              <div style={{ height: 260 }}>
                {temporadaData.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm">Sin datos</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={temporadaData} layout="vertical" margin={{ top: 0, right: 70, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={fmtM} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Resumen por Tarea tabla */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">Resumen por Tarea</h3>
              <span className="text-xs text-gray-400">{filtered.length} registros totales</span>
            </div>
            {resumenTareas.length === 0 ? (
              <p className="px-5 py-8 text-center text-gray-400 text-sm">Sin registros en el período</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tarea</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Registros</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Costo Total</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Costo Promedio</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Eficiencia</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">% del Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {resumenTareas.map((t) => (
                      <tr key={t.tarea} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-medium text-gray-800">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-full flex-shrink-0"
                              style={{ background: TEMPORADA_COLORS[t.clasificacion] ?? '#94a3b8' }}
                            />
                            {t.tarea}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{t.registros}</td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-green-700">{fmtARS(t.costoTotal)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-600">{fmtARS(t.costoPromedio)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-600">{fmtARS(t.eficiencia)}/u</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-gray-100 rounded-full h-1.5">
                              <div
                                className="bg-blue-500 h-1.5 rounded-full"
                                style={{ width: `${Math.min(t.pctTotal, 100)}%` }}
                              />
                            </div>
                            <span className="text-gray-600 font-mono text-xs w-10 text-right">
                              {t.pctTotal.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Movimientos tab */}
      {activeTab === 'movimientos' && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Movimientos — Sueldos Obreros</h3>
            <p className="text-xs text-gray-400 mt-0.5">Egresos auto-generados por registros de tarea diaria</p>
          </div>
          {loadingMov ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : movimientos.length === 0 ? (
            <p className="px-5 py-10 text-center text-gray-400 text-sm">No hay movimientos en el período seleccionado</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2.5 font-medium text-gray-500">Fecha</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-500">Descripción</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-500">Finca</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-500">Forma Pago</th>
                    <th className="text-right px-4 py-2.5 font-medium text-gray-500">Monto ARS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {movimientos.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                        {m.fecha.split('-').reverse().join('/')}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{m.descripcion ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600 capitalize">{m.finca.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2.5 text-gray-600 capitalize">{m.forma_pago}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-green-700">
                        {fmtARS(Number(m.monto))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 text-sm text-gray-500">
            {movimientos.length} movimiento{movimientos.length !== 1 ? 's' : ''} ·{' '}
            Total: <span className="font-mono font-semibold text-green-700">
              {fmtARS(movimientos.reduce((s, m) => s + Number(m.monto), 0))}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
