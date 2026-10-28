'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ClipboardCheck } from 'lucide-react'
import { getAvance, type AvanceItem, type EstadoAvance } from '@/lib/api/planFitosanitario'
import { VARIEDAD_LABELS } from '@/lib/api/produccion'
import { MESES, formatNum } from '@/components/produccion/formato'
import { useCampanaAnio, buildCampanas, campanaToAnio } from '@/store/contextStore'

// aniosAdelante=1: permite ver cumplimiento de la próxima campaña ya
// planificada, antes de que empiece.
const AVAILABLE_YEARS = buildCampanas(1).map(campanaToAnio)

// Red = applied less than planned, green = on target (±5 %), blue = applied
// more than planned or not planned at all. Every state also carries a text
// label so the matrix reads without color.
const ESTADO_UI: Record<EstadoAvance, { label: string; celda: string; chip: string }> = {
  pendiente: { label: 'Sin aplicar', celda: 'bg-red-50 border-red-200 text-red-800', chip: 'bg-red-50 text-red-700 border border-red-200' },
  bajo: { label: 'Por debajo', celda: 'bg-red-50 border-red-200 text-red-800', chip: 'bg-red-50 text-red-700 border border-red-200' },
  ok: { label: 'En plan', celda: 'bg-green-50 border-green-200 text-green-800', chip: 'bg-green-50 text-green-700 border border-green-200' },
  exceso: { label: 'De más', celda: 'bg-blue-50 border-blue-200 text-blue-800', chip: 'bg-blue-50 text-blue-700 border border-blue-200' },
  no_planificado: { label: 'No planificado', celda: 'bg-blue-50 border-blue-200 text-blue-800', chip: 'bg-blue-50 text-blue-700 border border-blue-200' },
}

// Campaign order: May = 0 ... April = 11.
const ordenCampania = (mes: number): number => (mes - 5 + 12) % 12

interface Seleccion {
  variedad: string
  insumo_id: string
  mes: number
}

