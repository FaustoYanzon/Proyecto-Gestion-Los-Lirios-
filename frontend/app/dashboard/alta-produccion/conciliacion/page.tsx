'use client'

// Conciliación de bodega: cada remito BOD (kg despachados) contra el comprobante
// que manda la bodega al pesar el camión (kg recibidos). Los pendientes son los
// remitos cuyo comprobante todavía no llegó.
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileCheck } from 'lucide-react'
import {
  getConciliacionBodega, getCompradores, errorDetail,
  type ConciliacionFila, type EstadoConciliacion,
} from '@/lib/api/altaProduccion'
import ComprobanteBodegaModal from '@/components/alta-produccion/ComprobanteBodegaModal'
import FormError from '@/components/ui/FormError'
import { usePaginatedList } from '@/lib/usePaginatedList'

const PAGE_SIZE = 15
const KG_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fmtKg = (n: number) => KG_FMT.format(n)
const fmtSigned = (n: number) => `${n > 0 ? '+' : ''}${fmtKg(n)}`
const fmtFecha = (iso: string) => iso.split('-').reverse().join('/')

const controlCls = 'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
const thCls = 'text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide'
const thRCls = thCls.replace('text-left', 'text-right')

const ESTADOS: { value: EstadoConciliacion; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'pendientes', label: 'Pendientes de comprobante' },
  { value: 'conciliados', label: 'Con comprobante' },
  { value: 'con_diferencia', label: 'Con diferencia' },
]

function Kpi({ label, value, sub, tone = 'normal' }: {
  label: string
  value: string
  sub?: string
  tone?: 'normal' | 'warn' | 'bad'
}) {
  const color = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900'
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-4 py-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-semibold font-mono mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function ConciliacionBodegaPage() {
  const qc = useQueryClient()
  const [estado, setEstado] = useState<EstadoConciliacion>('todos')
  const [bodegaId, setBodegaId] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [cargarDe, setCargarDe] = useState<ConciliacionFila | null>(null)

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['ap-conciliacion', estado, bodegaId, desde, hasta],
    queryFn: () => getConciliacionBodega({
      estado,
      comprador_id: bodegaId || undefined,
      desde: desde || undefined,
      hasta: hasta || undefined,
    }),
    staleTime: 30_000,
  })
  const { data: compradores = [] } = useQuery({
    queryKey: ['ap-compradores'], queryFn: () => getCompradores(), staleTime: 60_000,
  })

  const filas = data?.filas ?? []
  const t = data?.totales
  const { page, setPage, totalPages, paged } = usePaginatedList(filas, PAGE_SIZE)

  const refrescar = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['ap-conciliacion'] }),
    qc.invalidateQueries({ queryKey: ['ap-remitos'] }),
  ])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Conciliación de bodega</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Kilos despachados en cada remito a bodega (BOD) contra los que registró la bodega al pesar el camión.
          El comprobante se carga cuando llega.
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <select value={bodegaId} onChange={(e) => setBodegaId(e.target.value)} className={controlCls} aria-label="Bodega">
          <option value="">Todas las bodegas</option>
          {compradores.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoConciliacion)} className={controlCls} aria-label="Estado">
          {ESTADOS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={controlCls} />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={controlCls} />
        </label>
        {(bodegaId || desde || hasta || estado !== 'todos') && (
          <button
            onClick={() => { setBodegaId(''); setDesde(''); setHasta(''); setEstado('todos') }}
            className="text-sm font-medium text-[#7a1f2c] hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {loadError && <FormError description={errorDetail(loadError, 'No se pudo cargar la conciliación')} />}

      {t && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Kpi label="Despachado a bodegas" value={`${fmtKg(t.kg_despachados)} kg`} sub={`${t.remitos} remitos`} />
          <Kpi
            label="Pendientes de comprobante"
            value={`${t.pendientes}`}
            sub={`${fmtKg(t.kg_pendientes)} kg sin confirmar`}
            tone={t.pendientes > 0 ? 'warn' : 'normal'}
          />
          <Kpi
            label="Diferencia (solo con comprobante)"
            value={`${fmtSigned(t.diferencia_kg)} kg`}
            sub={
              t.conciliados === 0
                ? 'Todavía no hay comprobantes'
                : `Recibidos ${fmtKg(t.kg_recibidos)} de ${fmtKg(t.kg_despachados_conciliados)} kg` +
                  (t.diferencia_pct != null ? ` · ${fmtSigned(t.diferencia_pct)} %` : '')
            }
            tone={t.diferencia_kg < 0 ? 'bad' : 'normal'}
          />
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Remitos a bodega</h3>
          <span className="text-xs text-gray-400">{filas.length} registros</span>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : filas.length === 0 ? (
          <p className="px-5 py-10 text-center text-gray-400 text-sm">No hay remitos a bodega para esos filtros</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls}>Fecha</th>
                  <th className={thCls}>Remito</th>
                  <th className={thCls}>Bodega</th>
                  <th className={thRCls}>Despachados</th>
                  <th className={thCls}>SUV</th>
                  <th className={thRCls}>Recibidos</th>
                  <th className={thRCls}>Diferencia</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paged.map((f) => {
                  const pendiente = f.kg_recibidos == null
                  const dif = f.diferencia_kg
                  return (
                    <tr key={f.remito_id} className={pendiente ? 'bg-amber-50/40' : 'hover:bg-gray-50'}>
                      <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtFecha(f.fecha)}</td>
                      <td className="px-4 py-2.5 font-mono text-gray-900">{f.numero}</td>
                      <td className="px-4 py-2.5 text-gray-700">{f.comprador_nombre ?? '–'}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-900">{fmtKg(f.kg_despachados)}</td>
                      <td className="px-4 py-2.5 font-mono text-gray-700">{f.numero_suv ?? '–'}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-900">
                        {pendiente ? '–' : fmtKg(f.kg_recibidos as number)}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono whitespace-nowrap ${dif != null && dif < 0 ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                        {dif == null ? '–' : `${fmtSigned(dif)}${f.diferencia_pct != null ? ` (${fmtSigned(f.diferencia_pct)} %)` : ''}`}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {pendiente ? (
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">Pendiente</span>
                            <button
                              onClick={() => setCargarDe(f)}
                              className="flex items-center gap-1 text-xs font-medium text-[#7a1f2c] hover:underline"
                            >
                              <FileCheck size={13} /> Cargar cuando llegue
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && totalPages > 1 && (
          <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Anterior
            </button>
            <span className="text-gray-500">Página {page} de {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Siguiente
            </button>
          </div>
        )}
      </div>

      {cargarDe && (
        <ComprobanteBodegaModal
          remitoId={cargarDe.remito_id}
          numero={cargarDe.numero}
          kgDespachados={cargarDe.kg_despachados}
          onClose={() => setCargarDe(null)}
          onSaved={async () => { await refrescar(); setCargarDe(null) }}
        />
      )}
    </div>
  )
}
