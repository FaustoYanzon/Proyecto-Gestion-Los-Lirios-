'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Droplets } from 'lucide-react'
import {
  getPlanillaRiego,
  getPlanillaCumplimientoRiego,
  hoyArgentina,
  type PlanillaCumplimientoCelda,
  type PlanillaRiegoCelda,
  type PlanillaTipo,
} from '@/lib/api/riego'
import { getParcelas } from '@/lib/api/produccion'
import { MESES, formatNum } from '@/components/produccion/formato'

// Campaign runs May -> April, not the calendar year.
function campanaActualRango(): { desde: string; hasta: string } {
  const hoy = hoyArgentina() // YYYY-MM-DD in Argentina time
  const anio = Number(hoy.slice(0, 4))
  const mes = Number(hoy.slice(5, 7))
  const inicio = mes >= 5 ? anio : anio - 1
  return { desde: `${inicio}-05-01`, hasta: `${inicio + 1}-04-30` }
}

// "2026-08" -> "Ago 2026"
function etiquetaMes(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MESES[Number(m) - 1].slice(0, 3)} ${y}`
}

// "2026-08-12" -> "12/08" (string split: no Date parsing, so no timezone shift).
function ddmm(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

const TIPO_OPTIONS: { value: PlanillaTipo; label: string }[] = [
  { value: 'ambos', label: 'Ambos' },
  { value: 'goteo', label: 'Goteo' },
  { value: 'manto', label: 'Manto' },
]

type Vista = 'riegos' | 'cumplimiento'

const VISTAS: { value: Vista; label: string }[] = [
  { value: 'riegos', label: 'Riegos' },
  { value: 'cumplimiento', label: 'Cumplimiento' },
]

// Same thresholds as riegoColor in the map (FincaMapInner): <50 / <85 / <=115 / >115.
// Every state also carries a text label so the matrix reads without color.
type EstadoCumplimiento = 'severo' | 'bajo' | 'ok' | 'exceso'

const ESTADO_UI: Record<EstadoCumplimiento, { label: string; celda: string; chip: string }> = {
  severo: { label: 'Déficit severo', celda: 'bg-red-50 border-red-200 text-red-800', chip: 'bg-red-50 text-red-700 border border-red-200' },
  bajo: { label: 'Por debajo', celda: 'bg-amber-50 border-amber-200 text-amber-800', chip: 'bg-amber-50 text-amber-700 border border-amber-200' },
  ok: { label: 'En objetivo', celda: 'bg-green-50 border-green-200 text-green-800', chip: 'bg-green-50 text-green-700 border border-green-200' },
  exceso: { label: 'Posible exceso', celda: 'bg-blue-50 border-blue-200 text-blue-800', chip: 'bg-blue-50 text-blue-700 border border-blue-200' },
}

function estadoDe(pct: number): EstadoCumplimiento {
  if (pct < 50) return 'severo'
  if (pct < 85) return 'bajo'
  if (pct <= 115) return 'ok'
  return 'exceso'
}

const INPUT_CLS =
  'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500'

const TH_CLS = 'bg-gray-50 border-b border-gray-200 px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500'
const ROW_TH_CLS =
  'sticky left-0 z-10 bg-white group-hover:bg-gray-50 border-b border-gray-100 px-4 py-2 text-left font-medium text-gray-800 whitespace-nowrap'

function CeldaRiego({ riego }: { riego: PlanillaRiegoCelda }) {
  const partes = [ddmm(riego.fecha_inicio)]
  if (riego.en_curso) {
    partes.push('en curso')
  } else {
    if (riego.horas !== null) partes.push(`${formatNum(riego.horas, 2)}h`)
    if (riego.mm !== null) partes.push(`${formatNum(riego.mm, 1)} mm`)
  }
  return (
    <div className="whitespace-nowrap text-xs text-gray-800" data-testid="riego-celda-item">
      {partes.join(' · ')}
      {riego.tipo === 'goteo' && <span className="ml-1 italic text-gray-500">(goteo)</span>}
    </div>
  )
}

// No decimals above 100 m3, one decimal below.
function formatM3(value: number | string): string {
  return formatNum(value, Math.abs(Number(value)) >= 100 ? 0 : 1)
}

function CeldaCumplimiento({ celda }: { celda: PlanillaCumplimientoCelda | undefined }) {
  // No expected volume = parcela without surface: neutral, never a false 0 %.
  if (celda && celda.m3_esperados === null) {
    return (
      <div
        data-testid="cumplimiento-celda-sin-superficie"
        className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-center text-gray-500"
      >
        <span className="block text-[11px]">Sin superficie</span>
        <span className="block text-[10px] opacity-80 whitespace-nowrap">
          {formatM3(celda.m3_aplicados)} m³ aplicados
        </span>
      </div>
    )
  }
  // No pct = month with nothing expected yet (future) or missing cell.
  if (!celda || celda.cumplimiento_pct === null) {
    return <span className="block text-center text-gray-300" data-testid="cumplimiento-celda-vacia">—</span>
  }
  const pct = Number(celda.cumplimiento_pct)
  const estado = estadoDe(pct)
  const ui = ESTADO_UI[estado]
  return (
    <div
      data-testid="cumplimiento-celda"
      data-estado={estado}
      className={`rounded-md border px-2 py-1 text-center ${ui.celda}`}
    >
      <span className="block text-sm font-semibold">{formatNum(pct, 0)} %</span>
      <span className="block text-[11px]">{ui.label}</span>
      <span className="block text-[10px] opacity-80 whitespace-nowrap">
        {formatM3(celda.m3_aplicados)} / {formatM3(celda.m3_esperados ?? 0)} m³
      </span>
    </div>
  )
}

export default function CumplimientoRiegoPage() {
  const rangoInicial = useMemo(() => campanaActualRango(), [])
  const [desde, setDesde] = useState(rangoInicial.desde)
  const [hasta, setHasta] = useState(rangoInicial.hasta)
  const [tipo, setTipo] = useState<PlanillaTipo>('ambos')
  const [parcelaId, setParcelaId] = useState('')
  const [vista, setVista] = useState<Vista>('riegos')

  const rangoValido = desde !== '' && hasta !== '' && desde <= hasta

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas'],
    queryFn: getParcelas,
    staleTime: 300_000,
  })

  const opcionesParcela = useMemo(
    () =>
      parcelas
        .filter((p) => p.is_active && (p.tipo === 'parral' || p.tipo === 'potrero'))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true })),
    [parcelas],
  )

  const filtros = { desde, hasta, tipo, parcela_id: parcelaId || undefined }

  // Only the active view's query runs; the view is part of each key.
  const riegosQ = useQuery({
    queryKey: ['planilla-riego', 'riegos', desde, hasta, tipo, parcelaId],
    queryFn: () => getPlanillaRiego(filtros),
    enabled: rangoValido && vista === 'riegos',
  })
  const cumplimientoQ = useQuery({
    queryKey: ['planilla-riego', 'cumplimiento', desde, hasta, tipo, parcelaId],
    queryFn: () => getPlanillaCumplimientoRiego(filtros),
    enabled: rangoValido && vista === 'cumplimiento',
  })
  const activa = vista === 'riegos' ? riegosQ : cumplimientoQ
  const meses = activa.data?.meses ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Droplets size={20} className="text-gray-700" />
            <h1 className="text-2xl font-semibold text-gray-900">Cumplimiento Riego</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {vista === 'riegos'
              ? 'Riegos por parcela y mes: fecha de inicio, horas y mm aplicados'
              : 'Volumen aplicado (m³) vs. esperado por parcela y mes, según el calendario de campaña'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Tipo de riego"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as PlanillaTipo)}
            className={INPUT_CLS}
          >
            {TIPO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            type="date"
            aria-label="Desde"
            value={desde}
            max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
            className={INPUT_CLS}
          />
          <input
            type="date"
            aria-label="Hasta"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
            className={INPUT_CLS}
          />
          <select
            aria-label="Parcela"
            value={parcelaId}
            onChange={(e) => setParcelaId(e.target.value)}
            className={INPUT_CLS}
          >
            <option value="">Todas</option>
            {opcionesParcela.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5" role="group" aria-label="Vista">
          {VISTAS.map((v) => (
            <button
              key={v.value}
              type="button"
              aria-pressed={v.value === vista}
              onClick={() => setVista(v.value)}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                v.value === vista
                  ? 'bg-[#7a1f2c] text-white border-[#7a1f2c]'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {vista === 'cumplimiento' && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600" data-testid="leyenda-cumplimiento">
            {(['severo', 'bajo', 'ok', 'exceso'] as const).map((e) => (
              <span key={e} className={`inline-flex items-center rounded-full px-2 py-0.5 ${ESTADO_UI[e].chip}`}>
                {e === 'severo'
                  ? 'Rojo: menos de 50 %'
                  : e === 'bajo'
                    ? 'Ámbar: 50–85 %'
                    : e === 'ok'
                      ? 'Verde: 85–115 %'
                      : 'Azul: más de 115 %'}
              </span>
            ))}
          </div>
        )}
      </div>

      {!rangoValido ? (
        <div className="bg-white rounded-lg border border-amber-200 p-6 text-sm text-amber-700">
          Elegí un rango de fechas válido (la fecha desde no puede ser posterior a hasta).
        </div>
      ) : activa.isError ? (
        <div className="bg-white rounded-lg border border-red-200 p-6 text-sm text-red-600">
          No se pudo cargar la planilla de riego.
        </div>
      ) : activa.isLoading || !activa.data ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
          Cargando…
        </div>
      ) : activa.data.filas.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
          No hay parrales ni potreros para mostrar.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-auto max-h-[70vh]">
          <table
            className="min-w-full border-separate border-spacing-0 text-sm"
            data-testid={vista === 'riegos' ? 'planilla-riego' : 'planilla-cumplimiento'}
          >
            <thead>
              <tr>
                <th className={`sticky top-0 left-0 z-30 ${TH_CLS} px-4`}>Parcela</th>
                {meses.map((ym) => (
                  <th key={ym} className={`sticky top-0 z-20 ${TH_CLS} min-w-[9rem]`}>
                    {etiquetaMes(ym)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vista === 'riegos'
                ? riegosQ.data?.filas.map((fila) => (
                    <tr key={fila.parcela_id} className="group">
                      <th scope="row" className={ROW_TH_CLS}>{fila.parcela_nombre}</th>
                      {meses.map((ym) => (
                        <td key={ym} className="bg-white group-hover:bg-gray-50 border-b border-gray-100 px-3 py-2 align-top">
                          {(fila.celdas[ym] ?? []).map((r, j) => (
                            <CeldaRiego key={`${r.fecha_inicio}-${j}`} riego={r} />
                          ))}
                        </td>
                      ))}
                    </tr>
                  ))
                : cumplimientoQ.data?.filas.map((fila) => (
                    <tr key={fila.parcela_id} className="group">
                      <th scope="row" className={ROW_TH_CLS}>{fila.parcela_nombre}</th>
                      {meses.map((ym) => (
                        <td key={ym} className="border-b border-gray-100 px-2 py-1.5 align-middle min-w-[9rem]">
                          <CeldaCumplimiento celda={fila.celdas[ym]} />
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
