'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { getResumenPorTarea, getResumenPorTrabajador } from '@/lib/api/produccion'
import {
  getKpiManoObraMensual, getKpiManoObraParcelas, getKpiManoObraParcelasMes,
  getKpiProduccionParcelas, getPresupuestoVsReal,
} from '@/lib/api/kpis'

// ── Constants ─────────────────────────────────────────────────────────────────

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const AVAILABLE_YEARS = [DEFAULT_YEAR - 2, DEFAULT_YEAR - 1, DEFAULT_YEAR]

const MESES_ORDER = [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4]
const MES_LABELS: Record<number, string> = {
  5: 'May', 6: 'Jun', 7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Oct',
  11: 'Nov', 12: 'Dic', 1: 'Ene', 2: 'Feb', 3: 'Mar', 4: 'Abr',
}

const CLASIF_LABELS: Record<string, string> = {
  verano: 'Verano (cosecha/pasero)',
  invierno: 'Invierno (poda/atada)',
  primavera: 'Primavera (verde/raleo)',
  otono: 'Otoño (murones)',
  general: 'General (riego/jornal)',
}
const CLASIF_COLORS: Record<string, string> = {
  verano: '#c89a3a',
  invierno: '#3d6b86',
  primavera: '#3f5c3a',
  otono: '#8a5a2b',
  general: '#a09584',
}
const CLASIFS = ['invierno', 'primavera', 'verano', 'otono', 'general']

const NUM_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const fmtARS = (n: number) => `$${NUM_FMT.format(n)}`
const fmtM = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `$${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M` : fmtARS(n)

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