export default function CumplimientoFitosanitarioPage() {
  const [temporada, setTemporada] = useCampanaAnio()
  const [variedadActiva, setVariedadActiva] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null)

  const { data: avance = [], isLoading, isError } = useQuery({
    queryKey: ['plan-avance', temporada, 'todo'],
    queryFn: () => getAvance(temporada),
  })

  const variedades = useMemo(() => {
    const set = new Set<string>(avance.map((a) => a.variedad))
    return Array.from(set).sort((a, b) => (VARIEDAD_LABELS[a] ?? a).localeCompare(VARIEDAD_LABELS[b] ?? b))
  }, [avance])

  const activa = variedadActiva && variedades.includes(variedadActiva) ? variedadActiva : variedades[0]

  // Matrix of the active variety: rows = products (planned first), columns = months.
  const matriz = useMemo(() => {
    const items = avance.filter((a) => a.variedad === activa)
    const meses = Array.from(new Set(items.map((a) => a.mes))).sort((a, b) => ordenCampania(a) - ordenCampania(b))
    const filas = new Map<string, { insumo_id: string; nombre: string; unidad: string | null; planificada: boolean; celdas: Map<number, AvanceItem> }>()
    for (const it of items) {
      const fila = filas.get(it.insumo_id) ?? {
        insumo_id: it.insumo_id, nombre: it.insumo_nombre, unidad: it.unidad, planificada: false, celdas: new Map(),
      }
      fila.celdas.set(it.mes, it)
      if (it.dosis_plan !== null) fila.planificada = true
      filas.set(it.insumo_id, fila)
    }
    const ordenadas = Array.from(filas.values()).sort(
      (a, b) => Number(b.planificada) - Number(a.planificada) || a.nombre.localeCompare(b.nombre),
    )
    return { meses, filas: ordenadas }
  }, [avance, activa])

  const detalle = useMemo(() => {
    if (!seleccion) return null
    return avance.find(
      (a) => a.variedad === seleccion.variedad && a.insumo_id === seleccion.insumo_id && a.mes === seleccion.mes,
    ) ?? null
  }, [avance, seleccion])

  const haySinSuperficie = useMemo(() => avance.some((a) => Number(a.ha_total) === 0), [avance])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck size={20} className="text-gray-700" />
            <h1 className="text-2xl font-semibold text-gray-900">Cumplimiento Fitosanitario</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Dosis por hectárea planificada vs. aplicada, por variedad, producto y mes
          </p>
          {haySinSuperficie && (
            <p className="text-xs text-amber-700 mt-1" data-testid="aviso-sin-superficie">
              Algunas variedades tienen parcelas sin superficie cargada: su avance usa la dosis promedio de los registros.
            </p>
          )}
        </div>
        <select
          value={temporada}
          onChange={(e) => { setTemporada(Number(e.target.value)); setSeleccion(null) }}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>Campaña {y}/{y + 1}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600" data-testid="leyenda-avance">
        {(['bajo', 'ok', 'exceso'] as const).map((e) => (
          <span key={e} className={`inline-flex items-center rounded-full px-2 py-0.5 ${ESTADO_UI[e].chip}`}>
            {e === 'bajo' ? 'Rojo: aplicó menos del plan' : e === 'ok' ? 'Verde: dentro de ±5 %' : 'Azul: aplicó de más o fuera del plan'}
          </span>
        ))}
      </div>

      {isError ? (
        <div className="bg-white rounded-lg border border-red-200 p-6 text-sm text-red-600">
          No se pudo cargar el avance del plan.
        </div>
      ) : variedades.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
          {isLoading ? 'Cargando…' : 'No hay plan cargado para esta temporada.'}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {variedades.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={v === activa}
                onClick={() => { setVariedadActiva(v); setSeleccion(null) }}
                className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                  v === activa
                    ? 'bg-[#7a1f2c] text-white border-[#7a1f2c]'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {VARIEDAD_LABELS[v] ?? v}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm" data-testid="matriz-avance">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5 font-medium">Producto</th>
                  {matriz.meses.map((m) => (
                    <th key={m} className="px-3 py-2.5 font-medium text-center">{MESES[m - 1]}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {matriz.filas.map((fila) => (
                  <tr key={fila.insumo_id}>
                    <td className="px-4 py-2 align-top">
                      <span className="font-medium text-gray-800">{fila.nombre}</span>
                      {!fila.planificada && <span className="ml-2 text-[11px] text-blue-700">(fuera del plan)</span>}
                    </td>
                    {matriz.meses.map((m) => {
                      const it = fila.celdas.get(m)
                      if (!it) return <td key={m} className="px-3 py-2 text-center text-gray-300">–</td>
                      const ui = ESTADO_UI[it.estado]
                      const elegida = seleccion?.insumo_id === it.insumo_id && seleccion.mes === m && seleccion.variedad === it.variedad
                      const unidad = it.unidad ?? ''
                      return (
                        <td key={m} className="px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => setSeleccion(elegida ? null : { variedad: it.variedad, insumo_id: it.insumo_id, mes: m })}
                            aria-pressed={elegida}
                            data-testid="celda-avance"
                            data-estado={it.estado}
                            className={`w-full rounded-md border px-2 py-1 text-center transition-shadow ${ui.celda} ${elegida ? 'ring-2 ring-[#7a1f2c]' : 'hover:shadow-sm'}`}
                          >
                            <span className="block text-sm font-semibold">
                              {it.porcentaje !== null ? `${formatNum(it.porcentaje, 0)} %` : '—'}
                            </span>
                            <span className="block text-[11px]">{ui.label}</span>
                            <span className="block text-[10px] opacity-80">
                              {formatNum(it.dosis_aplicada_promedio, 2)}
                              {it.dosis_plan !== null ? ` / ${formatNum(it.dosis_plan, 2)}` : ''} {unidad}/ha
                            </span>
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {detalle && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm" data-testid="detalle-avance">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-800">
                  {detalle.insumo_nombre} · {MESES[detalle.mes - 1]} · {VARIEDAD_LABELS[detalle.variedad] ?? detalle.variedad}
                </h2>
                <p className="text-xs text-gray-500">
                  {detalle.dosis_plan !== null
                    ? `Plan ${formatNum(detalle.dosis_plan, 2)} ${detalle.unidad ?? ''}/ha`
                    : 'Aplicado sin estar en el plan de este mes'}
                  {' · '}{formatNum(detalle.ha_total, 2)} ha
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2 font-medium">Parcela</th>
                    <th className="px-3 py-2 font-medium text-right">ha</th>
                    <th className="px-3 py-2 font-medium text-right">Aplicado ({detalle.unidad ?? ''}/ha)</th>
                    <th className="px-3 py-2 font-medium text-right">%</th>
                    <th className="px-4 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {detalle.parcelas.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-1.5 text-gray-800">{p.nombre}</td>
                      <td className="px-3 py-1.5 text-right text-gray-600">{formatNum(p.ha, 2)}</td>
                      <td className="px-3 py-1.5 text-right text-gray-600">{formatNum(p.dosis_aplicada, 2)}</td>
                      <td className="px-3 py-1.5 text-right text-gray-600">
                        {p.porcentaje !== null ? `${formatNum(p.porcentaje, 0)} %` : '—'}
                      </td>
                      <td className="px-4 py-1.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${ESTADO_UI[p.estado].chip}`}>
                          {ESTADO_UI[p.estado].label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
