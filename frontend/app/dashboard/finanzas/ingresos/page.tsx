'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import {
  getIngresos,
  deleteIngreso,
  PRODUCTO_INGRESO_VALUES,
  PRODUCTO_INGRESO_LABELS,
  type IngresosFilter,
  type IngresoResponse,
} from '@/lib/api/ingresos'
import IngresosTable from '@/components/finanzas/IngresosTable'
import IngresoForm from '@/components/finanzas/IngresoForm'

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

const EMPTY_FILTERS: IngresosFilter = {}

export default function IngresosPage() {
  const queryClient = useQueryClient()
  const [filtros, setFiltros] = useState<IngresosFilter>(EMPTY_FILTERS)
  const [modalOpen, setModalOpen] = useState(false)
  const [ingresoEditar, setIngresoEditar] = useState<IngresoResponse | null>(null)

  const { data: ingresos = [], isLoading } = useQuery({
    queryKey: ['ingresos', filtros],
    queryFn: () => getIngresos(filtros),
    staleTime: 30_000,
  })

  function openCreate() {
    setIngresoEditar(null)
    setModalOpen(true)
  }

  function openEdit(ingreso: IngresoResponse) {
    setIngresoEditar(ingreso)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setIngresoEditar(null)
  }

  async function handleDelete(id: string) {
    await deleteIngreso(id)
    queryClient.invalidateQueries({ queryKey: ['ingresos'] })
  }

  function handleFiltroChange(key: keyof IngresosFilter, value: string) {
    setFiltros((prev) => ({ ...prev, [key]: value || undefined }))
  }

  function limpiarFiltros() {
    setFiltros(EMPTY_FILTERS)
  }

  const inputCls =
    'rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
  const selectCls =
    'rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Ingresos</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
        >
          <Plus size={16} />
          Nuevo Ingreso
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Cliente</label>
            <input
              type="text"
              placeholder="Buscar cliente..."
              value={filtros.cliente ?? ''}
              onChange={(e) => handleFiltroChange('cliente', e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Producto</label>
            <select
              value={filtros.producto ?? ''}
              onChange={(e) => handleFiltroChange('producto', e.target.value)}
              className={selectCls}
            >
              <option value="">Todos</option>
              {PRODUCTO_INGRESO_VALUES.map((p) => (
                <option key={p} value={p}>{PRODUCTO_INGRESO_LABELS[p]}</option>
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
      <IngresosTable
        ingresos={ingresos}
        isLoading={isLoading}
        onEdit={openEdit}
        onDelete={handleDelete}
        onRefresh={() => queryClient.invalidateQueries({ queryKey: ['ingresos'] })}
      />

      {/* Sheet drawer */}
      <Sheet
        open={modalOpen}
        onClose={closeModal}
        title={ingresoEditar ? 'Editar Ingreso' : 'Nuevo Ingreso'}
      >
        <IngresoForm
          ingreso={ingresoEditar ?? undefined}
          onSuccess={closeModal}
          onCancel={closeModal}
        />
      </Sheet>
    </div>
  )
}
