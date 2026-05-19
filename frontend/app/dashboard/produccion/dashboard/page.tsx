'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  getTrabajos, getParcelas, formatParcelaLabel,
  TAREAS_POR_TEMPORADA, TEMPORADA_LABELS,
} from '@/lib/api/produccion'

const CLASIFICACION_COLORS: Record<string, string> = {
  verano: '#f97316', invierno: '#3b82f6', primavera: '#22c55e',
  otono: '#f59e0b', general: '#94a3b8',
}

const now = new Date()
const isoToday = now.toISOString().split('T')[0]
const currentCampaignYear = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1

function isoDate(d: Date) { return d.toISOString().split('T')[0] }

function shortcutFrom(days: number) {
  const d = new Date(now)
  d.setDate(d.getDate() - days)
  return isoDate(d)
}

function formatARS(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

function fmtM(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n}`
}

function KpiCard({ label, value, sub, color = 'gray' }: {
  label: string; value: string; sub?: string; color?: 'green' | 'blue' | 'amber' | 'gray'
}) {
  const colors = {
    green: 'text-green-700', blue: 'text-blue-700', amber: 'text-amber-700', gray: 'text-gray-800',
  }
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colors[color]}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

const TODAS_TAREAS = Array.from(new Set(Object.values(TAREAS_POR_TEMPORADA).flat())).sort()

const SHORTCUTS = [
  { label: 'Esta campaña', from: `${currentCampaignYear}-05-01`, to: isoToday },
  { label: 'Campaña ant.', from: `${currentCampaignYear - 1}-05-01`, to: `${currentCampaignYear}-04-30` },
  { label: '90 días', from: shortcutFrom(90), to: isoToday },
  { label: '30 días', from: shortcutFrom(30), to: isoToday },
]

const inputCls = 'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500'

export default function ProduccionDashboard() {
  const [fechaDesde, setFechaDesde] = useState(`${currentCampaignYear - 1}-05-01`)
  const [fechaHasta, setFechaHasta] = useState(isoToday)
  const [clasificacion, setClasificacion] = useState('')
  const [tarea, setTarea] = useState('')
  const [parcelaId, setParcelaId] = useState('')

  const params = {
    fecha_desde: fechaDesde,
    fecha_hasta: fechaHasta,
    ...(clasificacion && { clasificacion }),
    ...(tarea && { tarea }),
    ...(parcelaId && { parcela_id: parcelaId }),
    limit: 1000,
  }

  const { data: trabajos = [], isLoading } = useQuery({
    queryKey: ['trabajos-dash', params],
    queryFn: () => getTrabajos(params),
    staleTime: 60_000,
  })

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas'],
    queryFn: getParcelas,
    staleTime: 5 * 60_000,
  })

  const totalCosto = useMemo(() => trabajos.reduce((s, t) => s + Number(t.monto_total), 0), [trabajos])
  const totalJornales = useMemo(() => trabajos.reduce((s, t) => s + Number(t.cantidad), 0), [trabajos])
  const uniqueWorkers = useMemo(() => new Set(trabajos.map((t) => t.trabajador_nombre)).size, [trabajos])
  const uniqueTasks = useMemo(() => new Set(trabajos.map((t) => t.tarea)).size, [trabajos])

  const monthlyData = useMemo(() => {
    const map: Record<string, { mes: string; costo: number; jornales: number }> = {}
    for (const t of trabajos) {
      const [y, m] = t.fecha.split('-')
      const key = `${y}-${m}`
      if (!map[key]) {
        const d = new Date(t.fecha + 'T00:00:00')
        const mes = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' })
        map[key] = { mes, costo: 0, jornales: 0 }
      }
      map[key].costo += Number(t.monto_total)
      map[key].jornales += Number(t.cantidad)
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)
  }, [trabajos])

  const tareaData = useMemo(() => {
    const map: Record<string, { costo: number; clasificacion: string }> = {}
    for (const t of trabajos) {
      if (!map[t.tarea]) map[t.tarea] = { costo: 0, clasificacion: t.clasificacion }
      map[t.tarea].costo += Number(t.monto_total)
    }
    return Object.entries(map)
      .map(([tarea, { costo, clasificacion }]) => ({ tarea, costo, clasificacion }))
      .sort((a, b) => b.costo - a.costo)
      .slice(0, 10)
      .reverse()
  }, [trabajos])

  const parcelaData = useMemo(() => {
    const parcelaMap = Object.fromEntries(parcelas.map((p) => [p.id, formatParcelaLabel(p.nombre)]))
    const map: Record<string, number> = {}
    for (const t of trabajos) {
      const nombre = t.parcela_id ? (parcelaMap[t.parcela_id] ?? 'Desconocida') : 'General'
      map[nombre] = (map[nombre] ?? 0) + Number(t.monto_total)
    }
    return Object.entries(map)
      .map(([nombre, costo]) => ({ nombre, costo }))
      .sort((a, b) => b.costo - a.costo)
      .slice(0, 10)
      .reverse()
  }, [trabajos, parcelas])

  const hasSubFilters = !!(clasificacion || tarea || parcelaId)

  return (
    <div className="space-y-6">
      {/* Header + fecha */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard Producción</h1>
        <div className="flex flex-wrap items-center gap-2">
          {SHORTCUTS.map((s) => (
            <button
              key={s.label}
              onClick={() => { setFechaDesde(s.from); setFechaHasta(s.to) }}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              {s.label}
            </button>
          ))}
          <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className={inputCls} />
          <span className="text-gray-400 text-sm">→</span>
          <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className={inputCls} />
        </div>
      </div>

      {/* Sub-filtros */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Temporada</label>
          <select value={clasificacion} onChange={(e) => setClasificacion(e.target.value)} className={inputCls}>
            <option value="">Todas</option>
            {Object.entries(TEMPORADA_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Tarea</label>
          <select value={tarea} onChange={(e) => setTarea(e.target.value)} className={inputCls}>
            <option value="">Todas</option>
            {TODAS_TAREAS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Parcela</label>
          <select value={parcelaId} onChange={(e) => setParcelaId(e.target.value)} className={inputCls}>
            <option value="">Todas</option>
            {parcelas.filter((p) => p.is_active).map((p) => (
              <option key={p.id} value={p.id}>{formatParcelaLabel(p.nombre)}</option>
            ))}
          </select>
        </div>
        {hasSubFilters && (
          <button
            onClick={() => { setClasificacion(''); setTarea(''); setParcelaId('') }}
            className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total pagado" value={formatARS(totalCosto)} sub="mano de obra directa" color="amber" />
        <KpiCard label="Total jornales" value={Number(totalJornales).toFixed(1)} sub="unidades acumuladas" color="green" />
        <KpiCard label="Trabajadores" value={String(uniqueWorkers)} sub="activos en período" color="blue" />
        <KpiCard label="Tipos de tarea" value={String(uniqueTasks)} sub="distintas realizadas" color="gray" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-64 bg-gray-50 animate-pulse rounded-lg border border-gray-200" />
          ))}
        </div>
      ) : trabajos.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-12 text-center">
          <p className="text-gray-400">Sin registros para el período y filtros seleccionados.</p>
          <p className="text-sm text-gray-400 mt-1">Probá ampliar el rango de fechas o quitá algunos filtros.</p>
        </div>
      ) : (
        <>
          {/* Costo mensual */}
          {monthlyData.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Costo mensual (ARS)</h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthlyData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={fmtM} tick={{ fontSize: 11 }} width={65} />
                  <Tooltip
                    formatter={(v, name) => [
                      name === 'costo' ? formatARS(Number(v ?? 0)) : Number(v ?? 0).toFixed(1),
                      name === 'costo' ? 'Costo ARS' : 'Jornales',
                    ]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Bar dataKey="costo" fill="#16a34a" radius={[4, 4, 0, 0]} maxBarSize={44} name="costo" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Top tareas */}
            {tareaData.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Costo por tarea (top 10)</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={tareaData} layout="vertical" margin={{ top: 0, right: 55, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="tarea" tick={{ fontSize: 11, fill: '#374151' }} width={115} />
                    <Tooltip formatter={(v) => [formatARS(Number(v ?? 0)), 'Total ARS']} contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="costo" radius={[0, 4, 4, 0]} maxBarSize={22}>
                      {tareaData.map((d, i) => (
                        <Cell key={i} fill={CLASIFICACION_COLORS[d.clasificacion] ?? '#94a3b8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-3 mt-2">
                  {Object.entries(TEMPORADA_LABELS).map(([k, v]) => (
                    <span key={k} className="flex items-center gap-1 text-xs text-gray-500">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CLASIFICACION_COLORS[k] }} />
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Top parcelas */}
            {parcelaData.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Costo por parcela (top 10)</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={parcelaData} layout="vertical" margin={{ top: 0, right: 55, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="nombre" tick={{ fontSize: 11, fill: '#374151' }} width={115} />
                    <Tooltip formatter={(v) => [formatARS(Number(v ?? 0)), 'Total ARS']} contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="costo" fill="#3b82f6" radius={[0, 4, 4, 0]} maxBarSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Tabla resumen por trabajador */}
          {trabajos.length > 0 && (() => {
            const map: Record<string, { jornales: number; costo: number }> = {}
            for (const t of trabajos) {
              if (!map[t.trabajador_nombre]) map[t.trabajador_nombre] = { jornales: 0, costo: 0 }
              map[t.trabajador_nombre].jornales += Number(t.cantidad)
              map[t.trabajador_nombre].costo += Number(t.monto_total)
            }
            const rows = Object.entries(map)
              .map(([nombre, { jornales, costo }]) => ({ nombre, jornales, costo }))
              .sort((a, b) => b.costo - a.costo)
            return (
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-700">Resumen por trabajador</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left px-4 py-2.5 font-medium text-gray-500">#</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-500">Trabajador</th>
                        <th className="text-right px-4 py-2.5 font-medium text-gray-500">Jornales</th>
                        <th className="text-right px-4 py-2.5 font-medium text-gray-500">Total ARS</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500">Participación</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {rows.map((r, i) => {
                        const pct = totalCosto > 0 ? (r.costo / totalCosto) * 100 : 0
                        return (
                          <tr key={r.nombre} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                            <td className="px-4 py-2.5 font-medium text-gray-800">{r.nombre}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-gray-600">{r.jornales.toFixed(1)}</td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-green-700">{formatARS(r.costo)}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-16">
                                  <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs text-gray-400 w-10 text-right">{pct.toFixed(0)}%</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}