export default function ManoObraDashboardPage() {
  const [anio, setAnio] = useState(DEFAULT_YEAR)
  const [clasifFilter, setClasifFilter] = useState<string>('todas')
  // Month-range filter as positions in the campaign order (0 = May, 11 = Apr)
  const [mesDesdeIdx, setMesDesdeIdx] = useState(0)
  const [mesHastaIdx, setMesHastaIdx] = useState(11)

  // Convert campaign positions to real dates (months >= May belong to `anio`)
  const mesDesde = MESES_ORDER[mesDesdeIdx]
  const mesHasta = MESES_ORDER[mesHastaIdx]
  const campanaDesde = `${mesDesde >= 5 ? anio : anio + 1}-${String(mesDesde).padStart(2, '0')}-01`
  const finHasta = new Date(mesHasta >= 5 ? anio : anio + 1, mesHasta, 0).getDate()
  const campanaHasta = `${mesHasta >= 5 ? anio : anio + 1}-${String(mesHasta).padStart(2, '0')}-${finHasta}`

  const { data: moMensual = [] } = useQuery({
    queryKey: ['kpi-mo-mensual', anio],
    queryFn: () => getKpiManoObraMensual(anio),
    staleTime: 300_000,
  })

  const { data: moParcelas = [] } = useQuery({
    queryKey: ['kpi-mo-parcelas', anio],
    queryFn: () => getKpiManoObraParcelas(anio),
    staleTime: 300_000,
  })

  const { data: tareas = [] } = useQuery({
    queryKey: ['mo-tareas', campanaDesde, campanaHasta],
    queryFn: () => getResumenPorTarea({ fecha_desde: campanaDesde, fecha_hasta: campanaHasta }),
    staleTime: 300_000,
  })

  const { data: trabajadores = [] } = useQuery({
    queryKey: ['mo-trabajadores', campanaDesde, campanaHasta],
    queryFn: () => getResumenPorTrabajador({ fecha_desde: campanaDesde, fecha_hasta: campanaHasta }),
    staleTime: 300_000,
  })

  // Current calendar month range, for "empleado del mes"
  const mesActualDesde = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const ultimoDia = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const mesActualHasta = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${ultimoDia}`

  const { data: trabajadoresMesActual = [] } = useQuery({
    queryKey: ['mo-trabajadores-mes', mesActualDesde],
    queryFn: () => getResumenPorTrabajador({ fecha_desde: mesActualDesde, fecha_hasta: mesActualHasta }),
    staleTime: 300_000,
  })

  const { data: parcelasMes = [] } = useQuery({
    queryKey: ['kpi-mo-parcelas-mes', anio],
    queryFn: () => getKpiManoObraParcelasMes(anio),
    staleTime: 300_000,
  })

  const { data: pvr = [] } = useQuery({
    queryKey: ['kpi-presup-real', anio, 'ars'],
    queryFn: () => getPresupuestoVsReal({ temporada: anio, moneda: 'ars' }),
    staleTime: 300_000,
  })

  const { data: parcelasKpi = [] } = useQuery({
    queryKey: ['kpi-prod-parcelas', anio],
    queryFn: () => getKpiProduccionParcelas(anio),
    staleTime: 300_000,
  })

  // ── Derived data ───────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const mesActual = now.getMonth() + 1
    const delMes = moMensual.filter((r) => r.mes === mesActual)
    const jornalesMes = delMes.reduce((s, r) => s + Number(r.jornales ?? 0), 0)
    const costoMes = delMes.reduce((s, r) => s + Number(r.monto), 0)
    const moTotal = moMensual.reduce((s, r) => s + Number(r.monto), 0)
    const egresosTotal = pvr
      .filter((r) => r.concepto === 'egreso')
      .reduce((s, r) => s + Number(r.monto_real), 0)
    const kgTotal = parcelasKpi.reduce((s, p) => s + p.kg_total, 0)
    return {
      jornalesMes,
      costoMes,
      moTotal,
      pctSobreEgresos: egresosTotal > 0 ? (moTotal / egresosTotal) * 100 : null,
      costoPorKg: kgTotal > 0 ? moTotal / kgTotal : null,
    }
  }, [moMensual, pvr, parcelasKpi])

  const clasifsVisibles = clasifFilter === 'todas' ? CLASIFS : [clasifFilter]

  const mensualData = useMemo(() => {
    const meses = MESES_ORDER.slice(mesDesdeIdx, mesHastaIdx + 1)
    const base = meses.map((m) => {
      const row: Record<string, number | string> = { label: MES_LABELS[m], mes: m }
      for (const c of CLASIFS) row[c] = 0
      return row
    })
    const idx = new Map(base.map((r) => [r.mes as number, r]))
    for (const r of moMensual) {
      if (clasifFilter !== 'todas' && r.clasificacion !== clasifFilter) continue
      const row = idx.get(r.mes)
      if (row) row[r.clasificacion] = Number(row[r.clasificacion] ?? 0) + Number(r.monto)
    }
    return base
  }, [moMensual, clasifFilter, mesDesdeIdx, mesHastaIdx])

  const tareasData = useMemo(
    () =>
      tareas
        .filter((t) => clasifFilter === 'todas' || t.clasificacion === clasifFilter)
        .sort((a, b) => Number(b.monto_total) - Number(a.monto_total))
        .slice(0, 10)
        .map((t) => ({
          tarea: t.tarea,
          monto: Number(t.monto_total),
          clasificacion: t.clasificacion,
        })),
    [tareas, clasifFilter],
  )

  const trabajadoresData = useMemo(
    () =>
      [...trabajadores]
        .sort((a, b) => Number(b.monto_total) - Number(a.monto_total))
        .slice(0, 10)
        .map((t) => ({
          nombre: t.trabajador_nombre,
          monto: Number(t.monto_total),
          jornales: Number(t.total_jornales),
        })),
    [trabajadores],
  )

  // "Empleado del mes" = most jornales worked this calendar month
  // (jornales, not $: piecework rates would bias a money ranking)
  const empleadoDelMes = useMemo(() => {
    if (trabajadoresMesActual.length === 0) return null
    return [...trabajadoresMesActual].sort(
      (a, b) => Number(b.total_jornales) - Number(a.total_jornales),
    )[0]
  }, [trabajadoresMesActual])

  // Heatmap: parcela rows x campaign-month columns, intensity = monto
  const heatmap = useMemo(() => {
    const porParcela = new Map<string, { nombre: string; meses: Record<number, number> }>()
    let max = 0
    for (const r of parcelasMes) {
      const cur = porParcela.get(r.parcela_id) ?? { nombre: r.parcela_nombre, meses: {} }
      cur.meses[r.mes] = (cur.meses[r.mes] ?? 0) + Number(r.monto)
      if (cur.meses[r.mes] > max) max = cur.meses[r.mes]
      porParcela.set(r.parcela_id, cur)
    }
    const filas = Array.from(porParcela.values())
      .map((p) => ({
        ...p,
        total: Object.values(p.meses).reduce((s, v) => s + v, 0),
      }))
      .sort((a, b) => b.total - a.total)
    return { filas, max }
  }, [parcelasMes])

  const parcelasData = useMemo(
    () =>
      moParcelas
        .filter((p) => p.monto_por_ha != null)
        .sort((a, b) => Number(b.monto_por_ha) - Number(a.monto_por_ha))
        .map((p) => ({
          parcela: p.parcela_nombre,
          montoHa: Number(p.monto_por_ha),
          jornales: Number(p.jornales ?? 0),
        })),
    [moParcelas],
  )

  const hayDatos = moMensual.length > 0

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Dashboard Mano de Obra</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            ¿Cuánto cuesta la MO, en qué tareas se va y qué parral es caro de trabajar? · Campaña {anio}/{anio + 1}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={clasifFilter}
            onChange={(e) => setClasifFilter(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="todas">Todas las estaciones</option>
            {CLASIFS.map((c) => <option key={c} value={c}>{CLASIF_LABELS[c]}</option>)}
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard
          label={`Jornales ${MES_LABELS[now.getMonth() + 1] ?? 'mes'}`}
          value={NUM_FMT.format(kpis.jornalesMes)}
          hint="solo registros por día"
        />
        <KpiCard
          label={`Costo MO ${MES_LABELS[now.getMonth() + 1] ?? 'mes'}`}
          value={fmtM(kpis.costoMes)}
          hint="incluye tanto (plantas, metros...)"
        />
        <KpiCard
          label="MO / egresos totales"
          value={kpis.pctSobreEgresos != null ? `${kpis.pctSobreEgresos.toFixed(0)}%` : '—'}
          hint="campaña · registros de trabajo vs egresos"
          tone={kpis.pctSobreEgresos != null && kpis.pctSobreEgresos > 60 ? 'bad' : 'neutral'}
        />
        <KpiCard
          label="Costo MO por kg"
          value={kpis.costoPorKg != null ? `$${kpis.costoPorKg.toFixed(0)}/kg` : '—'}
          hint="MO campaña / kg cosechados"
        />
        <KpiCard
          label="Empleado del mes"
          value={empleadoDelMes ? empleadoDelMes.trabajador_nombre : '—'}
          hint={empleadoDelMes
            ? `${NUM_FMT.format(Number(empleadoDelMes.total_jornales))} jornales en ${MES_LABELS[now.getMonth() + 1]}`
            : 'sin registros este mes'}
          tone="good"
        />
      </div>

      {/* Row 1: MO mensual apilada + top tareas */}
      <div className="flex gap-5 items-start flex-wrap">
        <ChartCard title="Costo MO mensual por estación de tareas"
          subtitle="ARS · apilado por clasificación (invierno = poda, verano = cosecha...)" flex="1 1 55%">
          {!hayDatos ? (
            <EmptyChart msg="Sin registros de trabajo para esta campaña" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={mensualData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={60} tickFormatter={(v) => fmtM(Number(v))} />
                <Tooltip
                  formatter={(v, name) => [fmtM(Number(v)), CLASIF_LABELS[String(name)] ?? name]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend formatter={(v) => CLASIF_LABELS[String(v)] ?? v} wrapperStyle={{ fontSize: 11 }} />
                {clasifsVisibles.map((c) => (
                  <Bar key={c} dataKey={c} stackId="mo" fill={CLASIF_COLORS[c]} maxBarSize={26} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Top 10 tareas por costo" subtitle="ARS acumulado en la campaña" flex="1 1 38%">
          {tareasData.length === 0 ? (
            <EmptyChart msg="Sin tareas registradas" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={tareasData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtM(Number(v))} />
                <YAxis type="category" dataKey="tarea" tick={{ fontSize: 10 }} width={100} />
                <Tooltip formatter={(v) => [fmtM(Number(v)), 'Costo']} contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="monto" radius={[0, 3, 3, 0]} maxBarSize={18}>
                  {tareasData.map((d, i) => (
                    <Cell key={i} fill={CLASIF_COLORS[d.clasificacion] ?? '#a09584'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 2: costo por ha por parcela + top trabajadores */}
      <div className="flex gap-5 items-start flex-wrap">
        <ChartCard title="Costo MO por hectárea, por parcela"
          subtitle="ARS/ha campaña completa (no filtra por mes/estación) · cruzar con kg/ha del Dashboard Producción"
          flex="1 1 55%">
          {parcelasData.length === 0 ? (
            <EmptyChart msg="Sin registros de trabajo asociados a parcelas con superficie cargada" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={parcelasData} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="parcela" tick={{ fontSize: 10 }} angle={-40} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} width={65} tickFormatter={(v) => fmtM(Number(v))} />
                <Tooltip
                  formatter={(v, _n, item) => [
                    `${fmtM(Number(v))}/ha · ${NUM_FMT.format(item.payload.jornales)} jornales`,
                    'Costo MO',
                  ]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="montoHa" fill="#7a1f2c" radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Top 10 trabajadores por costo"
          subtitle="ARS en el rango seleccionado · jornales en el tooltip" flex="1 1 38%">
          {trabajadoresData.length === 0 ? (
            <EmptyChart msg="Sin trabajadores con registros en el rango" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={trabajadoresData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtM(Number(v))} />
                <YAxis type="category" dataKey="nombre" tick={{ fontSize: 10 }} width={110} />
                <Tooltip
                  formatter={(v, _n, item) => [
                    `${fmtM(Number(v))} · ${NUM_FMT.format(item.payload.jornales)} jornales`,
                    'Costo',
                  ]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="monto" fill="#8a5a2b" radius={[0, 3, 3, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Row 3: heatmap parcela x mes */}
      <ChartCard title="Mapa de calor: costo MO por parral y mes"
        subtitle="ARS · más oscuro = más gasto · ordenado por gasto total de campaña">
        {heatmap.filas.length === 0 ? (
          <EmptyChart msg="Sin registros de trabajo asociados a parcelas" />
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs w-full" style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
              <thead>
                <tr>
                  <th className="text-left text-gray-500 font-medium pr-2 whitespace-nowrap">Parcela</th>
                  {MESES_ORDER.map((m) => (
                    <th key={m} className="text-gray-500 font-medium w-[7%] text-center">{MES_LABELS[m]}</th>
                  ))}
                  <th className="text-right text-gray-700 font-semibold pl-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {heatmap.filas.map((f) => (
                  <tr key={f.nombre}>
                    <td className="text-gray-700 font-medium pr-2 whitespace-nowrap">{f.nombre}</td>
                    {MESES_ORDER.map((m) => {
                      const v = f.meses[m] ?? 0
                      // Opacity scale over the brand burdeos; empty cells stay neutral
                      const alpha = heatmap.max > 0 ? v / heatmap.max : 0
                      return (
                        <td key={m}
                          title={v > 0 ? `${f.nombre} · ${MES_LABELS[m]}: ${fmtM(v)}` : undefined}
                          className="text-center rounded"
                          style={{
                            backgroundColor: v > 0 ? `rgba(122, 31, 44, ${0.12 + alpha * 0.88})` : '#fbfaf6',
                            color: alpha > 0.45 ? '#ffffff' : '#5a544c',
                            padding: '6px 2px',
                          }}>
                          {v > 0 ? fmtM(v) : ''}
                        </td>
                      )
                    })}
                    <td className="text-right font-semibold text-gray-800 pl-2 whitespace-nowrap">{fmtM(f.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <p className="text-xs text-gray-400">
        Jornales cuenta solo registros medidos en días; el trabajo a destajo (plantas, metros, tachos)
        entra en los montos pero no en el conteo de jornales.
      </p>
    </div>
  )
}
