'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { usePaginatedList } from '@/lib/usePaginatedList'
import { getParcelas } from '@/lib/api/produccion'
import { VARIEDAD_LABELS } from '@/lib/api/parcelas'
import {
  getIngresosPasero, getStockPasero, getProductores, getParametros, errorDetail,
} from '@/lib/api/altaProduccion'
import FormError from '@/components/ui/FormError'

const PAGE_SIZE = 10
const KG_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fmtKg = (n: number) => KG_FMT.format(n)
const fmtFecha = (iso: string) => iso.split('-').reverse().join('/')

const thCls = 'text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide'
const thRCls = thCls.replace('text-left', 'text-right')

type Pestana = 'ingresos' | 'stock'

const PESTANAS: { id: Pestana; label: string }[] = [
  { id: 'ingresos', label: 'Ingresos' },
  { id: 'stock', label: 'Stock de uva por variedad' },
]

export default function PaseroPage() {
  const [pestana, setPestana] = useState<Pestana>('ingresos')
  const [paseroFiltro, setPaseroFiltro] = useState('')

  const { data: parcelas = [] } = useQuery({ queryKey: ['parcelas'], queryFn: getParcelas, staleTime: 300_000 })
  const paseros = parcelas.filter((p) => p.tipo === 'pasero' && p.is_active)
  const nombrePasero = (id: string) => parcelas.find((p) => p.id === id)?.nombre ?? '–'

  const { data: productores = [] } = useQuery({
    queryKey: ['ap-productores'], queryFn: () => getProductores(), staleTime: 60_000,
  })
  const nombreProductor = (id: string | null) => (id ? productores.find((p) => p.id === id)?.nombre ?? '–' : '–')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Ingreso al pasero</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Uva fresca que entra al pasero, pesada en báscula. Los ingresos se registran desde Producción → Cosecha (nuevo despacho).
          </p>
        </div>
        <select
          value={paseroFiltro}
          onChange={(e) => setPaseroFiltro(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]"
        >
          <option value="">Todos los paseros</option>
          {paseros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>

      <div role="tablist" className="flex gap-1 border-b border-gray-200">
        {PESTANAS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={pestana === t.id}
            onClick={() => setPestana(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              pestana === t.id
                ? 'border-[#7a1f2c] text-[#7a1f2c]'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {pestana === 'ingresos'
        ? <Ingresos paseroFiltro={paseroFiltro} nombrePasero={nombrePasero} nombreProductor={nombreProductor} />
        : <StockPorVariedad paseroFiltro={paseroFiltro} />}
    </div>
  )
}

function Ingresos({
  paseroFiltro, nombrePasero, nombreProductor,
}: {
  paseroFiltro: string
  nombrePasero: (id: string) => string
  nombreProductor: (id: string | null) => string
}) {
  const { data: ingresos = [], isLoading, error: loadError } = useQuery({
    queryKey: ['ap-ingresos', paseroFiltro],
    queryFn: () => getIngresosPasero({ pasero_id: paseroFiltro || undefined }),
    staleTime: 30_000,
  })
  const { page, setPage, totalPages, paged } = usePaginatedList(ingresos, PAGE_SIZE)
  const totalReal = ingresos.reduce((s, i) => s + i.kg_real, 0)

  return (
    <>
      {loadError && <FormError description={errorDetail(loadError, 'No se pudo cargar el listado')} />}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Ingresos</h3>
          <span className="text-xs text-gray-400">{ingresos.length} registros</span>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : ingresos.length === 0 ? (
          <p className="px-5 py-10 text-center text-gray-400 text-sm">No hay ingresos registrados</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls}>Fecha</th>
                  <th className={thCls}>Pasero</th>
                  <th className={thCls}>Variedad</th>
                  <th className={thCls}>Origen</th>
                  <th className={thRCls}>Carros</th>
                  <th className={thRCls}>Fichas</th>
                  <th className={thRCls}>Kg teórico</th>
                  <th className={thRCls}>Kg báscula</th>
                  <th className={thRCls}>Merma kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paged.map((i) => (
                  <tr key={i.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtFecha(i.fecha)}</td>
                    <td className="px-4 py-2.5 text-gray-900">{nombrePasero(i.pasero_id)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{VARIEDAD_LABELS[i.variedad] ?? i.variedad}</td>
                    <td className="px-4 py-2.5">
                      {i.origen === 'tercero' ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                          Tercero: {nombreProductor(i.productor_id)}
                        </span>
                      ) : (
                        <span className="text-gray-600">Propio{i.productor_id ? `: ${nombreProductor(i.productor_id)}` : ''}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{i.carros}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{i.fichas}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(i.kg_teorico)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-gray-900">{fmtKg(i.kg_real)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${i.merma_kg < 0 ? 'text-amber-700' : 'text-gray-700'}`}>
                      {fmtKg(i.merma_kg)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={7} className="px-4 py-2.5 text-xs font-semibold text-gray-500 text-right">TOTAL</td>
                  <td className="px-4 py-2.5 text-right font-bold font-mono text-green-700">{fmtKg(totalReal)} kg</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {!isLoading && totalPages > 1 && (
          <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="text-xs text-gray-500">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, ingresos.length)} de {ingresos.length}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </>
  )
}

interface FilaVariedad {
  ingresada: number
  consumida: number
  disponible: number
  levantada: number
  esperada: number
  diferencia: number
}

function StockPorVariedad({ paseroFiltro }: { paseroFiltro: string }) {
  const { data: parametros } = useQuery({ queryKey: ['ap-parametros'], queryFn: getParametros, staleTime: 60_000 })
  const { data: stock = [], isLoading, error } = useQuery({
    queryKey: ['ap-stock', paseroFiltro],
    queryFn: () => getStockPasero(paseroFiltro || undefined),
    staleTime: 30_000,
  })

  // Suma de los paseros (o del pasero filtrado) por variedad.
  const porVariedad = new Map<string, FilaVariedad>()
  for (const s of stock) {
    const f = porVariedad.get(s.variedad)
      ?? { ingresada: 0, consumida: 0, disponible: 0, levantada: 0, esperada: 0, diferencia: 0 }
    f.ingresada += s.uva_ingresada_kg
    f.consumida += s.uva_consumida_kg
    f.disponible += s.uva_disponible_kg
    f.levantada += s.pasa_levantada_kg
    f.esperada += s.pasa_esperada_kg
    f.diferencia += s.diferencia_pasa_kg
    porVariedad.set(s.variedad, f)
  }
  const filas = [...porVariedad.entries()]
  const totalDisponible = filas.reduce((s, [, f]) => s + f.disponible, 0)

  return (
    <>
      {error && <FormError description={errorDetail(error, 'No se pudo cargar el stock')} />}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Stock de uva por variedad</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Disponible = ingresada − consumida por la levantada de pasa.
            {' '}Pasa esperada = uva ingresada ÷ {parametros ? fmtKg(parametros.ratio_uva_pasa) : 'ratio'}. Diferencia = levantada − esperada.
          </p>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : filas.length === 0 ? (
          <p className="px-5 py-10 text-center text-gray-400 text-sm">Todavía no hay uva ingresada</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls}>Variedad</th>
                  <th className={thRCls}>Uva ingresada kg</th>
                  <th className={thRCls}>Uva consumida kg</th>
                  <th className={thRCls}>Uva disponible kg</th>
                  <th className={thRCls}>Pasa levantada kg</th>
                  <th className={thRCls}>Pasa esperada kg</th>
                  <th className={thRCls}>Diferencia kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filas.map(([v, f]) => (
                  <tr key={v} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-900">{VARIEDAD_LABELS[v as keyof typeof VARIEDAD_LABELS] ?? v}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(f.ingresada)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(f.consumida)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-green-700">{fmtKg(f.disponible)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(f.levantada)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(f.esperada)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${f.diferencia < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                      {fmtKg(f.diferencia)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td className="px-4 py-2.5 text-xs font-semibold text-gray-500">TOTAL DISPONIBLE</td>
                  <td colSpan={2} />
                  <td className="px-4 py-2.5 text-right font-bold font-mono text-green-700">{fmtKg(totalDisponible)} kg</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
