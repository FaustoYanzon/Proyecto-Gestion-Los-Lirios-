'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck, AlertTriangle } from 'lucide-react'
import {
  getCumplimiento,
  getNecesidadStock,
} from '@/lib/api/planFitosanitario'
import { VARIEDAD_LABELS } from '@/lib/api/produccion'
import { useContextStore, campanaToAnio } from '@/store/contextStore'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const AVAILABLE_YEARS = [DEFAULT_YEAR - 1, DEFAULT_YEAR, DEFAULT_YEAR + 1]

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

export default function CumplimientoFitosanitarioPage() {
  const campanaGlobal = useContextStore((s) => s.campana)
  const [temporada, setTemporada] = useState(() => campanaToAnio(campanaGlobal))

  // Ajustado durante el render (no en un useEffect) — mismo patrón que
  // plan-fitosanitario/page.tsx y metas/page.tsx.
  const [prevCampanaGlobal, setPrevCampanaGlobal] = useState(campanaGlobal)
  if (prevCampanaGlobal !== campanaGlobal) {
    setPrevCampanaGlobal(campanaGlobal)
    setTemporada(campanaToAnio(campanaGlobal))
  }

  const [variedadActiva, setVariedadActiva] = useState<string | null>(null)

  const { data: cumplimiento = [], isLoading: loadingCumplimiento } = useQuery({
    queryKey: ['cumplimiento-fitosanitario', temporada],
    queryFn: () => getCumplimiento(temporada),
  })

  const { data: necesidad = [], isLoading: loadingNecesidad } = useQuery({
    queryKey: ['necesidad-stock-fitosanitario', temporada],
    queryFn: () => getNecesidadStock(temporada),
  })

  const variedadesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const c of cumplimiento) set.add(c.variedad)
    return Array.from(set).sort((a, b) => (VARIEDAD_LABELS[a] ?? a).localeCompare(VARIEDAD_LABELS[b] ?? b))
  }, [cumplimiento])

  const activa = variedadActiva && variedadesDisponibles.includes(variedadActiva)
    ? variedadActiva
    : variedadesDisponibles[0]

  const filasVariedad = useMemo(
    () => cumplimiento
      .filter((c) => c.variedad === activa)
      .sort((a, b) => a.numero_aplicacion - b.numero_aplicacion || a.mes - b.mes),
    [cumplimiento, activa],
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck size={20} className="text-gray-700" />
            <h1 className="text-2xl font-semibold text-gray-900">Cumplimiento Fitosanitario</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Plan vs. real por variedad, y necesidad de insumos vs. stock para terminar la temporada
          </p>
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
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Nº Apl.</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Mes</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Producto</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Objetivo</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Dosis/ha</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Parcelas</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600 w-40">Avance</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filasVariedad.map((c) => (
                      <tr key={c.plan_id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-gray-800">{c.numero_aplicacion}</td>
                        <td className="px-4 py-2.5 text-gray-600">{MESES[c.mes - 1]}</td>
                        <td className="px-4 py-2.5 text-gray-800 font-medium">{c.insumo_nombre}</td>
                        <td className="px-4 py-2.5 text-gray-600">{c.objetivo}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-700">{c.dosis_por_ha}</td>
                        <td className="px-4 py-2.5 text-gray-600">{c.parcelas_aplicadas} / {c.parcelas_total}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${BAR_COLORS[c.estado]}`}
                                style={{ width: `${c.porcentaje}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 w-9 text-right">{c.porcentaje}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ESTADO_STYLES[c.estado]}`}>
                            {ESTADO_LABELS[c.estado]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              El cumplimiento se calcula cruzando variedad + producto + fecha, sin vínculo manual —
              si el mismo producto se aplica más de una vez en la temporada, cada aplicación real cubre
              la siguiente ronda planificada por orden cronológico.
            </p>
          </>
        )}
      </div>

      {/* ── Necesidad de insumos vs. stock ── */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800">Necesidad de insumos vs. stock</h2>

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Insumo</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Pendiente de aplicar</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Stock actual</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Faltante</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loadingNecesidad ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>
                ) : necesidad.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400">Nada pendiente de comprar para esta temporada.</td></tr>
                ) : (
                  necesidad.map((n) => (
                    <tr key={n.insumo_id} className={n.faltante > 0 ? 'bg-red-50/60 hover:bg-red-50' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{n.insumo_nombre}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-700">{n.cantidad_pendiente} {n.unidad}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-700">{n.stock_actual} {n.unidad}</td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {n.faltante > 0 ? (
                          <span className="flex items-center justify-end gap-1.5 text-red-700 font-semibold">
                            <AlertTriangle size={14} />
                            {n.faltante} {n.unidad}
                          </span>
                        ) : (
                          <span className="text-green-700">alcanza</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
