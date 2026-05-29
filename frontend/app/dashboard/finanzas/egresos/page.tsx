'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import {
  getEgresos,
  deleteEgreso,
  TIPO_EGRESO_VALUES,
  TIPO_EGRESO_LABELS,
  type EgresosFilter,
  type EgresoResponse,
} from '@/lib/api/egresos'
import EgresosTable from '@/components/finanzas/EgresosTable'
import EgresoForm from '@/components/finanzas/EgresoForm'

// ─── Sheet (right-side drawer, no external deps) ─────────────────────────────

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
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-[480px] bg-white shadow-xl flex flex-col h-full">
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

// ─── Page ─────────────────────────────────────────────────────────────────────

const EMPTY_FILTERS: EgresosFilter = {}

export default function EgresosPage() {
  const queryClient = useQueryClient()
  const [filtros, setFiltros] = useState<EgresosFilter>(EMPTY_FILTERS)
  const [modalOpen, setModalOpen] = useState(false)
  const [egresoEditar, setEgresoEditar] = useState<EgresoResponse | null>(null)

  const { data: egresos = [], isLoading } = useQuery({
    queryKey: ['egresos', filtros],
    queryFn: () => getEgresos(filtros),
    staleTime: 30_000,
  })

  function openCreate() {
    setEgresoEditar(null)
    setModalOpen(true)
  }

  function openEdit(egreso: EgresoResponse) {
    setEgresoEditar(egreso)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEgresoEditar(null)
  }

  async function handleDelete(id: string) {
    await deleteEgreso(id)
    queryClient.invalidateQueries({ queryKey: ['egresos'] })
  }

  function handleFiltroChange(key: keyof EgresosFilter, value: string) {
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Egresos</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
        >
          <Plus size={16} />
          Nuevo Egreso
        </button>
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Tipo</label>
            <select
              value={filtros.tipo ?? ''}
              onChange={(e) => handleFiltroChange('tipo', e.target.value)}
              className={selectCls}
            >
              <option value="">Todos</option>
              {TIPO_EGRESO_VALUES.map((t) => (
                <option key={t} value={t}>{TIPO_EGRESO_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Moneda</label>
            <select
              value={filtros.moneda ?? ''}
              onChange={(e) => handleFiltroChange('moneda', e.target.value)}
              className={selectCls}
            >
              <option value="">Todas</option>
              <option value="ars">ARS</option>
              <option value="usd">USD</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Finca</label>
            <select
              value={filtros.finca ?? ''}
              onChange={(e) => handleFiltroChange('finca', e.target.value)}
              className={selectCls}
            >
              <option value="">Todas</option>
              <option value="los_mimbres">Los Mimbres</option>
              <option value="media_agua">Media Agua</option>
              <option value="caucete">Caucete</option>
            </select>
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
      <EgresosTable
        egresos={egresos}
        isLoading={isLoading}
        onEdit={openEdit}
        onDelete={handleDelete}
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ['egresos'] })}
      />

      {/* Sheet drawer */}
      <Sheet
        open={modalOpen}
        onClose={closeModal}
        title={egresoEditar ? 'Editar Egreso' : 'Nuevo Egreso'}
      >
        <EgresoForm
          egreso={egresoEditar ?? undefined}
          onSuccess={closeModal}
          onCancel={closeModal}
        />
      </Sheet>
    </div>
  )
}
