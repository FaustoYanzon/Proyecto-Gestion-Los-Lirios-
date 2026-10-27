'use client'

import { useState } from 'react'
import { Pencil, Trash2, RotateCcw, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { FitosanitarioResponse } from '@/lib/api/fitosanitarios'
import { usePaginatedList } from '@/lib/usePaginatedList'

function formatDate(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

const today = new Date().toISOString().split('T')[0]

interface Props {
  registros: FitosanitarioResponse[]
  isLoading: boolean
  parcelaNombre: (id: string) => string
  // Sin handlers la tabla queda de solo lectura (roles sin permiso de corrección).
  onEdit?: (r: FitosanitarioResponse) => void
  onDelete?: (id: string) => void | Promise<void>
  // Only offered for rows that came from an order (orden_id set).
  onReactivar?: (id: string) => void | Promise<void>
  // For rows from an order: describes the whole valve/parcel application that
  // Eliminar/Reactivar revert (every product of it), shown in the confirmation.
  alcanceAplicacion?: (r: FitosanitarioResponse) => Promise<string>
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 10 }).map((_, i) => (
        <td key={i} className="px-3 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
      ))}
    </tr>
  )
}

const PAGE_SIZE = 10

export default function FitosanitariosTable({
  registros, isLoading, parcelaNombre, onEdit, onDelete, onReactivar, alcanceAplicacion,
}: Props) {
  const { page, setPage, totalPages, paged: pagedRegistros } = usePaginatedList(registros, PAGE_SIZE)
  // Row whose confirmation text is being prepared (order lookup in flight).
  const [preparando, setPreparando] = useState<string | null>(null)

  async function alcanceDe(r: FitosanitarioResponse): Promise<string> {
    if (!r.orden_id || !alcanceAplicacion) return ''
    setPreparando(r.id)
    try {
      return await alcanceAplicacion(r)
    } finally {
      setPreparando(null)
    }
  }

  async function handleDelete(r: FitosanitarioResponse) {
    if (!onDelete || preparando) return
    const alcance = await alcanceDe(r)
    const cabecera = `Vas a eliminar la aplicación de ${r.producto_nombre} en ${parcelaNombre(r.parcela_id)} (${formatDate(r.fecha)}).\n\n`
    // Typed confirmation: a stray click on the trash icon once reopened two
    // completed orders. Parent handles errors.
    const respuesta = window.prompt(
      alcance
        ? cabecera + `${alcance}\n\n` +
          'Se quitan del sistema y se devuelve el stock de cada producto. La válvula (o parcela) sale de la orden, y si era la última la orden se elimina.\n' +
          'Si lo que querés es dejarla pendiente, usá "Reactivar".\n\n' +
          'Para confirmar escribí ELIMINAR.'
        : cabecera +
          'Se quita del sistema y se devuelve el stock. Si vino de una orden, la parcela (o válvula) también sale de la orden, y si era la última la orden se elimina.\n' +
          'Si lo que querés es dejarla pendiente, usá "Reactivar".\n\n' +
          'Para confirmar escribí ELIMINAR.',
    )
    if (respuesta?.trim().toUpperCase() === 'ELIMINAR') void onDelete(r.id)
  }

  async function handleReactivar(r: FitosanitarioResponse) {
    if (!onReactivar || preparando) return
    const alcance = await alcanceDe(r)
    const ok = window.confirm(
      `Vas a reactivar la aplicación de ${r.producto_nombre} en ${parcelaNombre(r.parcela_id)} (${formatDate(r.fecha)}).\n\n` +
      (alcance
        ? `${alcance}\n\nSe devuelve el stock de cada producto y la aplicación vuelve a quedar pendiente en la orden.`
        : 'Se devuelve el stock y la aplicación vuelve a quedar pendiente en la orden.'),
    )
    if (ok) void onReactivar(r.id)
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Estado</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Fecha</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Parcela</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Producto</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Dosis/ha</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Total aplicado</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Motivo</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Carencia</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Hab. Cosecha</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Responsable</th>
              <th className="px-3 py-3 font-medium text-gray-600 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
            ) : registros.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-3 py-12 text-center text-gray-400">
                  No hay registros fitosanitarios
                </td>
              </tr>
            ) : (
              pagedRegistros.map((r) => {
                const enCarencia = r.fecha_habilitacion_cosecha > today
                return (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-3">
                      {enCarencia ? (
                        <span title="En período de carencia">
                          <AlertTriangle size={15} className="text-amber-500" />
                        </span>
                      ) : (
                        <span title="Habilitado para cosechar">
                          <CheckCircle2 size={15} className="text-green-500" />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-700">{formatDate(r.fecha)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-900 font-medium">{parcelaNombre(r.parcela_id)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-800 font-medium">{r.producto_nombre}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-gray-700">{r.dosis_por_ha} {r.unidad ?? ''}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-gray-700">{r.cantidad_total ?? '—'} {r.cantidad_total != null ? r.unidad : ''}</td>
                    <td className="px-3 py-3 text-gray-600 max-w-[180px] truncate">{r.motivo}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${enCarencia ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                        {r.dias_carencia}d
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-600">
                      <span className={`text-xs ${enCarencia ? 'text-amber-700 font-medium' : 'text-gray-500'}`}>
                        {formatDate(r.fecha_habilitacion_cosecha)}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-700">{r.responsable}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {onEdit && (
                          <button onClick={() => onEdit(r)} title="Corregir" className="p-1.5 rounded-md text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors">
                            <Pencil size={15} />
                          </button>
                        )}
                        {onReactivar && r.orden_id && (
                          <button
                            onClick={() => void handleReactivar(r)}
                            disabled={preparando === r.id}
                            title="Reactivar: volver a pendiente"
                            aria-label="Reactivar: volver a pendiente"
                            className="p-1.5 rounded-md text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] disabled:opacity-40 transition-colors"
                          >
                            <RotateCcw size={15} />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            onClick={() => void handleDelete(r)}
                            disabled={preparando === r.id}
                            title="Eliminar"
                            className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      {!isLoading && totalPages > 1 && (
        <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-sm">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={14} /> Anterior
          </button>
          <span className="text-xs text-gray-500">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, registros.length)} de {registros.length}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Siguiente <ChevronRight size={14} />
          </button>
        </div>
      )}

      {!isLoading && registros.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-amber-600">
            <AlertTriangle size={13} />
            {registros.filter(r => r.fecha_habilitacion_cosecha > today).length} en carencia
          </span>
          <span className="flex items-center gap-1.5 text-green-600">
            <CheckCircle2 size={13} />
            {registros.filter(r => r.fecha_habilitacion_cosecha <= today).length} habilitados
          </span>
          <span className="ml-auto text-gray-400">{registros.length} registros</span>
        </div>
      )}
    </div>
  )
}
