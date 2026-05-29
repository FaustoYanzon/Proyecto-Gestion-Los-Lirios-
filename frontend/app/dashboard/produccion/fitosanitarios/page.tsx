'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, AlertTriangle } from 'lucide-react'
import {
  getFitosanitarios, deleteFitosanitario, getAlertasCarencia,
  type FitosanitarioFilter, type FitosanitarioResponse,
} from '@/lib/api/fitosanitarios'
import { getParcelas } from '@/lib/api/produccion'
import FitosanitariosTable from '@/components/produccion/FitosanitariosTable'
import FitosanitarioForm from '@/components/produccion/FitosanitarioForm'

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
          <button onClick={onClose} className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  )
}

const EMPTY_FILTERS: FitosanitarioFilter = {}
const today = new Date().toISOString().split('T')[0]

export default function FitosanitariosPage() {
  const queryClient = useQueryClient()
  const [filtros, setFiltros] = useState<FitosanitarioFilter>(EMPTY_FILTERS)
  const [modalOpen, setModalOpen] = useState(false)
  const [registroEditar, setRegistroEditar] = useState<FitosanitarioResponse | null>(null)

  const { data: registros = [], isLoading } = useQuery({
    queryKey: ['fitosanitarios', filtros],
    queryFn: () => getFitosanitarios(filtros),
    staleTime: 30_000,
  })

  const { data: alertas = [] } = useQuery({
    queryKey: ['fitosanitarios-alertas'],
    queryFn: getAlertasCarencia,
    staleTime: 60_000,
  })

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas'],
    queryFn: getParcelas,
    staleTime: 5 * 60_000,
  })

  function parcelaNombre(id: string) {
    return parcelas.find((p) => p.id === id)?.nombre ?? id
  }

  function openCreate() { setRegistroEditar(null); setModalOpen(true) }
  function openEdit(r: FitosanitarioResponse) { setRegistroEditar(r); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setRegistroEditar(null) }

  async function handleDelete(id: string) {
    await deleteFitosanitario(id)
    queryClient.invalidateQueries({ queryKey: ['fitosanitarios'] })
    queryClient.invalidateQueries({ queryKey: ['fitosanitarios-alertas'] })
  }

  function setFiltro(key: keyof FitosanitarioFilter, value: string) {
    setFiltros((prev) => ({ ...prev, [key]: value || undefined }))
  }

  const inputCls = 'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
  const selectCls = 'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Fitosanitarios</h1>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors">
          <Plus size={16} />
          Nueva Aplicación
        </button>
      </div>

      {/* Alertas carencia */}
      {alertas.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2 text-amber-800 font-medium text-sm">
            <AlertTriangle size={15} />
            {alertas.length} producto{alertas.length !== 1 ? 's' : ''} aún en período de carencia
          </div>
          <div className="flex flex-wrap gap-2">
            {alertas.map((a) => (
              <span key={a.id} className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">
                {parcelaNombre(a.parcela_id)} — {a.producto_nombre} (hasta {a.fecha_habilitacion_cosecha.split('-').reverse().join('/')})
              </span>
            ))}
          </div>
        </div>
      )}

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
            <label className="block text-xs font-medium text-gray-500 mb-1">Parcela</label>
            <select value={filtros.parcela_id ?? ''} onChange={(e) => setFiltro('parcela_id', e.target.value)} className={selectCls}>
              <option value="">Todas</option>
              {parcelas.filter((p) => p.is_active && p.tipo === 'parral').map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Producto</label>
            <input type="text" placeholder="Buscar..." value={filtros.producto_nombre ?? ''} onChange={(e) => setFiltro('producto_nombre', e.target.value)} className={inputCls} />
          </div>
          <button onClick={() => setFiltros(EMPTY_FILTERS)} className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
            Limpiar filtros
          </button>
        </div>
      </div>

      <FitosanitariosTable
        registros={registros}
        isLoading={isLoading}
        parcelaNombre={parcelaNombre}
        onEdit={openEdit}
        onDelete={handleDelete}
      />

      <Sheet open={modalOpen} onClose={closeModal} title={registroEditar ? 'Editar Aplicación' : 'Nueva Aplicación Fitosanitaria'}>
        <FitosanitarioForm
          registro={registroEditar ?? undefined}
          parcelas={parcelas}
          onSuccess={closeModal}
          onCancel={closeModal}
        />
      </Sheet>
    </div>
  )
}
