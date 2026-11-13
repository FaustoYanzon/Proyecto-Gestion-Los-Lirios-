'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Tractor } from 'lucide-react'
import {
  getMaquinas,
  getMaquinariaErrorMessage,
  TIPO_MAQUINA_VALUES,
  TIPO_MAQUINA_LABELS,
  ESTADO_MAQUINA_VALUES,
  ESTADO_MAQUINA_LABELS,
  FINCA_LABELS,
  type EstadoMaquina,
  type FincaMaquinaria,
  type TipoMaquina,
} from '@/lib/api/maquinaria'
import { usePaginatedList } from '@/lib/usePaginatedList'
import { useAuthStore } from '@/store/authStore'
import MaquinaIcon from '@/components/maquinaria/MaquinaIcon'
import EstadoMaquinaBadge from '@/components/maquinaria/EstadoMaquinaBadge'
import Drawer from '@/components/maquinaria/Drawer'
import MaquinaForm from '@/components/maquinaria/MaquinaForm'
import EmptyState from '@/components/ui/EmptyState'
import FormError from '@/components/ui/FormError'

const PAGE_SIZE = 10

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MaquinariaPage() {
  const role = useAuthStore((s) => s.user?.role)
  const esGerencial = role === 'super_admin' || role === 'gerencial'

  const [tipo, setTipo] = useState<TipoMaquina | ''>('')
  const [estado, setEstado] = useState<EstadoMaquina | ''>('')
  // Only gerencial+ can filter by finca: the API pins the encargado to their own.
  const [finca, setFinca] = useState<FincaMaquinaria | ''>('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const closeSheet = useCallback(() => setSheetOpen(false), [])

  const filter = {
    tipo: tipo || undefined,
    estado: estado || undefined,
    finca: esGerencial && finca ? finca : undefined,
  }

  const { data: maquinas = [], isLoading, error } = useQuery({
    queryKey: ['maquinaria', 'maquinas', filter],
    queryFn: () => getMaquinas(filter),
    staleTime: 30_000,
  })

  const { page, setPage, totalPages, paged } = usePaginatedList(maquinas, PAGE_SIZE)

  const selectCls =
    'rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
  const th = 'text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap'
  const columnas = 6

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Maquinaria</h1>
        {esGerencial && (
          <button
            onClick={() => setSheetOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={16} /> Nueva máquina
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tipo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoMaquina | '')} className={selectCls}>
              <option value="">Todos</option>
              {TIPO_MAQUINA_VALUES.map((t) => (
                <option key={t} value={t}>{TIPO_MAQUINA_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Estado</label>
            <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoMaquina | '')} className={selectCls}>
              <option value="">Todos</option>
              {ESTADO_MAQUINA_VALUES.map((e) => (
                <option key={e} value={e}>{ESTADO_MAQUINA_LABELS[e]}</option>
              ))}
            </select>
          </div>
          {esGerencial && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Finca</label>
              <select value={finca} onChange={(e) => setFinca(e.target.value as FincaMaquinaria | '')} className={selectCls}>
                <option value="">Todas</option>
                {(Object.keys(FINCA_LABELS) as FincaMaquinaria[]).map((f) => (
                  <option key={f} value={f}>{FINCA_LABELS[f]}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {error && (
        <FormError
          title="No se pudo cargar la maquinaria"
          description={getMaquinariaErrorMessage(error, 'Error de conexión. Intente nuevamente.')}
        />
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className={th}>Estado</th>
                <th className={th}>Tipo</th>
                <th className={th}>Máquina</th>
                <th className={th}>Patente / Serie</th>
                <th className={th}>Finca</th>
                <th className={`${th} text-right`}>Órdenes abiertas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: columnas }).map((_, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : maquinas.length === 0 ? (
                <tr>
                  <td colSpan={columnas}>
                    <EmptyState
                      icon={Tractor}
                      title="No hay máquinas para mostrar"
                      description={
                        esGerencial
                          ? 'Cargá la primera con "Nueva máquina" o ajustá los filtros.'
                          : 'Ajustá los filtros o consultá con gerencia.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                paged.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-3 whitespace-nowrap">
                      <EstadoMaquinaBadge estado={m.estado} semaforo={m.semaforo} />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-700">{TIPO_MAQUINA_LABELS[m.tipo]}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <Link
                        href={`/dashboard/maquinaria/${m.id}`}
                        className="inline-flex items-center gap-1.5 font-medium text-[#7a1f2c] hover:underline"
                      >
                        <MaquinaIcon icono={m.icono} size={16} className="shrink-0" />
                        {m.marca} {m.modelo}
                      </Link>
                      {m.anio && <span className="text-gray-400"> · {m.anio}</span>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap font-mono text-gray-700">{m.patente_serie || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-700">{FINCA_LABELS[m.finca]}</td>
                    <td className="px-3 py-3 text-right font-mono text-gray-800">{m.ordenes_abiertas}</td>
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
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="text-xs text-gray-500">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, maquinas.length)} de {maquinas.length}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {esGerencial && (
        <Drawer open={sheetOpen} onClose={closeSheet} title="Nueva máquina">
          {sheetOpen && <MaquinaForm onSuccess={closeSheet} onCancel={closeSheet} />}
        </Drawer>
      )}
    </div>
  )
}
