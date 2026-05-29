'use client'

import { Pencil, Trash2 } from 'lucide-react'
import {
  TIPO_EGRESO_LABELS,
  CLASIFICACION_LABELS,
  type EgresoResponse,
} from '@/lib/api/egresos'

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

function formatMonto(monto: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(monto)
}

const FINCA_LABELS: Record<string, string> = {
  los_mimbres: 'Los Mimbres',
  media_agua: 'Media Agua',
  caucete: 'Caucete',
}

const ORIGEN_LABELS: Record<string, string> = {
  oficial: 'Oficial',
  no_oficial: 'No oficial',
}

const FORMA_PAGO_LABELS: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  credito: 'Crédito',
}

interface Props {
  egresos: EgresoResponse[]
  isLoading: boolean
  onEdit: (egreso: EgresoResponse) => void
  onDelete: (id: string) => void
  onRefresh: () => void
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 10 }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  )
}

export default function EgresosTable({ egresos, isLoading, onEdit, onDelete }: Props) {
  const totalARS = egresos.filter((e) => e.moneda === 'ars').reduce((s, e) => s + e.monto, 0)
  const totalUSD = egresos.filter((e) => e.moneda === 'usd').reduce((s, e) => s + e.monto, 0)

  function handleDelete(id: string) {
    if (window.confirm('¿Eliminar este egreso? Esta acción no se puede deshacer.')) {
      onDelete(id)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Fecha</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Tipo</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Clasificación</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Descripción</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Monto</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Moneda</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Finca</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Origen</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Forma Pago</th>
              <th className="px-3 py-3 font-medium text-gray-600 whitespace-nowrap text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
            ) : egresos.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-12 text-center text-gray-400">
                  No hay egresos registrados
                </td>
              </tr>
            ) : (
              egresos.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">{formatDate(e.fecha)}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">
                    {TIPO_EGRESO_LABELS[e.tipo] ?? e.tipo}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">
                    {CLASIFICACION_LABELS[e.clasificacion] ?? e.clasificacion}
                  </td>
                  <td className="px-3 py-3 text-gray-500 max-w-[180px] truncate">
                    {e.descripcion || '—'}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-gray-700">
                    {formatMonto(e.monto)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        e.moneda === 'usd'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-green-50 text-green-700'
                      }`}
                    >
                      {e.moneda.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">
                    {FINCA_LABELS[e.finca] ?? e.finca}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">
                    {ORIGEN_LABELS[e.origen] ?? e.origen}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">
                    {FORMA_PAGO_LABELS[e.forma_pago] ?? e.forma_pago}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => onEdit(e)}
                        title="Editar"
                        className="p-1.5 rounded-md text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(e.id)}
                        title="Eliminar"
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Totals footer */}
      {!isLoading && egresos.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex flex-wrap items-center gap-6 text-sm">
          <span className="font-medium text-gray-700">
            Total ARS:{' '}
            <span className="font-mono text-green-700">${formatMonto(totalARS)}</span>
          </span>
          {totalUSD > 0 && (
            <span className="font-medium text-gray-700">
              Total USD:{' '}
              <span className="font-mono text-blue-700">${formatMonto(totalUSD)}</span>
            </span>
          )}
          <span className="ml-auto text-gray-400">
            {egresos.length} registro{egresos.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
