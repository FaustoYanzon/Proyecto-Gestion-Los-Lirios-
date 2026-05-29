'use client'

import { Pencil, Trash2 } from 'lucide-react'
import {
  TEMPORADA_LABELS,
  UNIDAD_LABELS,
  type RegistroTrabajoResponse,
  type UnidadMedida,
} from '@/lib/api/produccion'

function formatDate(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function formatMonto(n: number) {
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

const CLASIFICACION_BADGE: Record<string, string> = {
  verano:    'bg-orange-50 text-orange-700',
  invierno:  'bg-blue-50 text-blue-700',
  primavera: 'bg-green-50 text-green-700',
  otono:     'bg-amber-50 text-amber-700',
  general:   'bg-gray-100 text-gray-600',
}

interface Props {
  registros: RegistroTrabajoResponse[]
  isLoading: boolean
  parcelaNombre: (id: string | null) => string
  onEdit: (r: RegistroTrabajoResponse) => void
  onDelete: (id: string) => void
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 9 }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-4 bg-gray-200 rounded animate-pulse" />
        </td>
      ))}
    </tr>
  )
}

export default function TareasTable({ registros, isLoading, parcelaNombre, onEdit, onDelete }: Props) {
  const total = registros.reduce((s, r) => s + Number(r.monto_total), 0)

  function handleDelete(id: string) {
    if (window.confirm('¿Eliminar este registro? También se eliminará el egreso vinculado.')) {
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
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Tarea</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Temporada</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Ubicación</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Trabajador</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Cantidad</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Unidad</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Precio/u</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Total ARS</th>
              <th className="px-3 py-3 font-medium text-gray-600 text-center whitespace-nowrap">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
            ) : registros.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-12 text-center text-gray-400">
                  No hay registros de tarea diaria
                </td>
              </tr>
            ) : (
              registros.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">{formatDate(r.fecha)}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-900 font-medium">{r.tarea}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CLASIFICACION_BADGE[r.clasificacion] ?? 'bg-gray-100 text-gray-600'}`}>
                      {TEMPORADA_LABELS[r.clasificacion] ?? r.clasificacion}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                    {parcelaNombre(r.parcela_id)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">{r.trabajador_nombre}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-gray-700">
                    {Number(r.cantidad).toFixed(2)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                    {UNIDAD_LABELS[r.unidad_medida as UnidadMedida] ?? r.unidad_medida}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-gray-600">
                    $ {formatMonto(r.precio_unitario)}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap font-mono font-semibold text-gray-800">
                    $ {formatMonto(r.monto_total)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => onEdit(r)}
                        title="Editar"
                        className="p-1.5 rounded-md text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
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

      {!isLoading && registros.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center gap-6 text-sm">
          <span className="font-medium text-gray-700">
            Total ARS:{' '}
            <span className="font-mono text-green-700">$ {formatMonto(total)}</span>
          </span>
          <span className="ml-auto text-gray-400">
            {registros.length} registro{registros.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
