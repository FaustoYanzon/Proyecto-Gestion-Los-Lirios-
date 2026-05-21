'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { AlertTriangle, Leaf } from 'lucide-react'
import {
  getEstadoActual,
  getRendimientoHistorico,
  getEficienciaHidrica,
} from '@/lib/api/produccion'
import type { EficienciaHidricaParcela } from '@/lib/api/produccion'
import { getAlertasCarencia } from '@/lib/api/fitosanitarios'

// ── Constants ─────────────────────────────────────────────────────────────────

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const AVAILABLE_YEARS = [DEFAULT_YEAR - 2, DEFAULT_YEAR - 1, DEFAULT_YEAR]

const FENOLOGIA_LABELS: Record<string, string> = {
  brotacion: 'Brotación', floracion: 'Floración', cuaje: 'Cuaje',
  envero: 'Envero', madurez: 'Madurez', cosecha: 'Cosecha', latencia: 'Latencia',
}
const FENOLOGIA_STYLES: Record<string, string> = {
  brotacion:  'bg-lime-100 text-lime-800',
  floracion:  'bg-yellow-100 text-yellow-800',
  cuaje:      'bg-orange-100 text-orange-800',
  envero:     'bg-amber-100 text-amber-800',
  madurez:    'bg-green-100 text-green-800',
  cosecha:    'bg-red-100 text-red-800',
  latencia:   'bg-gray-100 text-gray-600',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScatterPoint {
  x: number
  y: number | null
  name: string
  eficiencia: number | null
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProduccionDashboardPage() {
  const [anio, setAnio] = useState(DEFAULT_YEAR)

  const { data: estadoActual = [] } = useQuery({
    queryKey: ['estado-actual'],
    queryFn: getEstadoActual,
    staleTime: 120_000,
  })

  const { data: alertasCarencia = [] } = useQuery({
    queryKey: ['alertas-carencia'],
    queryFn: () => getAlertasCarencia(),
    staleTime: 60_000,
  })

  const { data: rendimiento = [] } = useQuery({
    queryKey: ['rendimiento-historico', anio],
    queryFn: () => getRendimientoHistorico([anio - 1, anio]),
    staleTime: 300_000,
  })

  const { data: eficiencia = [] } = useQuery({
    queryKey: ['eficiencia-hidrica', anio],
    queryFn: () => getEficienciaHidrica(anio),
    staleTime: 300_000,
  })

  // ── Derived data ─────────────────────────────────────────────────────────

  const rendimientoChartData = useMemo(() =>
    rendimiento
      .filter((p) => p.campanas.some((c) => c.rendimiento_kg_ha !== null))
      .map((p) => {
        const entry: Record<string, unknown> = { parcela: p.parcela_nombre }
        for (const c of p.campanas) {
          entry[`anio_${c.anio}`] = c.rendimiento_kg_ha
        }
        return entry
      }),
  [rendimiento])

  const scatterData = useMemo((): ScatterPoint[] =>
    (eficiencia as EficienciaHidricaParcela[])
      .filter((p) => p.mm_aplicados_total > 0 && p.rendimiento_kg_ha !== null)
      .map((p) => ({
        x: p.mm_aplicados_total,
        y: p.rendimiento_kg_ha,
        name: p.parcela_nombre,
        eficiencia: p.eficiencia_kg_por_mm,
      })),
  [eficiencia])

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard Producción</h1>
          <p className="text-sm text-gray-500 mt-0.5">Campaña {anio}/{anio + 1}</p>
        </div>
        <select
          value={anio}
          onChange={(e) => setAnio(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>{y}/{y + 1}</option>)}
        </select>
      </div>

      {/* Alertas carencia */}
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
              const today = new Date()
              const habilitacion = new Date(f.fecha_habilitacion_cosecha)
              const diasRestantes = Math.ceil((habilitacion.getTime() - today.getTime()) / 86400000)
              const color = diasRestantes <= 7 ? 'red' : diasRestantes <= 15 ? 'amber' : 'green'
              const borderCls = color === 'red' ? 'border-red-200' : color === 'amber' ? 'border-amber-200' : 'border-green-200'
              const textCls = color === 'red' ? 'text-red-700' : color === 'amber' ? 'text-amber-700' : 'text-green-700'
              return (
                <div key={f.id} className={`bg-white rounded-md p-3 border ${borderCls}`}>
                  <p className="text-sm font-semibold text-gray-800">{f.producto_nombre}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Parcela: {f.parcela_id}</p>
                  <p className={`text-xs font-semibold ${textCls} mt-1`}>
                    {diasRestantes} días restantes — habilita {f.fecha_habilitacion_cosecha.split('-').reverse().join('/')}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Estado fenológico actual */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Leaf size={15} className="text-green-600" />
          <h3 className="text-sm font-semibold text-gray-700">Estado Fenológico Actual</h3>
        </div>
        {estadoActual.length === 0 ? (
          <p className="text-sm text-gray-400">No hay estados fenológicos registrados</p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {estadoActual.map((e) => (
              <div key={e.parcela_id} className="flex-shrink-0 bg-gray-50 rounded-lg p-3 border border-gray-200 w-44">
                <p className="text-sm font-semibold text-gray-800 truncate">{e.parcela_nombre}</p>
                {e.estado_fenologico ? (
                  <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${FENOLOGIA_STYLES[e.estado_fenologico] ?? 'bg-gray-100 text-gray-700'}`}>
                    {FENOLOGIA_LABELS[e.estado_fenologico] ?? e.estado_fenologico}
                  </span>
                ) : (
                  <span className="inline-block mt-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
                    Sin estado
                  </span>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  {e.fecha_estado ? e.fecha_estado.split('-').reverse().join('/') : '—'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Charts row */}
      <div className="flex gap-5 items-start">

        {/* Rendimiento histórico — grouped bar chart */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5" style={{ flex: '0 0 55%' }}>
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Rendimiento Histórico (kg/ha)</h3>
          {rendimientoChartData.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Sin datos de rendimiento</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={rendimientoChartData} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="parcela" tick={{ fontSize: 10 }} angle={-40} textAnchor="end" interval={0} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  width={60}
                  label={{ value: 'kg/ha', angle: -90, position: 'insideLeft', fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v, name) => [
                    v ? `${Number(v).toFixed(0)} kg/ha` : 'Sin datos',
                    String(name).replace('anio_', ''),
                  ]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend formatter={(v) => String(v).replace('anio_', 'Campaña ')} />
                <Bar dataKey={`anio_${anio - 1}`} fill="#94a3b8" radius={[3, 3, 0, 0]} maxBarSize={20} />
                <Bar dataKey={`anio_${anio}`} fill="#16a34a" radius={[3, 3, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Eficiencia hídrica — scatter chart */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5" style={{ flex: '0 0 45%' }}>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Eficiencia Hídrica</h3>
          <p className="text-xs text-gray-400 mb-4">mm aplicados vs rendimiento kg/ha · Campaña {anio}/{anio + 1}</p>
          {scatterData.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
              Sin datos de riego para la campaña seleccionada
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 5, right: 20, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="mm aplicados"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'mm aplicados', position: 'insideBottom', offset: -10, fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="kg/ha"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'kg/ha', angle: -90, position: 'insideLeft', fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }) => {
                    if (!payload?.length) return null
                    const d = payload[0].payload as ScatterPoint
                    return (
                      <div className="bg-white border border-gray-200 rounded-lg shadow p-3 text-xs">
                        <p className="font-semibold text-gray-800">{d.name}</p>
                        <p className="text-gray-600">mm aplicados: {d.x?.toFixed(1)}</p>
                        <p className="text-gray-600">Rendimiento: {d.y?.toFixed(0)} kg/ha</p>
                        {d.eficiencia != null && (
                          <p className="text-green-700 font-semibold">Efic.: {d.eficiencia.toFixed(2)} kg/mm</p>
                        )}
                      </div>
                    )
                  }}
                />
                <Scatter data={scatterData} fill="#2563eb" opacity={0.8} />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>
    </div>
  )
}
