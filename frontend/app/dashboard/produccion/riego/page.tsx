'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import {
  getRiegos,
  deleteRiego,
  type RiegoFilter,
  type RiegoResponse,
} from '@/lib/api/riego'
import { getParcelas } from '@/lib/api/produccion'
import RiegoTable from '@/components/produccion/RiegoTable'
import RiegoForm from '@/components/produccion/RiegoForm'

// ─── Sheet ────────────────────────────────────────────────────────────────────

function Sheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode
}) {
  const handleKey = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }, [onClose])
  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = '' }
  }, [open, handleKey])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-[480px] bg-white shadow-xl flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const EMPTY_FILTERS: RiegoFilter = {}

export default function RiegoPage() {
  const queryClient = useQueryClient()
  const [filtros, setFiltros] = useState<RiegoFilter>(EMPTY_FILTERS)
  const [modalOpen, setModalOpen] = useState(false)
  const [riegoEditar, setRiegoEditar] = useState<RiegoResponse | null>(null)

  const { data: riegos = [], isLoading } = useQuery({
    queryKey: ['riegos', filtros],
    queryFn: () => getRiegos(filtros),
    staleTime: 30_000,
  })

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas'],
    queryFn: getParcelas,
    staleTime: 5 * 60_000,
  })

  function parcelaNombre(id: string): string {
    return parcelas.find((p) => p.id === id)?.nombre ?? id
  }

  function openCreate() { setRiegoEditar(null); setModalOpen(true) }
  function openEdit(r: RiegoResponse) { setRiegoEditar(r); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setRiegoEditar(null) }

  async function handleDelete(id: string) {
    await deleteRiego(id)
    queryClient.invalidateQueries({ queryKey: ['riegos'] })
  }

  function setFiltro(key: keyof RiegoFilter, value: string) {
    setFiltros((prev) => ({ ...prev, [key]: value || undefined }))
  }

  const inputCls = 'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
  const selectCls = 'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'

  const parralesConRiego = parcelas.filter(
    (p) => p.is_active && p.cabezal_riego && p.cabezal_riego !== 'MANTO'
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Riego</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
        >
          <Plus size={16} />
          Nuevo Riego
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Desde</label>
            <input type="date" value={filtros.fecha_desde ?? ''} onChange={(e) => setFiltro('fecha_desde', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Hasta</label>
            <input type="date" value={filtros.fecha_hasta ?? ''} onChange={(e) => setFiltro('fecha_hasta', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Cabezal</label>
            <select value={filtros.cabezal ?? ''} onChange={(e) => setFiltro('cabezal', e.target.value)} className={selectCls}>
              <option value="">Todos</option>
              {['1', '2', '3', '4'].map((c) => (
                <option key={c} value={c}>Cabezal {c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Parcela</label>
            <select value={filtros.parcela_id ?? ''} onChange={(e) => setFiltro('parcela_id', e.target.value)} className={selectCls}>
              <option value="">Todas</option>
              {parralesConRiego.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Responsable</label>
            <input type="text" placeholder="Nombre..." value={filtros.responsable ?? ''} onChange={(e) => setFiltro('responsable', e.target.value)} className={inputCls} />
          </div>
          <button onClick={() => setFiltros(EMPTY_FILTERS)} className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
            Limpiar filtros
          </button>
        </div>
      </div>

      <RiegoTable
        riegos={riegos}
        isLoading={isLoading}
        parcelaNombre={parcelaNombre}
        onEdit={openEdit}
        onDelete={handleDelete}
      />

      <Sheet open={modalOpen} onClose={closeModal} title={riegoEditar ? 'Editar Riego' : 'Nuevo Riego'}>
        <RiegoForm
          riego={riegoEditar ?? undefined}
          parcelas={parcelas}
          onSuccess={closeModal}
          onCancel={closeModal}
        />
      </Sheet>
    </div>
  )
}
