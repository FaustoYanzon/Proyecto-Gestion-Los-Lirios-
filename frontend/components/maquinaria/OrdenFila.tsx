'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import {
  FINCA_LABELS,
  getMaquinariaErrorMessage,
  getOrden,
  type OrdenResponse,
} from '@/lib/api/maquinaria'
import { ESTADOS_ABIERTOS } from '@/lib/maquinariaTransiciones'
import FormError from '@/components/ui/FormError'
import MaquinaIcon from './MaquinaIcon'
import OrdenDetalleBody from './OrdenDetalleBody'
import OrdenProgreso from './OrdenProgreso'
import { GravedadBadge, OrdenEstadoBadge, diasAbierta, fmtDate, fmtDateTime, fmtOM } from './ordenUi'

// Collapsible order row (same interaction as the fito orders list). The full
// order is only fetched once the row is expanded.
export default function OrdenFila({ orden }: { orden: OrdenResponse }) {
  const [abierta, setAbierta] = useState(false)
  const esAbierta = ESTADOS_ABIERTOS.includes(orden.estado)
  const dias = diasAbierta(orden.created_at, orden.updated_at, esAbierta)

  // Same key as the detail page, so both share the cache and the global invalidation.
  const { data: detalle, isLoading, error } = useQuery({
    queryKey: ['maquinaria', 'orden', orden.id],
    queryFn: () => getOrden(orden.id),
    enabled: abierta,
    staleTime: 15_000,
  })

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        {abierta ? (
          <ChevronDown size={16} className="text-gray-400 shrink-0" />
        ) : (
          <ChevronRight size={16} className="text-gray-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-[#7a1f2c]">{fmtOM(orden.numero)}</span>
            <span className="inline-flex items-center gap-1.5 font-medium text-gray-900">
              <MaquinaIcon icono={orden.maquina.icono} size={16} className="text-gray-500 shrink-0" />
              {orden.maquina.marca} {orden.maquina.modelo}
            </span>
            <GravedadBadge gravedad={orden.gravedad} />
            <OrdenEstadoBadge estado={orden.estado} />
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-gray-600">{orden.descripcion}</p>
          <p className="mt-1 text-xs text-gray-500">
            {FINCA_LABELS[orden.finca]} · {dias === 1 ? '1 día' : `${dias} días`}
            {esAbierta ? ' abierta' : ''}
          </p>
        </div>
        <div className="shrink-0 hidden sm:block">
          <OrdenProgreso estado={orden.estado} />
        </div>
      </button>

      {/* Stepper below the text on narrow screens */}
      <div className="px-4 pb-3 sm:hidden">
        <OrdenProgreso estado={orden.estado} />
      </div>

      {abierta && (
        <div className="px-4 py-4 border-t border-gray-100 bg-gray-50/50 space-y-4">
          {isLoading ? (
            <div className="h-40 rounded-lg bg-gray-100 animate-pulse" />
          ) : error || !detalle ? (
            <FormError
              title="No se pudo cargar la orden"
              description={getMaquinariaErrorMessage(error, 'Error de conexión. Intente nuevamente.')}
            />
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{detalle.descripcion}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  {detalle.maquina.patente_serie && <span>Patente/serie: {detalle.maquina.patente_serie}</span>}
                  <span>Taller: {detalle.taller || 'sin definir'}</span>
                  {detalle.fecha_estimada_entrega && (
                    <span>Entrega estimada: {fmtDate(detalle.fecha_estimada_entrega)}</span>
                  )}
                  <span>Reportada: {fmtDateTime(detalle.created_at)}</span>
                  <Link
                    href={`/dashboard/maquinaria/ordenes/${detalle.id}`}
                    className="inline-flex items-center gap-1 text-[#7a1f2c] hover:underline"
                  >
                    Abrir en página <ExternalLink size={11} />
                  </Link>
                </div>
              </div>
              <OrdenDetalleBody orden={detalle} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
