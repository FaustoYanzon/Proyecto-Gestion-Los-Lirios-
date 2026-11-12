'use client'

import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardList } from 'lucide-react'
import {
  ESTADO_ORDEN_LABELS,
  FINCA_LABELS,
  GRAVEDAD_FALLA_LABELS,
  GRAVEDAD_FALLA_VALUES,
  getMaquinas,
  getMaquinariaErrorMessage,
  getOrdenes,
  type EstadoOrden,
  type FincaMaquinaria,
  type GravedadFalla,
  type OrdenResponse,
} from '@/lib/api/maquinaria'
import { ESTADOS_ABIERTOS, esGerencialUp } from '@/lib/maquinariaTransiciones'
import { useAuthStore } from '@/store/authStore'
import Drawer from '@/components/maquinaria/Drawer'
import OrdenCard from '@/components/maquinaria/OrdenCard'
import ReportarFallaForm from '@/components/maquinaria/ReportarFallaForm'
import { btnPrimary } from '@/components/maquinaria/ordenUi'
import EmptyState from '@/components/ui/EmptyState'
import FormError from '@/components/ui/FormError'

// Backend cap of GET /maquinaria/ordenes (Query le=500).
const LIMIT = 500
const ESTADOS_CERRADOS: EstadoOrden[] = ['cerrada', 'cancelada']

function groupByEstado(ordenes: OrdenResponse[]): Map<EstadoOrden, OrdenResponse[]> {
  const map = new Map<EstadoOrden, OrdenResponse[]>()
  for (const o of ordenes) {
    const list = map.get(o.estado)
    if (list) list.push(o)
    else map.set(o.estado, [o])
  }
  return map
}

const selectCls =
  'rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'

export default function OrdenesTableroPage() {
  const role = useAuthStore((s) => s.user?.role)
  const esGerencial = esGerencialUp(role)

  const [maquinaId, setMaquinaId] = useState('')
  const [gravedad, setGravedad] = useState<GravedadFalla | ''>('')
  // Only gerencial+ can filter by finca: the API pins the encargado to their own.
  const [finca, setFinca] = useState<FincaMaquinaria | ''>('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [showCerradas, setShowCerradas] = useState(false)
  const closeSheet = useCallback(() => setSheetOpen(false), [])

  const serverFilter = {
    maquina_id: maquinaId || undefined,
    finca: esGerencial && finca ? finca : undefined,
  }

  const { data: maquinas = [] } = useQuery({
    queryKey: ['maquinaria', 'maquinas', 'todas'],
    queryFn: () => getMaquinas({ incluir_inactivas: true }),
    staleTime: 60_000,
  })

  const abiertasQ = useQuery({
    queryKey: ['maquinaria', 'ordenes', 'abiertas', serverFilter],
    queryFn: () => getOrdenes({ ...serverFilter, abiertas: true, limit: LIMIT }),
    staleTime: 30_000,
  })

  // Closed/cancelled orders only load when the section is expanded.
  const cerradasQ = useQuery({
    queryKey: ['maquinaria', 'ordenes', 'cerradas', serverFilter],
    queryFn: () => getOrdenes({ ...serverFilter, abiertas: false, limit: LIMIT }),
    enabled: showCerradas,
    staleTime: 30_000,
  })

  const byGravedad = (o: OrdenResponse) => !gravedad || o.gravedad === gravedad
  const abiertas = (abiertasQ.data ?? []).filter(byGravedad)
  const cerradas = (cerradasQ.data ?? []).filter(byGravedad)
  const abiertasPorEstado = groupByEstado(abiertas)
  const cerradasPorEstado = groupByEstado(cerradas)
  const truncated = (abiertasQ.data?.length ?? 0) >= LIMIT || (cerradasQ.data?.length ?? 0) >= LIMIT

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Órdenes de maquinaria</h1>
        <button onClick={() => setSheetOpen(true)} className={btnPrimary}>
          <AlertTriangle size={16} /> Reportar falla
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
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

      {abiertasQ.error && (
        <FormError
          title="No se pudieron cargar las órdenes"
          description={getMaquinariaErrorMessage(abiertasQ.error, 'Error de conexión. Intente nuevamente.')}
        />
      )}
      {truncated && (
        <FormError description={`Se muestran las primeras ${LIMIT} órdenes. Acotá con los filtros para ver el resto.`} />
      )}

      {/* Board: one column per open state */}
      {abiertasQ.isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 w-72 flex-shrink-0 rounded-lg bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : abiertas.length === 0 && !abiertasQ.error ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <EmptyState
            icon={ClipboardList}
            title="No hay órdenes abiertas"
            description="Cuando se reporte una falla va a aparecer acá."
          />
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {ESTADOS_ABIERTOS.map((estado) => {
            const items = abiertasPorEstado.get(estado) ?? []
            return (
              <section key={estado} className="w-72 flex-shrink-0 rounded-lg bg-gray-50 border border-gray-200 p-3">
                <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-600">
                  {ESTADO_ORDEN_LABELS[estado]}
                  <span className="rounded-full bg-white border border-gray-200 px-2 py-0.5 text-[11px] font-mono">
                    {items.length}
                  </span>
                </h2>
                <div className="space-y-2">
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-400">Sin órdenes</p>
                  ) : (
                    items.map((o) => <OrdenCard key={o.id} orden={o} />)
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* Collapsed by default: closed and cancelled */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <button
          type="button"
          onClick={() => setShowCerradas((v) => !v)}
          aria-expanded={showCerradas}
          className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-gray-700"
        >
          {showCerradas ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Cerradas y canceladas
        </button>
        {showCerradas && (
          <div className="border-t border-gray-100 p-4">
            {cerradasQ.isLoading ? (
              <div className="h-20 rounded bg-gray-100 animate-pulse" />
            ) : cerradasQ.error ? (
              <FormError
                description={getMaquinariaErrorMessage(cerradasQ.error, 'No se pudieron cargar las órdenes cerradas.')}
              />
            ) : cerradas.length === 0 ? (
              <p className="text-sm text-gray-500">No hay órdenes cerradas ni canceladas.</p>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {ESTADOS_CERRADOS.map((estado) => (
                  <section key={estado}>
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
                      {ESTADO_ORDEN_LABELS[estado]} ({cerradasPorEstado.get(estado)?.length ?? 0})
                    </h2>
                    <div className="space-y-2">
                      {(cerradasPorEstado.get(estado) ?? []).map((o) => (
                        <OrdenCard key={o.id} orden={o} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Drawer open={sheetOpen} onClose={closeSheet} title="Reportar falla">
        {sheetOpen && <ReportarFallaForm onSuccess={closeSheet} onCancel={closeSheet} />}
      </Drawer>
    </div>
  )
}
