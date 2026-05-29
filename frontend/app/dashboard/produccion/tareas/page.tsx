'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Download } from 'lucide-react'
import {
  getTrabajos,
  deleteTrabajo,
  getParcelas,
  formatParcelaLabel,
  TAREAS_POR_TEMPORADA,
  TEMPORADA_LABELS,
  UNIDAD_LABELS,
  type TrabajoFilter,
  type RegistroTrabajoResponse,
  type UnidadMedida,
} from '@/lib/api/produccion'
import TareasTable from '@/components/produccion/TareasTable'
import TareaForm from '@/components/produccion/TareaForm'

// ─── Sheet ────────────────────────────────────────────────────────────────────

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

function Sheet({ open, onClose, title, children }: SheetProps) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [open, handleKey])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-[520px] bg-white shadow-xl flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  )
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportCSV(trabajos: RegistroTrabajoResponse[], parcelaMap: Record<string, string>) {
  const headers = [
    'Fecha', 'Parcela', 'Trabajador', 'Tarea', 'Temporada',
    'Cantidad', 'Unidad', 'Precio Unit. ARS', 'Total ARS', 'Detalle',
  ]
  const rows = trabajos.map((t) => [
    t.fecha,
    t.parcela_id ? (parcelaMap[t.parcela_id] ?? t.parcela_id) : 'General',
    t.trabajador_nombre,
    t.tarea,
    TEMPORADA_LABELS[t.clasificacion] ?? t.clasificacion,
    t.cantidad,
    UNIDAD_LABELS[t.unidad_medida as UnidadMedida] ?? t.unidad_medida,
    t.precio_unitario,
    t.monto_total,
    t.detalle ?? '',
  ])
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tareas-${new Date().toISOString().split('T')[0]}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const EMPTY_FILTERS: TrabajoFilter = {}

const TODAS_LAS_TAREAS = Array.from(
  new Set(Object.values(TAREAS_POR_TEMPORADA).flat())
).sort()

export default function TareasPage() {
  const queryClient = useQueryClient()
  const [filtros, setFiltros] = useState<TrabajoFilter>(EMPTY_FILTERS)
  const [modalOpen, setModalOpen] = useState(false)
  const [registroEditar, setRegistroEditar] = useState<RegistroTrabajoResponse | null>(null)

  const { data: trabajos = [], isLoading } = useQuery({
    queryKey: ['trabajos', filtros],
    queryFn: () => getTrabajos(filtros),
    staleTime: 30_000,
  })

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas'],
    queryFn: getParcelas,
    staleTime: 5 * 60_000,
  })

  const parcelaMap = Object.fromEntries(parcelas.map((p) => [p.id, p.nombre]))

  function parcelaNombre(id: string | null): string {
    if (!id) return 'General'
    return parcelas.find((p) => p.id === id)?.nombre ?? id
  }

  function openCreate() {
    setRegistroEditar(null)
    setModalOpen(true)
  }

  function openEdit(r: RegistroTrabajoResponse) {
    setRegistroEditar(r)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setRegistroEditar(null)
  }

  async function handleDelete(id: string) {
    await deleteTrabajo(id)
    queryClient.invalidateQueries({ queryKey: ['trabajos'] })
  }

  function handleFiltroChange(key: keyof TrabajoFilter, value: string) {
    setFiltros((prev) => ({ ...prev, [key]: value || undefined }))
  }

  function limpiarFiltros() {
    setFiltros(EMPTY_FILTERS)
  }

  const inputCls =
    'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
  const selectCls =
    'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Tarea Diaria</h1>
        <div className="flex items-center gap-2">
          {trabajos.length > 0 && (
            <button
              onClick={() => exportCSV(trabajos, parcelaMap)}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              title="Exportar registros actuales a CSV"
            >
              <Download size={15} />
              CSV
            </button>
          )}
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={16} />
            Nuevo Registro
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Desde</label>
            <input
              type="date"
              value={filtros.fecha_desde ?? ''}
              onChange={(e) => handleFiltroChange('fecha_desde', e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Hasta</label>
            <input
              type="date"
              value={filtros.fecha_hasta ?? ''}
              onChange={(e) => handleFiltroChange('fecha_hasta', e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Parcela</label>
            <select
              value={filtros.parcela_id ?? ''}
              onChange={(e) => handleFiltroChange('parcela_id', e.target.value)}
              className={selectCls}
            >
              <option value="">Todas</option>
              {parcelas.filter((p) => p.is_active).map((p) => (
                <option key={p.id} value={p.id}>
                  {formatParcelaLabel(p.nombre)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tarea</label>
            <select
              value={filtros.tarea ?? ''}
              onChange={(e) => handleFiltroChange('tarea', e.target.value)}
              className={selectCls}
            >
              <option value="">Todas</option>
              {TODAS_LAS_TAREAS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Trabajador</label>
            <input
              type="text"
              placeholder="Nombre..."
              value={filtros.trabajador_nombre ?? ''}
              onChange={(e) => handleFiltroChange('trabajador_nombre', e.target.value)}
              className={inputCls}
            />
          </div>

          <button
            onClick={limpiarFiltros}
            className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {/* Table */}
      <TareasTable
        registros={trabajos}
        isLoading={isLoading}
        parcelaNombre={parcelaNombre}
        onEdit={openEdit}
        onDelete={handleDelete}
      />

      {/* Sheet */}
      <Sheet
        open={modalOpen}
        onClose={closeModal}
        title={registroEditar ? 'Editar Registro' : 'Nuevo Registro'}
      >
        <TareaForm
          registro={registroEditar ?? undefined}
          parcelas={parcelas}
          onSuccess={closeModal}
          onCancel={closeModal}
        />
      </Sheet>
    </div>
  )
}
