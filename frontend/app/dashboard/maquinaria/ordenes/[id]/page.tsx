'use client'

import { use } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import {
  FINCA_LABELS,
  getMaquinariaErrorMessage,
  getOrden,
} from '@/lib/api/maquinaria'
import { ESTADOS_ABIERTOS } from '@/lib/maquinariaTransiciones'
import MaquinaIcon from '@/components/maquinaria/MaquinaIcon'
import OrdenDetalleBody from '@/components/maquinaria/OrdenDetalleBody'
import { GravedadBadge, OrdenEstadoBadge, diasAbierta, fmtDate, fmtDateTime, fmtOM } from '@/components/maquinaria/ordenUi'
import EmptyState from '@/components/ui/EmptyState'
import FormError from '@/components/ui/FormError'

export default function OrdenDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data: orden, isLoading, error } = useQuery({
    queryKey: ['maquinaria', 'orden', id],
    queryFn: () => getOrden(id),
    staleTime: 15_000,
  })

  const backLink = (
    <Link
      href="/dashboard/maquinaria/ordenes"
      className="inline-flex items-center gap-1 text-sm text-[#7a1f2c] hover:underline"
    >
      <ArrowLeft size={14} /> Volver a órdenes
    </Link>
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="h-24 rounded-lg bg-gray-100 animate-pulse" />
        <div className="h-64 rounded-lg bg-gray-100 animate-pulse" />
      </div>
    )
  }

  if (error || !orden) {
    const status = (error as { response?: { status?: number } } | null)?.response?.status
    return (
      <div className="space-y-4">
        {backLink}
        {status === 404 ? (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <EmptyState icon={ClipboardList} title="Orden no encontrada" description="Puede haber sido eliminada o no pertenecer a tu finca." />
          </div>
        ) : (
          <FormError
            title="No se pudo cargar la orden"
            description={getMaquinariaErrorMessage(error, 'Error de conexión. Intente nuevamente.')}
          />
        )}
      </div>
    )
  }

  const abierta = ESTADOS_ABIERTOS.includes(orden.estado)
  const dias = diasAbierta(orden.created_at, orden.updated_at, abierta)

  return (
    <div className="space-y-5">
      {backLink}

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
            <span className="font-mono text-lg text-[#7a1f2c]">{fmtOM(orden.numero)}</span>
            <MaquinaIcon icono={orden.maquina.icono} size={22} className="text-gray-500" />
            {orden.maquina.marca} {orden.maquina.modelo}
          </h1>
          <OrdenEstadoBadge estado={orden.estado} />
          <GravedadBadge gravedad={orden.gravedad} />
        </div>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{orden.descripcion}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          {orden.maquina.patente_serie && <span>Patente/serie: {orden.maquina.patente_serie}</span>}
          <span>{FINCA_LABELS[orden.finca]}</span>
          <span>Taller: {orden.taller || 'sin definir'}</span>
          {orden.fecha_estimada_entrega && <span>Entrega estimada: {fmtDate(orden.fecha_estimada_entrega)}</span>}
          <span>Reportada: {fmtDateTime(orden.created_at)}</span>
          <span>{dias === 1 ? '1 día' : `${dias} días`}{abierta ? ' abierta' : ' hasta el cierre'}</span>
        </div>
      </div>

      <OrdenDetalleBody orden={orden} />
    </div>
  )
}
