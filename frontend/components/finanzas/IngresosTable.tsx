'use client'

import { Pencil, Trash2 } from 'lucide-react'
import {
  PRODUCTO_INGRESO_LABELS,
  VARIEDAD_LABELS,
  type IngresoResponse,
} from '@/lib/api/ingresos'

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

function formatKg(kg: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(kg)
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
  ingresos: IngresoResponse[]
  isLoading: boolean
  onEdit: (ingreso: IngresoResponse) => void
  onDelete: (id: string) => void
  onRefresh: () => void
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 11 }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  )
}

export default function IngresosTable({ ingresos, isLoading, onEdit, onDelete }: Props) {
  const totalARS = ingresos.filter((i) => i.moneda === 'ars').reduce((s, i) => s + i.monto, 0)
  const totalUSD = ingresos.filter((i) => i.moneda === 'usd').reduce((s, i) => s + i.monto, 0)
  const totalKg = ingresos.reduce((s, i) => s + (i.kg_totales ?? 0), 0)

  function handleDelete(id: string) {
    if (window.confirm('¿Eliminar este ingreso? Esta acción no se puede deshacer.')) {
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
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Cliente</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Producto</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Variedad</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Kg</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">$/Kg</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Monto</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Moneda</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Finca</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Origen</th>
              <th className="text-center px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
            ) : ingresos.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-12 text-center text-gray-400">
                  No hay ingresos registrados
                </td>
              </tr>
            ) : (
              ingresos.map((ing) => (
                <tr key={ing.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">{formatDate(ing.fecha)}</td>
                  <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-800">{ing.cliente}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">
                    {PRODUCTO_INGRESO_LABELS[ing.producto] ?? ing.producto}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-500">
                    {ing.variedad ? (VARIEDAD_LABELS[ing.variedad] ?? ing.variedad) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-gray-700">
                    {ing.kg_totales != null ? formatKg(ing.kg_totales) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-gray-700">
                    {ing.precio_por_kg != null ? formatMonto(ing.precio_por_kg) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap font-mono font-medium text-gray-800">
                    {formatMonto(ing.monto)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        ing.moneda === 'usd'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-green-50 text-green-700'
                      }`}
                    >
                      {ing.moneda.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">
                    {FINCA_LABELS[ing.finca] ?? ing.finca}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">
                    {ORIGEN_LABELS[ing.origen] ?? ing.origen}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => onEdit(ing)}
                        title="Editar"
                        className="p-1.5 rounded-md text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(ing.id)}
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
      {!isLoading && ingresos.length > 0 && (
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
          {totalKg > 0 && (
            <span className="font-medium text-gray-700">
              Kg totales:{' '}
              <span className="font-mono text-gray-800">{formatKg(totalKg)}</span>
            </span>
          )}
          <span className="ml-auto text-gray-400">
            {ingresos.length} registro{ingresos.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
