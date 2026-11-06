'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Droplets } from 'lucide-react'
import { getPlanillaRiego, hoyArgentina, type PlanillaRiegoCelda, type PlanillaTipo } from '@/lib/api/riego'
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

const INPUT_CLS =
  'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500'

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

export default function CumplimientoRiegoPage() {
  const rangoInicial = useMemo(() => campanaActualRango(), [])
  const [desde, setDesde] = useState(rangoInicial.desde)
  const [hasta, setHasta] = useState(rangoInicial.hasta)
  const [tipo, setTipo] = useState<PlanillaTipo>('ambos')
  const [parcelaId, setParcelaId] = useState('')

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

  const { data, isLoading, isError } = useQuery({
    queryKey: ['planilla-riego', desde, hasta, tipo, parcelaId],
    queryFn: () => getPlanillaRiego({ desde, hasta, tipo, parcela_id: parcelaId || undefined }),
    enabled: rangoValido,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Droplets size={20} className="text-gray-700" />
            <h1 className="text-2xl font-semibold text-gray-900">Cumplimiento Riego</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Riegos por parcela y mes: fecha de inicio, horas y mm aplicados
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

      {!rangoValido ? (
        <div className="bg-white rounded-lg border border-amber-200 p-6 text-sm text-amber-700">
          Elegí un rango de fechas válido (la fecha desde no puede ser posterior a hasta).
        </div>
      ) : isError ? (
        <div className="bg-white rounded-lg border border-red-200 p-6 text-sm text-red-600">
          No se pudo cargar la planilla de riego.
        </div>
      ) : isLoading || !data ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
          Cargando…
        </div>
      ) : data.filas.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
          No hay parrales ni potreros para mostrar.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-auto max-h-[70vh]">
          <table className="min-w-full border-separate border-spacing-0 text-sm" data-testid="planilla-riego">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-30 bg-gray-100 border-b border-r border-gray-300 px-3 py-2 text-left font-semibold text-gray-700">
                  Parcela
                </th>
                {data.meses.map((ym) => (
                  <th
                    key={ym}
                    className="sticky top-0 z-20 bg-gray-100 border-b border-r border-gray-300 px-3 py-2 text-left font-semibold text-gray-700 min-w-[9rem]"
                  >
                    {etiquetaMes(ym)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.filas.map((fila, i) => {
                // Green / light blue stripes, like the paper sheet.
                const franja = i % 2 === 0 ? 'bg-green-100' : 'bg-sky-100'
                return (
                  <tr key={fila.parcela_id}>
                    <th
                      scope="row"
                      className={`sticky left-0 z-10 ${franja} border-b border-r border-gray-300 px-3 py-2 text-left font-medium text-gray-900 whitespace-nowrap`}
                    >
                      {fila.parcela_nombre}
                    </th>
                    {data.meses.map((ym) => (
                      <td key={ym} className={`${franja} border-b border-r border-gray-300 px-3 py-2 align-top`}>
                        {(fila.celdas[ym] ?? []).map((r, j) => (
                          <CeldaRiego key={`${r.fecha_inicio}-${j}`} riego={r} />
                        ))}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
