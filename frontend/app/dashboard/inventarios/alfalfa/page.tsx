'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Printer, ChevronLeft, ChevronRight } from 'lucide-react'
import { usePaginatedList } from '@/lib/usePaginatedList'
import { listParcelasAdmin } from '@/lib/api/parcelas'
import { getCompradores, errorDetail } from '@/lib/api/altaProduccion'
import {
  getStockAlfalfa, listarDocumentosAlfalfa, abrirPdfAlfalfa, PRODUCTO_LABELS, TIPO_DOC_LABELS,
  type DocumentoAlfalfa, type ProductoAlfalfa, type TipoDocumentoAlfalfa,
} from '@/lib/api/alfalfa'
import FormError from '@/components/ui/FormError'
import AltaAlfalfaModal from '@/components/alfalfa/AltaAlfalfaModal'
import SalidaAlfalfaModal from '@/components/alfalfa/SalidaAlfalfaModal'
import { fmtNum, fmtFecha } from '@/components/alfalfa/shared'

const PAGE_SIZE = 10
const selectFiltroCls = 'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
const thCls = 'text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide'
const thRCls = thCls.replace('text-left', 'text-right')

const TIPO_BADGE: Record<TipoDocumentoAlfalfa, string> = {
  alta: 'bg-green-100 text-green-700',
  salida: 'bg-amber-100 text-amber-700',
}

function StockCard({ label, principal, secundario, tone }: {
  label: string; principal: string; secundario?: string; tone: 'green' | 'amber' | 'blue'
}) {
  const s = {
    green: 'bg-green-50 border-green-100 text-green-700 text-green-800',
    amber: 'bg-amber-50 border-amber-100 text-amber-700 text-amber-800',
    blue: 'bg-blue-50 border-blue-100 text-blue-700 text-blue-800',
  }[tone].split(' ')
  return (
    <div className={`${s[0]} rounded-lg border ${s[1]} shadow-sm p-4`}>
      <p className={`text-xs font-medium ${s[2]} uppercase tracking-wide`}>{label}</p>
      <p className={`text-2xl font-bold ${s[3]} mt-1`}>{principal}</p>
      {secundario && <p className={`text-xs ${s[2]} mt-0.5`}>{secundario}</p>}
    </div>
  )
}

