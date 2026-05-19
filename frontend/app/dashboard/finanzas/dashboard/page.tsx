'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { AlertTriangle, TrendingUp } from 'lucide-react'
import { getEgresos, TIPO_EGRESO_VALUES, TIPO_EGRESO_LABELS } from '@/lib/api/egresos'

// ── Constants ─────────────────────────────────────────────────────────────────

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const AVAILABLE_YEARS = Array.from({ length: DEFAULT_YEAR - 2020 + 1 }, (_, i) => DEFAULT_YEAR - i)

const FINCA_OPTIONS = [
  { value: 'los_mimbres', label: 'Los Mimbres' },
  { value: 'media_agua', label: 'Media Agua' },
  { value: 'caucete', label: 'Caucete' },
]
const FINCA_LABELS: Record<string, string> = {
  los_mimbres: 'Los Mimbres', media_agua: 'Media Agua', caucete: 'Caucete',
}
const ORIGEN_OPTIONS = [
  { value: 'oficial', label: 'Oficial' },
  { value: 'no_oficial', label: 'No Oficial' },
]
const PIE_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2']
const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const NUM_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

function fmtARS(n: number) { return `$${NUM_FMT.format(n)}` }
function fmtM(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toggleSet(prev: Set<string>, v: string): Set<string> {
  const next = new Set(prev)
  next.has(v) ? next.delete(v) : next.add(v)
  return next
}

interface FilterState {
  desde: string; hasta: string
  origenes: Set<string>; fincas: Set<string>; tipos: Set<string>
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string
  color: 'blue' | 'green' | 'red' | 'purple'
}) {
  const cls = {
    blue:   { border: 'border-l-blue-500',   val: 'text-blue-600' },
    green:  { border: 'border-l-green-500',  val: 'text-green-600' },
    red:    { border: 'border-l-red-500',    val: 'text-red-600' },
    purple: { border: 'border-l-purple-500', val: 'text-purple-600' },
  }[color]
  return (
    <div className={`bg-white rounded-lg border border-gray-200 border-l-4 ${cls.border} shadow-sm p-4`}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${cls.val}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
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

export default function FinanceDashboardPage() {
  const [anio, setAnio] = useState(DEFAULT_YEAR)
  const [groupBy, setGroupBy] = useState<'mes' | 'trimestre'>('mes')

  const campaignDesde = `${anio}-05-01`
  const campaignHasta = `${anio + 1}-04-30`

  // Pending filter state (form values, not yet applied)
  const [pDesde, setPDesde] = useState(campaignDesde)
  const [pHasta, setPHasta] = useState(campaignHasta)
  const [pOrigenes, setPOrigenes] = useState<Set<string>>(new Set())
  const [pFincas, setPFincas] = useState<Set<string>>(new Set())
  const [pTipos, setPTipos] = useState<Set<string>>(new Set())

  // Applied filter state (drives computed values)
  const [applied, setApplied] = useState<FilterState>({
    desde: campaignDesde, hasta: campaignHasta,
    origenes: new Set(), fincas: new Set(), tipos: new Set(),
  })

  // Reset when campaign year changes
  useEffect(() => {
    const desde = `${anio}-05-01`
    const hasta = `${anio + 1}-04-30`
    setPDesde(desde); setPHasta(hasta)
    setPOrigenes(new Set()); setPFincas(new Set()); setPTipos(new Set())
    setApplied({ desde, hasta, origenes: new Set(), fincas: new Set(), tipos: new Set() })
  }, [anio])

  // Fetch full campaign egresos in ARS (client-side filter applies on top)
  const { data: egresos = [] } = useQuery({
    queryKey: ['finanzas-dash-egresos', anio],
    queryFn: () => getEgresos({ fecha_desde: campaignDesde, fecha_hasta: campaignHasta, moneda: 'ars', limit: 1000 }),
    staleTime: 60_000,
  })

  // ── Client-side filter ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let data = egresos
    if (applied.desde) data = data.filter((e) => e.fecha >= applied.desde)
    if (applied.hasta) data = data.filter((e) => e.fecha <= applied.hasta)
    if (applied.origenes.size > 0) data = data.filter((e) => applied.origenes.has(e.origen))
    if (applied.fincas.size > 0)   data = data.filter((e) => applied.fincas.has(e.finca))
    if (applied.tipos.size > 0)    data = data.filter((e) => applied.tipos.has(e.tipo))
    return data
  }, [egresos, applied])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const gastoTotal     = useMemo(() => filtered.reduce((s, e) => s + Number(e.monto), 0), [filtered])
  const gastoOficial   = useMemo(() => filtered.filter((e) => e.origen === 'oficial').reduce((s, e) => s + Number(e.monto), 0), [filtered])
  const gastoNoOficial = useMemo(() => filtered.filter((e) => e.origen === 'no_oficial').reduce((s, e) => s + Number(e.monto), 0), [filtered])
  const ivaEstimado    = gastoOficial * 0.21

  // ── Monthly evolution ────────────────────────────────────────────────────
  const monthlyEvolution = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of filtered) {
      const key = groupBy === 'mes'
        ? e.fecha.slice(0, 7)
        : `${e.fecha.slice(0, 4)}-Q${Math.ceil(Number(e.fecha.slice(5, 7)) / 3)}`
      map[key] = (map[key] ?? 0) + Number(e.monto)
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, total]) => {
        let periodo: string
        if (groupBy === 'mes') {
          const [, m] = key.split('-')
          periodo = MONTH_NAMES[Number(m) - 1]
        } else {
          periodo = key.replace('-', ' ')
        }
        return { periodo, total }
      })
  }, [filtered, groupBy])

  // ── Estacionalidad ───────────────────────────────────────────────────────
  const estacionalidad = useMemo(() => {
    if (monthlyEvolution.length < 2) return null
    const sorted = [...monthlyEvolution].sort((a, b) => b.total - a.total)
    return { pico: sorted[0], bajo: sorted[sorted.length - 1] }
  }, [monthlyEvolution])

  // ── Aumentos significativos (last 2 months, per tipo) ────────────────────
  const aumentos = useMemo(() => {
    const months = [...new Set(filtered.map((e) => e.fecha.slice(0, 7)))].sort()
    if (months.length < 2) return []
    const lastM = months[months.length - 1]
    const prevM = months[months.length - 2]
    const results: { label: string; pct: number }[] = []

    for (const tipo of TIPO_EGRESO_VALUES) {
      const last = filtered.filter((e) => e.fecha.slice(0, 7) === lastM && e.tipo === tipo).reduce((s, e) => s + Number(e.monto), 0)
      const prev = filtered.filter((e) => e.fecha.slice(0, 7) === prevM && e.tipo === tipo).reduce((s, e) => s + Number(e.monto), 0)
      if (prev > 0 && last > prev * 1.25 && last > 50000) {
        results.push({ label: TIPO_EGRESO_LABELS[tipo], pct: ((last - prev) / prev) * 100 })
      }
    }
    return results.sort((a, b) => b.pct - a.pct).slice(0, 4)
  }, [filtered])

  // ── Distribución por categoría ───────────────────────────────────────────
  const distribCategoria = useMemo(() => {
    const energiaTotal = filtered.filter((e) => e.clasificacion === 'energia_electrica').reduce((s, e) => s + Number(e.monto), 0)
    const sueldosTotal = filtered.filter((e) => e.tipo === 'sueldos_personal').reduce((s, e) => s + Number(e.monto), 0)
    const inversionTotal = filtered.filter((e) => e.tipo === 'inversion').reduce((s, e) => s + Number(e.monto), 0)
    const t = gastoTotal || 1
    return {
      energia:  (energiaTotal  / t) * 100,
      sueldos:  (sueldosTotal  / t) * 100,
      inversion: (inversionTotal / t) * 100,
    }
  }, [filtered, gastoTotal])

  // ── Distribución por finca ───────────────────────────────────────────────
  const fincaData = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of filtered) map[e.finca] = (map[e.finca] ?? 0) + Number(e.monto)
    return Object.entries(map)
      .map(([finca, value]) => ({ name: FINCA_LABELS[finca] ?? finca, value }))
      .sort((a, b) => b.value - a.value)
  }, [filtered])

  function applyFilters() {
    setApplied({
      desde: pDesde, hasta: pHasta,
      origenes: new Set(pOrigenes), fincas: new Set(pFincas), tipos: new Set(pTipos),
    })
  }

  return (
    <div className="flex gap-5 items-start">
      {/* ── Main content ── */}
      <div className="flex-1 space-y-5 min-w-0">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Dashboard Financiero</h1>
            <p className="text-sm text-gray-500 mt-0.5">Análisis de gastos · Campaña {anio}/{anio + 1}</p>
          </div>
          <select
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>{y}/{y + 1}</option>)}
          </select>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Gasto Total" value={fmtARS(gastoTotal)} color="blue" />
          <KpiCard
            label="Gasto Oficial"
            value={fmtARS(gastoOficial)}
            sub={gastoTotal > 0 ? `${((gastoOficial / gastoTotal) * 100).toFixed(1)}% del total` : undefined}
            color="green"
          />
          <KpiCard
            label="Gasto No Oficial"
            value={fmtARS(gastoNoOficial)}
            sub={gastoTotal > 0 ? `${((gastoNoOficial / gastoTotal) * 100).toFixed(1)}% del total` : undefined}
            color="red"
          />
          <KpiCard label="IVA Estimado" value={fmtARS(ivaEstimado)} sub="21% del oficial" color="purple" />
        </div>

        {/* Aumentos + Estacionalidad */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={16} className="text-amber-500" />
              <h3 className="text-sm font-semibold text-gray-700">Aumentos Significativos</h3>
            </div>
            {aumentos.length === 0 ? (
              <p className="text-sm text-gray-400">No hay aumentos significativos detectados</p>
            ) : (
              <div className="space-y-2">
                {aumentos.map((a, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{a.label}</span>
                    <span className="font-semibold text-red-600">+{a.pct.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-blue-50 rounded-lg border border-blue-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={16} className="text-blue-600" />
              <h3 className="text-sm font-semibold text-blue-800">Estacionalidad</h3>
            </div>
            {estacionalidad ? (
              <div className="space-y-2">
                <div className="bg-white rounded-md px-3 py-2.5">
                  <p className="text-xs text-gray-500 mb-0.5">Mes Pico Histórico</p>
                  <p className="text-sm font-medium text-blue-700">
                    {estacionalidad.pico.periodo} — {fmtARS(estacionalidad.pico.total)}
                  </p>
                </div>
                <div className="bg-white rounded-md px-3 py-2.5">
                  <p className="text-xs text-gray-500 mb-0.5">Mes Bajo Histórico</p>
                  <p className="text-sm font-medium text-blue-700">
                    {estacionalidad.bajo.periodo} — {fmtARS(estacionalidad.bajo.total)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-blue-400">Sin datos suficientes</p>
            )}
          </div>
        </div>

        {/* Distribución por categoría */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Distribución por Categoría</h3>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: '% Energía',   value: distribCategoria.energia,   color: 'bg-blue-50 text-blue-600 text-blue-700' },
              { label: '% Sueldos',   value: distribCategoria.sueldos,   color: 'bg-green-50 text-green-600 text-green-700' },
              { label: '% Inversión', value: distribCategoria.inversion, color: 'bg-purple-50 text-purple-600 text-purple-700' },
            ].map(({ label, value, color }) => {
              const [bg, lbl, val] = color.split(' ')
              return (
                <div key={label} className={`text-center p-4 rounded-lg ${bg}`}>
                  <p className={`text-xs font-medium mb-1 ${lbl}`}>{label}</p>
                  <p className={`text-3xl font-bold ${val}`}>{value.toFixed(1)}%</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Evolución de gastos + Finca pie */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Evolución de Gastos Totales</h3>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                Agrupar por:
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as 'mes' | 'trimestre')}
                  className="border border-gray-300 rounded px-2 py-1 text-sm bg-white focus:outline-none"
                >
                  <option value="mes">Mes</option>
                  <option value="trimestre">Trimestre</option>
                </select>
              </div>
            </div>
            <div style={{ height: 280 }}>
              {monthlyEvolution.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">Sin datos en el período</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthlyEvolution} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="periodo" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={fmtM} tick={{ fontSize: 11 }} width={70} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="total"
                      stroke="#2563eb"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: '#2563eb', strokeWidth: 0 }}
                      activeDot={{ r: 6 }}
                      name="Gastos"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Distribución por Finca</h3>
            <div style={{ height: 280 }}>
              {fincaData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">Sin datos</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={fincaData}
                      cx="50%"
                      cy="42%"
                      outerRadius={90}
                      dataKey="value"
                      nameKey="name"
                    >
                      {fincaData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                    <Legend formatter={(v) => <span style={{ fontSize: 11 }}>{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* ── Right sidebar filter panel ── */}
      <div className="w-64 flex-shrink-0">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 sticky top-4 space-y-4">
          <h3 className="text-base font-semibold text-gray-900">Filtros</h3>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Fecha desde</label>
            <input
              type="date"
              value={pDesde}
              onChange={(e) => setPDesde(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Fecha hasta</label>
            <input
              type="date"
              value={pHasta}
              onChange={(e) => setPHasta(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Origen</label>
            <CheckboxGroup
              options={ORIGEN_OPTIONS}
              selected={pOrigenes}
              onChange={(v) => setPOrigenes((p) => toggleSet(p, v))}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Finca</label>
            <CheckboxGroup
              options={FINCA_OPTIONS}
              selected={pFincas}
              onChange={(v) => setPFincas((p) => toggleSet(p, v))}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5">Tipo</label>
            <CheckboxGroup
              options={TIPO_EGRESO_VALUES.map((t) => ({ value: t, label: TIPO_EGRESO_LABELS[t] }))}
              selected={pTipos}
              onChange={(v) => setPTipos((p) => toggleSet(p, v))}
            />
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
  )
}
