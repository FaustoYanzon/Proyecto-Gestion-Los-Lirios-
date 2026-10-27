'use client'

import { Fragment, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck } from 'lucide-react'
import { getCumplimiento, getPlanFitosanitario, type CumplimientoPlanItem } from '@/lib/api/planFitosanitario'
import { VARIEDAD_LABELS } from '@/lib/api/produccion'
import { MESES, formatNum } from '@/components/produccion/RondaCard'
import { useCampanaAnio, buildCampanas, campanaToAnio } from '@/store/contextStore'

// aniosAdelante=1: permite ver cumplimiento de la próxima campaña ya
// planificada, antes de que empiece.
const AVAILABLE_YEARS = buildCampanas(1).map(campanaToAnio)

const ESTADO_STYLES: Record<string, string> = {
  pendiente: 'bg-amber-50 text-amber-700 border border-amber-200',
  parcial: 'bg-blue-50 text-blue-700 border border-blue-200',
  completo: 'bg-green-50 text-green-700 border border-green-200',
}
const ESTADO_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  parcial: 'Parcial',
  completo: 'Completo',
}
const BAR_COLORS: Record<string, string> = {
  pendiente: 'bg-amber-400',
  parcial: 'bg-blue-500',
  completo: 'bg-green-500',
}

// Relative deviation of the actual weighted dose against the plan, or null
// when there is nothing to compare (nothing applied, same dose, or no plan dose).
function desvioDosis(c: CumplimientoPlanItem): number | null {
  if (c.dosis_real_promedio == null) return null
  const plan = Number(c.dosis_por_ha)
  const real = Number(c.dosis_real_promedio)
  if (!Number.isFinite(plan) || !Number.isFinite(real) || plan <= 0) return null
  if (Math.abs(real - plan) < 1e-9) return null
  return ((real - plan) / plan) * 100
}

interface Ronda {
  key: string
  numero: number
  objetivo: string
  mes: number
  filas: CumplimientoPlanItem[]
}

