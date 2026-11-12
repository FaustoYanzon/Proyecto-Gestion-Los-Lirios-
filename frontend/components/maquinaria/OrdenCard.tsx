import Link from 'next/link'
import { FINCA_LABELS, type OrdenResponse } from '@/lib/api/maquinaria'
import { ESTADOS_ABIERTOS } from '@/lib/maquinariaTransiciones'
import { GravedadBadge, diasAbierta } from './ordenUi'

export default function OrdenCard({ orden }: { orden: OrdenResponse }) {
  const abierta = ESTADOS_ABIERTOS.includes(orden.estado)
  const dias = diasAbierta(orden.created_at, orden.updated_at, abierta)

  return (
    <Link
      href={`/dashboard/maquinaria/ordenes/${orden.id}`}
      className="block rounded-md border border-gray-200 bg-white p-3 shadow-sm hover:border-[#7a1f2c] hover:shadow transition"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900">
          {orden.maquina.marca} {orden.maquina.modelo}
        </p>
        <GravedadBadge gravedad={orden.gravedad} />
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-gray-600">{orden.descripcion}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
        <span>{FINCA_LABELS[orden.finca]}</span>
        <span>{orden.taller ? `Taller: ${orden.taller}` : 'Sin taller'}</span>
        <span>{dias === 1 ? '1 día' : `${dias} días`}{abierta ? ' abierta' : ''}</span>
      </div>
    </Link>
  )
}