export default function AlfalfaPage() {
  const qc = useQueryClient()
  const [tipo, setTipo] = useState<'' | TipoDocumentoAlfalfa>('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [modal, setModal] = useState<null | 'alta' | 'salida'>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)

  const { data: stock = [], error: stockError } = useQuery({
    queryKey: ['alfalfa-stock'], queryFn: getStockAlfalfa, staleTime: 30_000,
  })
  const { data: docs = [], isLoading, error: docsError } = useQuery({
    queryKey: ['alfalfa-docs', tipo, desde, hasta],
    queryFn: () => listarDocumentosAlfalfa({
      tipo: tipo || undefined, fecha_desde: desde || undefined, fecha_hasta: hasta || undefined,
    }),
    staleTime: 30_000,
  })
  const { data: parcelas = [] } = useQuery({ queryKey: ['parcelas-admin'], queryFn: listParcelasAdmin, staleTime: 60_000 })
  const { data: compradores = [] } = useQuery({ queryKey: ['ap-compradores'], queryFn: () => getCompradores(), staleTime: 60_000 })

  // Only active potreros can receive an alta; GET /parcelas/ returns only active parcelas,
  // so the table resolves names only for active potreros (a deactivated potrero shows "–").
  const potreros = parcelas.filter((p) => p.tipo === 'potrero')
  const potrerosActivos = potreros.filter((p) => p.is_active)

  const { page, setPage, totalPages, paged } = usePaginatedList(docs, PAGE_SIZE)

  const stockDe = (p: ProductoAlfalfa) => stock.find((s) => s.producto === p) ?? { producto: p, unidades: 0, kg: 0 }
  const destino = (d: DocumentoAlfalfa) =>
    d.tipo === 'alta'
      ? (potreros.find((p) => p.id === d.potrero_id)?.nombre ?? '–')
      : (compradores.find((c) => c.id === d.comprador_id)?.nombre ?? '–')
  const resumenLineas = (d: DocumentoAlfalfa) =>
    d.lineas
      .map((l) => `${fmtNum(l.cantidad)} ${l.producto === 'semilla' ? 'kg de' : ''} ${PRODUCTO_LABELS[l.producto].toLowerCase()}`.replace('  ', ' '))
      .join(' · ')

  async function imprimir(d: DocumentoAlfalfa) {
    setPdfError(null)
    try {
      await abrirPdfAlfalfa(d.id, d.numero)
    } catch (e) {
      setPdfError(errorDetail(e, 'No se pudo abrir el PDF del documento'))
    }
  }

  const refrescar = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['alfalfa-stock'] }),
    qc.invalidateQueries({ queryKey: ['alfalfa-docs'] }),
  ])

  const fardo = stockDe('fardo')
  const rollo = stockDe('rollo')
  const semilla = stockDe('semilla')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Alfalfa</h1>
          <p className="text-sm text-gray-500 mt-0.5">Stock de fardos, rollos y semilla. Las altas vienen de los potreros y las salidas van a compradores.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setModal('alta')}
            className="flex items-center gap-2 px-4 py-2 bg-[#7a1f2c] text-white text-sm font-semibold rounded-lg hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={16} /> Alta
          </button>
          <button
            onClick={() => setModal('salida')}
            className="flex items-center gap-2 px-4 py-2 border border-[#7a1f2c] text-[#7a1f2c] text-sm font-semibold rounded-lg hover:bg-[#fbfaf6] transition-colors"
          >
            <Plus size={16} /> Salida
          </button>
        </div>
      </div>

      {stockError && <FormError description={errorDetail(stockError, 'No se pudo cargar el stock')} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StockCard label="Fardos" principal={`${fmtNum(fardo.unidades)} un.`} secundario={`${fmtNum(fardo.kg)} kg`} tone="green" />
        <StockCard label="Rollos" principal={`${fmtNum(rollo.unidades)} un.`} secundario={`${fmtNum(rollo.kg)} kg`} tone="amber" />
        <StockCard label="Semilla" principal={`${fmtNum(semilla.kg)} kg`} tone="blue" />
      </div>

      {pdfError && <FormError description={pdfError} />}
      {docsError && <FormError description={errorDetail(docsError, 'No se pudo cargar el listado')} />}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-sm font-semibold text-gray-700">Documentos</h3>
          <div className="flex items-center gap-3 flex-wrap">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as '' | TipoDocumentoAlfalfa)} className={selectFiltroCls}>
              <option value="">Altas y salidas</option>
              <option value="alta">Altas</option>
              <option value="salida">Salidas</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              Desde
              <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className={selectFiltroCls} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              Hasta
              <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className={selectFiltroCls} />
            </label>
            <span className="text-xs text-gray-400">{docs.length} registros</span>
          </div>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : docs.length === 0 ? (
          <p className="px-5 py-10 text-center text-gray-400 text-sm">No hay documentos para mostrar</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls}>Fecha</th>
                  <th className={thCls}>Tipo</th>
                  <th className={thCls}>N°</th>
                  <th className={thCls}>Potrero / Comprador</th>
                  <th className={thCls}>Detalle</th>
                  <th className={thRCls}>Kg total</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paged.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtFecha(d.fecha)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${TIPO_BADGE[d.tipo]}`}>
                        {TIPO_DOC_LABELS[d.tipo]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-gray-900">{d.numero}</td>
                    <td className="px-4 py-2.5 text-gray-700">{destino(d)}</td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs">{resumenLineas(d)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-gray-900">{fmtNum(d.kg_total)}</td>
                    <td className="px-2 py-2.5 text-right">
                      <button
                        onClick={() => imprimir(d)}
                        title="Imprimir documento"
                        className="p-1.5 rounded text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                      >
                        <Printer size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
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
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, docs.length)} de {docs.length}
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

      {modal === 'alta' && (
        <AltaAlfalfaModal
          potreros={potrerosActivos}
          onClose={() => setModal(null)}
          onCreated={async () => { await refrescar(); setModal(null) }}
        />
      )}
      {modal === 'salida' && (
        <SalidaAlfalfaModal
          compradores={compradores.filter((c) => c.is_active)}
          stock={stock}
          onClose={() => setModal(null)}
          onCreated={async () => { await refrescar(); setModal(null) }}
        />
      )}
    </div>
  )
}
