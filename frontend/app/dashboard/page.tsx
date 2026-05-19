'use client'

import { useAuthStore } from '@/store/authStore'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { MapPin, ClipboardList, Droplets, Sprout } from 'lucide-react'
import Link from 'next/link'
import FincaMap from '@/components/map/FincaMap'

interface ParcelaItem { id: string; is_active: boolean }
interface TrabajoItem { id: string }
interface RiegoItem { id: string; fecha: string }
interface EstadoActualItem { id: string }

function StatCard({
  label,
  icon: Icon,
  color,
  bg,
  value,
  isLoading,
}: {
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  color: string
  bg: string
  value: string | number
  isLoading: boolean
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-600">{label}</span>
        <span className={`p-2 rounded-lg ${bg}`}>
          <Icon size={18} className={color} />
        </span>
      </div>
      {isLoading ? (
        <div className="animate-pulse bg-gray-200 h-8 w-16 rounded" />
      ) : (
        <p className="text-2xl font-semibold text-gray-900">{value}</p>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user)

  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const toISO = (d: Date) => d.toISOString().split('T')[0]

  const { data: parcelas, isLoading: loadingParcelas } = useQuery({
    queryKey: ['dashboard-parcelas'],
    queryFn: async () => {
      const { data } = await api.get<ParcelaItem[]>('/parcelas/')
      return data
    },
  })

  const { data: trabajos, isLoading: loadingTrabajos } = useQuery({
    queryKey: ['dashboard-trabajos', toISO(firstOfMonth)],
    queryFn: async () => {
      const { data } = await api.get<TrabajoItem[]>('/produccion/trabajo/', {
        params: { fecha_desde: toISO(firstOfMonth), fecha_hasta: toISO(today), limit: 1000 },
      })
      return data
    },
  })

  const { data: riegos, isLoading: loadingRiegos } = useQuery({
    queryKey: ['dashboard-riego'],
    queryFn: async () => {
      const { data } = await api.get<RiegoItem[]>('/produccion/riego/', {
        params: { limit: 1 },
      })
      return data
    },
  })

  const { data: estadoCampana, isLoading: loadingCampana } = useQuery({
    queryKey: ['dashboard-campana'],
    queryFn: async () => {
      const { data } = await api.get<EstadoActualItem[]>('/produccion/campana/estado-actual/')
      return data
    },
  })

  const ultimoRiego = (() => {
    if (!riegos || riegos.length === 0) return '—'
    const fecha = (riegos[0] as RiegoItem & { fecha: string }).fecha
    return new Date(fecha + 'T00:00:00').toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'short',
    })
  })()

  const todayLabel = today.toLocaleDateString('es-AR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          Bienvenido{user ? `, ${user.full_name}` : ''}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5 capitalize">{todayLabel}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Parcelas activas"
          icon={MapPin}
          color="text-green-600"
          bg="bg-green-50"
          value={parcelas?.length ?? '—'}
          isLoading={loadingParcelas}
        />
        <StatCard
          label="Jornales este mes"
          icon={ClipboardList}
          color="text-blue-600"
          bg="bg-blue-50"
          value={trabajos?.length ?? '—'}
          isLoading={loadingTrabajos}
        />
        <StatCard
          label="Último riego"
          icon={Droplets}
          color="text-amber-600"
          bg="bg-amber-50"
          value={ultimoRiego}
          isLoading={loadingRiegos}
        />
        <StatCard
          label="Estado campaña"
          icon={Sprout}
          color="text-purple-600"
          bg="bg-purple-50"
          value={estadoCampana ? (estadoCampana.length > 0 ? `${estadoCampana.length} parrales` : '—') : '—'}
          isLoading={loadingCampana}
        />
      </div>

      <div className="mt-6 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100">
          <div className="flex items-center gap-2">
            <MapPin size={15} className="text-green-600" />
            <span className="text-sm font-semibold text-gray-700">Mapa de finca</span>
          </div>
          <Link href="/dashboard/mapa" className="text-xs text-green-600 hover:text-green-800 font-medium transition-colors">
            Ver completo →
          </Link>
        </div>
        <FincaMap compact height="280px" />
      </div>
    </div>
  )
}
