'use client'

import { useState, useEffect } from 'react'
import { Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatHoraLocal, type RiegoResponse } from '@/lib/api/riego'

function formatDate(d: string) {
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

// inicio/fin vienen del backend en UTC: hay que convertirlos a hora de
// Argentina, nunca recortar el string ISO crudo (eso mostraba la hora UTC).
function formatTime(dt: string) {
  return formatHoraLocal(dt)
}

function formatHoras(h: number) {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`
}

interface Props {
  riegos: RiegoResponse[]
  isLoading: boolean
  parcelaNombre: (id: string) => string
  onEdit: (r: RiegoResponse) => void
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

const PAGE_SIZE = 10

export default function RiegoTable({ riegos, isLoading, parcelaNombre, onEdit, onDelete }: Props) {
  const [page, setPage] = useState(1)

  useEffect(() => { setPage(1) }, [riegos])

  const totalPages = Math.max(1, Math.ceil(riegos.length / PAGE_SIZE))
  const pagedRiegos = riegos.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function handleDelete(id: string) {
    if (window.confirm('¿Eliminar este registro de riego?')) onDelete(id)
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Fecha</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Parcela</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Cab./Válv.</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Inicio → Fin</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Duración</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">mm</th>
              <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Litros</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Fertilizante</th>
              <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Responsable</th>
              <th className="px-3 py-3 font-medium text-gray-600 text-center whitespace-nowrap">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
            ) : riegos.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-gray-400">
                  No hay registros de riego
                </td>
              </tr>
            ) : (
              pagedRiegos.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">{formatDate(r.fecha)}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-900 font-medium">{parcelaNombre(r.parcela_id)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                      C{r.cabezal} · V{r.valvula.split(',').join('+')}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap font-mono text-gray-600 text-xs">
                    {formatTime(r.inicio)} → {formatTime(r.fin)}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-gray-700">
                    {formatHoras(r.duracion_horas)}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap font-mono font-semibold text-blue-700">
                    {r.mm_aplicados != null ? `${r.mm_aplicados} mm` : '—'}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-blue-700">
                    {r.litros_aplicados.toLocaleString('es-AR')} L
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-600 text-xs">
                    {r.fertilizante_nombre
                      ? `${r.fertilizante_nombre} (${r.fertilizante_dosis_lt_ha} L/ha)`
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-gray-700">{r.responsable}</td>
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
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, riegos.length)} de {riegos.length}
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

      {!isLoading && riegos.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center gap-6 text-sm">
          <span className="font-medium text-gray-700">
            Total:{' '}
            <span className="font-mono text-blue-700">
              {riegos.reduce((s, r) => s + (r.mm_aplicados ?? 0), 0).toFixed(1)} mm
            </span>
            {' · '}
            <span className="font-mono text-blue-700">
              {riegos.reduce((s, r) => s + (r.litros_aplicados ?? 0), 0).toLocaleString('es-AR')} L acumulados
            </span>
          </span>
          <span className="ml-auto text-gray-400">
            {riegos.length} registro{riegos.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