export default function CumplimientoFitosanitarioPage() {
  const [temporada, setTemporada] = useCampanaAnio()
  const [variedadActiva, setVariedadActiva] = useState<string | null>(null)

  const { data: cumplimiento = [], isLoading: loadingCumplimiento } = useQuery({
    queryKey: ['cumplimiento-fitosanitario', temporada],
    queryFn: () => getCumplimiento(temporada),
  })

  // The compliance rows carry no unit: take it from the plan rows (same id).
  const { data: plan = [] } = useQuery({
    queryKey: ['plan-fitosanitario', temporada],
    queryFn: () => getPlanFitosanitario(temporada),
    staleTime: 60_000,
  })
  const unidadPorPlan = useMemo(() => new Map(plan.map((p) => [p.id, p.insumo_unidad])), [plan])

  const variedadesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const c of cumplimiento) set.add(c.variedad)
    return Array.from(set).sort((a, b) => (VARIEDAD_LABELS[a] ?? a).localeCompare(VARIEDAD_LABELS[b] ?? b))
  }, [cumplimiento])

  const activa = variedadActiva && variedadesDisponibles.includes(variedadActiva)
    ? variedadActiva
    : variedadesDisponibles[0]

  // One group per plan round (number + objective + month) of the active variety.
  const rondas = useMemo(() => {
    const map = new Map<string, Ronda>()
    const filas = cumplimiento
      .filter((c) => c.variedad === activa)
      .sort((a, b) => a.numero_aplicacion - b.numero_aplicacion || a.mes - b.mes
        || a.insumo_nombre.localeCompare(b.insumo_nombre))
    for (const c of filas) {
      const key = `${c.numero_aplicacion}|${c.objetivo}|${c.mes}`
      const ronda = map.get(key) ?? { key, numero: c.numero_aplicacion, objetivo: c.objetivo, mes: c.mes, filas: [] }
      ronda.filas.push(c)
      map.set(key, ronda)
    }
    return Array.from(map.values())
  }, [cumplimiento, activa])

  const haySinSuperficie = useMemo(() => cumplimiento.some((c) => Number(c.ha_total) === 0), [cumplimiento])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck size={20} className="text-gray-700" />
            <h1 className="text-2xl font-semibold text-gray-900">Cumplimiento Fitosanitario</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Plan vs. real por variedad para esta temporada, por hectáreas aplicadas
          </p>
          {haySinSuperficie && (
            <p className="text-xs text-amber-700 mt-1" data-testid="aviso-sin-superficie">
              Algunas filas no tienen superficie cargada (0 ha): su avance se cuenta por parcelas aplicadas.
            </p>
          )}
        </div>
        <select
          value={temporada}
          onChange={(e) => setTemporada(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>Campaña {y}/{y + 1}</option>)}
        </select>
      </div>

      {/* ── Cumplimiento por variedad ── */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800">Cumplimiento por variedad</h2>

        {variedadesDisponibles.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
            {loadingCumplimiento ? 'Cargando…' : 'No hay plan cargado para esta temporada.'}
          </div>
        ) : (
          <>
            <div className="flex gap-2 flex-wrap">
              {variedadesDisponibles.map((v) => (
                <button
                  key={v}
                  onClick={() => setVariedadActiva(v)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    activa === v
                      ? 'bg-[#7a1f2c] text-white'
                      : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {VARIEDAD_LABELS[v] ?? v}
                </button>
              ))}
            </div>

            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Producto</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Dosis/ha</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Hectáreas</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 w-40">Avance</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Pendiente</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rondas.map((r) => (
                      <Fragment key={r.key}>
                        <tr className="bg-gray-50/70" data-testid="ronda-cumplimiento">
                          <td colSpan={6} className="px-4 py-2 text-xs text-gray-600">
                            <span className="font-semibold text-gray-900">Ronda Nº{r.numero}</span> · {r.objetivo} ·{' '}
                            {MESES[r.mes - 1] ?? `Mes ${r.mes}`}
                          </td>
                        </tr>
                        {r.filas.map((c) => {
                          const unidad = unidadPorPlan.get(c.plan_id) ?? ''
                          const desvio = desvioDosis(c)
                          const sinSuperficie = Number(c.ha_total) === 0
                          return (
                            <tr key={c.plan_id} className="hover:bg-gray-50 transition-colors" data-testid="fila-cumplimiento">
                              <td className="px-4 py-2.5 pl-8 text-gray-800 font-medium">{c.insumo_nombre}</td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                <span className="font-mono text-gray-700">
                                  {formatNum(c.dosis_por_ha)}{unidad ? ` ${unidad}` : ''}
                                </span>
                                {desvio != null && c.dosis_real_promedio != null && (
                                  <span
                                    className={`block text-[11px] ${Math.abs(desvio) >= 10 ? 'text-red-600' : 'text-amber-700'}`}
                                    data-testid="desvio-dosis"
                                  >
                                    real {formatNum(c.dosis_real_promedio)}{unidad ? ` ${unidad}` : ''} ({desvio > 0 ? '+' : ''}
                                    {formatNum(desvio, 1)}%)
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                {sinSuperficie ? (
                                  <span className="text-gray-400">sin superficie</span>
                                ) : (
                                  <span className="font-mono text-gray-700">
                                    {formatNum(c.ha_cubiertas, 2)} / {formatNum(c.ha_total, 2)} ha
                                  </span>
                                )}
                                <span className="block text-[11px] text-gray-400">
                                  {c.parcelas_aplicadas}/{c.parcelas_total} parcelas
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                                    {/* porcentaje comes clamped from the backend: never 100 unless complete. */}
                                    <div
                                      className={`h-full rounded-full ${BAR_COLORS[c.estado]}`}
                                      style={{ width: `${c.porcentaje}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-500 w-9 text-right">{c.porcentaje}%</span>
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                {c.estado === 'completo' ? (
                                  <span className="text-gray-400">—</span>
                                ) : (
                                  <>
                                    {!sinSuperficie && (
                                      <span className="font-mono text-gray-700">{formatNum(c.pendiente_ha, 2)} ha</span>
                                    )}
                                    {Number(c.pendiente_cantidad) > 0 && (
                                      <span className="block text-[11px] text-gray-500">
                                        {formatNum(c.pendiente_cantidad, 2)}{unidad ? ` ${unidad}` : ''} de producto
                                      </span>
                                    )}
                                    {sinSuperficie && (
                                      <span className="text-gray-500">
                                        {c.parcelas_total - c.parcelas_aplicadas} parcelas
                                      </span>
                                    )}
                                  </>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ESTADO_STYLES[c.estado]}`}>
                                  {ESTADO_LABELS[c.estado]}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              Una ronda se cubre con las hectáreas efectivamente aplicadas de cada producto, según la ronda del plan
              elegida al crear la orden. Si la dosis real difiere de la del plan se muestra el desvío, pero la superficie
              cuenta igual.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
