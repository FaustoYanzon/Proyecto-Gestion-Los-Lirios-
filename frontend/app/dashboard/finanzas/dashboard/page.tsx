'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart, BarChart, Bar, Cell, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Legend,
} from 'recharts'
import { TIPO_EGRESO_LABELS } from '@/lib/api/egresos'
import type { TipoEgreso } from '@/lib/api/egresos'
import { getPresupuestoVsReal, getKpiCompradores } from '@/lib/api/kpis'

// ── Constants ─────────────────────────────────────────────────────────────────

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const AVAILABLE_YEARS = [DEFAULT_YEAR - 2, DEFAULT_YEAR - 1, DEFAULT_YEAR]

const MESES_ORDER = [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4]
const MES_LABELS: Record<number, string> = {
  5: 'May', 6: 'Jun', 7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Oct',
  11: 'Nov', 12: 'Dic', 1: 'Ene', 2: 'Feb', 3: 'Mar', 4: 'Abr',
}

const NUM_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const fmtMoney = (n: number, moneda: string) =>
  `${moneda === 'usd' ? 'US$' : '$'}${NUM_FMT.format(n)}`
const fmtM = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M` : NUM_FMT.format(n)

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
      {subtitle ? <p className="text-xs text-gray-400 mb-3">{subtitle}</p> : <div className="mb-3" />}
      {children}
    </div>
  )
}

const EmptyChart = ({ msg }: { msg: string }) => (
  <div className="flex items-center justify-center h-64 text-gray-400 text-sm text-center px-6">{msg}</div>
)

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FinanceDashboardPage() {
  const [anio, setAnio] = useState(DEFAULT_YEAR)
  const [moneda, setMoneda] = useState<'ars' | 'usd'>('ars')
  // Month-range filter expressed as positions in the campaign order (0 = May, 11 = Apr)
  const [mesDesdeIdx, setMesDesdeIdx] = useState(0)
  const [mesHastaIdx, setMesHastaIdx] = useState(11)
  const [tipoFilter, setTipoFilter] = useState<string>('todos')

  const { data: pvr = [] } = useQuery({
    queryKey: ['kpi-presup-real', anio, moneda, 'media_agua'],
    queryFn: () => getPresupuestoVsReal({ temporada: anio, moneda, finca: 'media_agua' }),
    staleTime: 60_000,
  })

  const { data: compradores = [] } = useQuery({
    queryKey: ['kpi-compradores', anio, 'media_agua'],
    queryFn: () => getKpiCompradores(anio, 'media_agua'),
    staleTime: 300_000,
  })

  // ── Derived data ───────────────────────────────────────────────────────────

  const inRange = (mes: number) => {
    const idx = MESES_ORDER.indexOf(mes)
    return idx >= mesDesdeIdx && idx <= mesHastaIdx
  }

  // Rows after filters: month range applies to everything below; the tipo
  // filter only narrows egreso lines (ingresos have no tipo).
  const pvrFiltrado = useMemo(
    () =>
      pvr.filter((r) =>
        inRange(r.mes) &&
        (tipoFilter === 'todos' || r.concepto === 'ingreso' || r.tipo === tipoFilter),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pvr, mesDesdeIdx, mesHastaIdx, tipoFilter],
  )

  // Aggregate the view rows (per tipo) up to month level
  const porMes = useMemo(() => {
    const meses = MESES_ORDER.slice(mesDesdeIdx, mesHastaIdx + 1)
    const base = meses.map((m) => ({
      mes: m, label: MES_LABELS[m],
      egresoPresup: 0, egresoReal: 0, ingresoPresup: 0, ingresoReal: 0,
    }))
    const idx = new Map(base.map((r) => [r.mes, r]))
    for (const row of pvrFiltrado) {
      const r = idx.get(row.mes)
      if (!r) continue
      if (row.concepto === 'egreso') {
        r.egresoPresup += Number(row.monto_presupuesto)
        r.egresoReal += Number(row.monto_real)
      } else {
        r.ingresoPresup += Number(row.monto_presupuesto)
        r.ingresoReal += Number(row.monto_real)
      }
    }
    let acum = 0
    return base.map((r) => {
      acum += r.ingresoReal - r.egresoReal
      return {
        ...r,
        desvioPct: r.egresoPresup > 0 ? ((r.egresoReal - r.egresoPresup) / r.egresoPresup) * 100 : null,
        saldo: r.ingresoReal - r.egresoReal,
        saldoAcum: acum,
      }
    })
  }, [pvrFiltrado, mesDesdeIdx, mesHastaIdx])

  const hayPresupuesto = useMemo(() => pvr.some((r) => Number(r.monto_presupuesto) > 0), [pvr])
  const hayReal = useMemo(() => pvr.some((r) => Number(r.monto_real) > 0), [pvr])

  // Current campaign month (calendar month of "today")
  const mesActual = now.getMonth() + 1
  const kpiMes = porMes.find((r) => r.mes === mesActual)

  // Accumulated deviation per expense tipo across the selected range
  const desvioPorTipo = useMemo(() => {
    const acc = new Map<string, { presup: number; real: number }>()
    for (const row of pvrFiltrado) {
      if (row.concepto !== 'egreso' || !row.tipo) continue
      const cur = acc.get(row.tipo) ?? { presup: 0, real: 0 }
      cur.presup += Number(row.monto_presupuesto)
      cur.real += Number(row.monto_real)
      acc.set(row.tipo, cur)
    }
    return Array.from(acc.entries())
      .filter(([, v]) => v.presup > 0)
      .map(([tipo, v]) => ({
        tipo: TIPO_EGRESO_LABELS[tipo as TipoEgreso] ?? tipo,
        desvio: ((v.real - v.presup) / v.presup) * 100,
        impacto: v.real - v.presup,
      }))
      .sort((a, b) => Math.abs(b.impacto) - Math.abs(a.impacto))
  }, [pvrFiltrado])

  const compradoresData = useMemo(
    () =>
      compradores
        .filter((c) => c.kg_entregados > 0 || c.monto_cobrado_ars > 0 || c.monto_cobrado_usd > 0)
        .slice(0, 12),
    [compradores],
  )
  const maxKg = Math.max(1, ...compradoresData.map((c) => c.kg_entregados))

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard Finanzas</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            ¿Cumplimos el presupuesto del mes y en qué categoría se escapa? · Campaña {anio}/{anio + 1}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={tipoFilter}
            onChange={(e) => setTipoFilter(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="todos">Todos los tipos de egreso</option>
            {(Object.keys(TIPO_EGRESO_LABELS) as TipoEgreso[]).map((t) => (
              <option key={t} value={t}>{TIPO_EGRESO_LABELS[t]}</option>
            ))}
          </select>
          <div className="flex items-center gap-1 text-sm">
            <select
              value={mesDesdeIdx}
              onChange={(e) => {
                const v = Number(e.target.value)
                setMesDesdeIdx(v)
                if (v > mesHastaIdx) setMesHastaIdx(v)
              }}
              className="rounded-md border border-gray-300 px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {MESES_ORDER.map((m, i) => <option key={m} value={i}>{MES_LABELS[m]}</option>)}
            </select>
            <span className="text-gray-400">→</span>
            <select
              value={mesHastaIdx}
              onChange={(e) => {
                const v = Number(e.target.value)
                setMesHastaIdx(v)
                if (v < mesDesdeIdx) setMesDesdeIdx(v)
              }}
              className="rounded-md border border-gray-300 px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {MESES_ORDER.map((m, i) => <option key={m} value={i}>{MES_LABELS[m]}</option>)}
            </select>
          </div>
          <div className="flex rounded-md border border-gray-300 overflow-hidden text-sm">
            {(['ars', 'usd'] as const).map((m) => (
              <button key={m} onClick={() => setMoneda(m)}
                className={`px-3 py-2 font-semibold ${moneda === m ? 'text-white' : 'text-gray-600 bg-white hover:bg-gray-50'}`}
                style={moneda === m ? { backgroundColor: '#7a1f2c' } : undefined}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>
          <select
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>{y}/{y + 1}</option>)}
          </select>
          <select
            value="media_agua"
            disabled
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-gray-50 text-gray-600 focus:outline-none"
          >
            <option value="media_agua">Media Agua</option>
          </select>
        </div>
      </div>

      {!hayPresupuesto && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
          No hay presupuesto cargado para esta campaña en {moneda.toUpperCase()} — los desvíos aparecen
          cuando lo cargues en <span className="font-semibold">Finanzas → Presupuesto</span>.
        </div>
      )}

      {/* KPI cards (current month) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label={`Cumplimiento ${MES_LABELS[mesActual] ?? ''}`}
          value={
            kpiMes && kpiMes.egresoPresup > 0
              ? `${((kpiMes.egresoReal / kpiMes.egresoPresup) * 100).toFixed(0)}%`
              : '—'
          }
          hint="egresos reales / presupuesto"
          tone={
            !kpiMes || kpiMes.egresoPresup === 0 ? 'neutral'
              : kpiMes.egresoReal <= kpiMes.egresoPresup * 1.1 ? 'good' : 'bad'
          }
        />
        <KpiCard
          label={`Egresos ${MES_LABELS[mesActual] ?? ''}`}
          value={kpiMes ? fmtMoney(kpiMes.egresoReal, moneda) : '—'}
          hint={moneda === 'ars' ? 'USD aparte — usá el selector' : undefined}
        />
        <KpiCard
          label={`Ingresos ${MES_LABELS[mesActual] ?? ''}`}
          value={kpiMes ? fmtMoney(kpiMes.ingresoReal, moneda) : '—'}
        />
        <KpiCard
          label={mesDesdeIdx === 0 && mesHastaIdx === 11 ? 'Saldo acumulado campaña' : 'Saldo acumulado (rango)'}
          value={fmtMoney(porMes.at(-1)?.saldoAcum ?? 0, moneda)}
          hint={kpiMes ? `mes: ${fmtMoney(kpiMes.saldo, moneda)}` : undefined}
          tone={(porMes.at(-1)?.saldoAcum ?? 0) >= 0 ? 'good' : 'bad'}
        />
      </div>

      {/* Row 1: presupuesto vs real + desvío por tipo */}
      <div className="flex gap-5 items-start flex-wrap">
        <ChartCard title="Egresos: presupuesto vs real por mes"
          subtitle={`${moneda.toUpperCase()} · línea = desvío %`} flex="1 1 55%">
          {!hayReal && !hayPresupuesto ? (
            <EmptyChart msg="Sin egresos ni presupuesto para esta campaña/moneda" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={porMes} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={55} tickFormatter={(v) => fmtM(Number(v))} />
                <YAxis yAxisId="pct" orientation="right" tick={{ fontSize: 11 }} width={40} unit="%" />
                <Tooltip
                  formatter={(v, name) => {
                    if (name === 'Desvío %') return [`${Number(v).toFixed(1)}%`, name]
                    return [fmtMoney(Number(v), moneda), name]
                  }}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend />
                <Bar dataKey="egresoPresup" name="Presupuesto" fill="#e6c8cd" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Bar dataKey="egresoReal" name="Real" fill="#7a1f2c" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Line yAxisId="pct" dataKey="desvioPct" name="Desvío %" stroke="#c89a3a"
                  strokeWidth={2} dot={{ r: 2 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Desvío acumulado por tipo de egreso"
          subtitle="% sobre presupuesto · ordenado por impacto en plata" flex="1 1 38%">
          {desvioPorTipo.length === 0 ? (
            <EmptyChart msg="Cargá el presupuesto en Finanzas → Presupuesto para ver desvíos por categoría" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={desvioPorTipo} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} unit="%" />
                <YAxis type="category" dataKey="tipo" tick={{ fontSize: 10 }} width={120} />
                <Tooltip
                  formatter={(v, _n, item) => [
                    `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}% (${fmtMoney(item.payload.impacto, moneda)})`,
                    'Desvío',
                  ]}
                  contentStyle={{ fontSize: 12 }}
                />
                <ReferenceLine x={0} stroke="#5a544c" />
                <Bar dataKey="desvio" radius={[0, 3, 3, 0]} maxBarSize={18}>
                  {desvioPorTipo.map((d, i) => (
                    <Cell key={i} fill={Math.abs(d.desvio) > 25 ? '#a3293a' : Math.abs(d.desvio) > 10 ? '#c89a3a' : '#3f5c3a'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 2: flujo mensual + compradores */}
      <div className="flex gap-5 items-start flex-wrap">
        <ChartCard title="Flujo de caja mensual" subtitle={`${moneda.toUpperCase()} · línea = saldo acumulado`} flex="1 1 55%">
          {!hayReal ? (
            <EmptyChart msg="Sin movimientos registrados para esta campaña/moneda" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={porMes} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={55} tickFormatter={(v) => fmtM(Number(v))} />
                <Tooltip formatter={(v, name) => [fmtMoney(Number(v), moneda), name]} contentStyle={{ fontSize: 12 }} />
                <Legend />
                <Bar dataKey="ingresoReal" name="Ingresos" fill="#3f5c3a" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Bar dataKey="egresoReal" name="Egresos" fill="#9a3140" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Line dataKey="saldoAcum" name="Saldo acum." stroke="#1f1a17" strokeWidth={2} dot={false} />
                <ReferenceLine y={0} stroke="#5a544c" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Kg entregados vs cobrado por comprador"
          subtitle="cruce cosecha × ingresos (por nombre) · kg sin cobros = alerta de cobranza" flex="1 1 38%">
          {compradoresData.length === 0 ? (
            <EmptyChart msg="Sin cosechas con comprador ni cobros registrados" />
          ) : (
            <div className="space-y-2 pt-1">
              {compradoresData.map((c) => (
                <div key={c.comprador} className="text-xs">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-semibold text-gray-700 truncate">{c.comprador}</span>
                    <span className="text-gray-500">
                      {(c.kg_entregados / 1000).toFixed(1)} t ·{' '}
                      <span className={c.kg_entregados > 0 && c.monto_cobrado_ars === 0 && c.monto_cobrado_usd === 0
                        ? 'text-red-700 font-semibold' : 'text-gray-700 font-medium'}>
                        {fmtMoney(c.monto_cobrado_ars, 'ars')}
                        {c.monto_cobrado_usd > 0 && ` + ${fmtMoney(c.monto_cobrado_usd, 'usd')}`}
                      </span>
                    </span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-2">
                    <div className="h-2 rounded-full"
                      style={{ width: `${(c.kg_entregados / maxKg) * 100}%`, backgroundColor: '#7a1f2c' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      <p className="text-xs text-gray-400">
        ARS y USD nunca se suman: cambiá de moneda con el selector. Comparaciones entre campañas → usar USD.
      </p>
    </div>
  )
}
