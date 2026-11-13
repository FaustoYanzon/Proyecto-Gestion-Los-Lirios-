'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardList, Search } from 'lucide-react'
import {
  FINCA_LABELS,
  GRAVEDAD_FALLA_LABELS,
  GRAVEDAD_FALLA_VALUES,
  getMaquinas,
  getMaquinariaErrorMessage,
  getOrdenes,
  type FincaMaquinaria,
  type GravedadFalla,
  type OrdenResponse,
} from '@/lib/api/maquinaria'
import { esGerencialUp } from '@/lib/maquinariaTransiciones'
import { usePaginatedList } from '@/lib/usePaginatedList'
import { useAuthStore } from '@/store/authStore'
import Drawer from '@/components/maquinaria/Drawer'
import OrdenFila from '@/components/maquinaria/OrdenFila'
import ReportarFallaForm from '@/components/maquinaria/ReportarFallaForm'
import { btnPrimary, fmtOM } from '@/components/maquinaria/ordenUi'
import EmptyState from '@/components/ui/EmptyState'
import FormError from '@/components/ui/FormError'

// Backend cap of GET /maquinaria/ordenes (Query le=500).
const LIMIT = 500
const PAGE_SIZE = 10

type Vista = 'pendientes' | 'terminadas' | 'todas'
const VISTAS: { value: Vista; label: string }[] = [
  { value: 'pendientes', label: 'Pendientes' },
  { value: 'terminadas', label: 'Terminadas' },
  { value: 'todas', label: 'Todas' },
]

const selectCls =
  'rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'

// Matches the OM number ("12", "OM-0012") or any text of the order.
function coincideBusqueda(o: OrdenResponse, q: string): boolean {
  const term = q.trim().toLowerCase()
  if (!term) return true
  const num = term.replace(/^om-?/, '')
  if (/^\d+$/.test(num) && Number(num) === o.numero) return true
  const haystack = [fmtOM(o.numero), o.descripcion, o.maquina.marca, o.maquina.modelo, o.maquina.patente_serie, o.taller]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

export default function OrdenesPage() {
  const role = useAuthStore((s) => s.user?.role)
  const esGerencial = esGerencialUp(role)

  const [vista, setVista] = useState<Vista>('pendientes')
  const [busqueda, setBusqueda] = useState('')
  const [maquinaId, setMaquinaId] = useState('')
  const [gravedad, setGravedad] = useState<GravedadFalla | ''>('')
  // Only gerencial+ can filter by finca: the API pins the encargado to their own.
  const [finca, setFinca] = useState<FincaMaquinaria | ''>('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const closeSheet = useCallback(() => setSheetOpen(false), [])

  const serverFilter = {
    maquina_id: maquinaId || undefined,
    finca: esGerencial && finca ? finca : undefined,
    abiertas: vista === 'pendientes' ? true : vista === 'terminadas' ? false : undefined,
  }

  const { data: maquinas = [] } = useQuery({
    queryKey: ['maquinaria', 'maquinas', 'todas'],
    queryFn: () => getMaquinas({ incluir_inactivas: true }),
    staleTime: 60_000,
  })

  const ordenesQ = useQuery({
    queryKey: ['maquinaria', 'ordenes', serverFilter],
    queryFn: () => getOrdenes({ ...serverFilter, limit: LIMIT }),
    staleTime: 30_000,
  })

  // Newest first; memoized so pagination only resets when the list really changes.
  const ordenes = useMemo(
    () =>
      (ordenesQ.data ?? [])
        .filter((o) => (!gravedad || o.gravedad === gravedad) && coincideBusqueda(o, busqueda))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [ordenesQ.data, gravedad, busqueda]
  )
  const truncated = (ordenesQ.data?.length ?? 0) >= LIMIT

  const { page, setPage, totalPages, paged } = usePaginatedList(ordenes, PAGE_SIZE)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Órdenes de maquinaria</h1>
        <button onClick={() => setSheetOpen(true)} className={btnPrimary}>
          <AlertTriangle size={16} /> Reportar falla
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 space-y-3">
        <div className="inline-flex rounded-md border border-gray-300 overflow-hidden" role="tablist">
          {VISTAS.map((v) => (
            <button
              key={v.value}
              type="button"
              role="tab"
              aria-selected={vista === v.value}
              onClick={() => setVista(v.value)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                vista === v.value ? 'bg-[#7a1f2c] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Buscar</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="OM-0012 o texto"
                className={`${selectCls} w-full pl-8`}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Máquina</label>
            <select value={maquinaId} onChange={(e) => setMaquinaId(e.target.value)} className={selectCls}>
              <option value="">Todas</option>
              {maquinas.map((m) => (
                <option key={m.id} value={m.id}>{m.marca} {m.modelo}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Gravedad</label>
            <select
              value={gravedad}
              onChange={(e) => setGravedad(e.target.value as GravedadFalla | '')}
              className={selectCls}
            >
              <option value="">Todas</option>
              {GRAVEDAD_FALLA_VALUES.map((g) => (
                <option key={g} value={g}>{GRAVEDAD_FALLA_LABELS[g]}</option>
              ))}
            </select>
          </div>
          {esGerencial && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Finca</label>
              <select
                value={finca}
                onChange={(e) => setFinca(e.target.value as FincaMaquinaria | '')}
                className={selectCls}
              >
                <option value="">Todas</option>
                {(Object.keys(FINCA_LABELS) as FincaMaquinaria[]).map((f) => (
                  <option key={f} value={f}>{FINCA_LABELS[f]}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {ordenesQ.error && (
        <FormError
          title="No se pudieron cargar las órdenes"
          description={getMaquinariaErrorMessage(ordenesQ.error, 'Error de conexión. Intente nuevamente.')}
        />
      )}
      {truncated && (
        <FormError description={`Se muestran las primeras ${LIMIT} órdenes. Acotá con los filtros para ver el resto.`} />
      )}

      {ordenesQ.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : ordenes.length === 0 && !ordenesQ.error ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <EmptyState
            icon={ClipboardList}
            title={vista === 'pendientes' ? 'No hay órdenes pendientes' : 'No hay órdenes para mostrar'}
            description="Cuando se reporte una falla va a aparecer acá, o ajustá los filtros."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {paged.map((o) => (
            <OrdenFila key={o.id} orden={o} />
          ))}

          {totalPages > 1 && (
            <div className="px-1 py-2.5 flex items-center justify-between text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={14} /> Anterior
              </button>
              <span className="text-xs text-gray-500">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, ordenes.length)} de {ordenes.length}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Siguiente <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      <Drawer open={sheetOpen} onClose={closeSheet} title="Reportar falla">
        {sheetOpen && <ReportarFallaForm onSuccess={closeSheet} onCancel={closeSheet} />}
      </Drawer>
    </div>
  )
}
