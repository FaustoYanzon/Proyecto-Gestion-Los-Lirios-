'use client'

import { use } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import {
  getMaquina,
  getMaquinariaErrorMessage,
  TIPO_MAQUINA_LABELS,
  FINCA_LABELS,
} from '@/lib/api/maquinaria'
import EstadoMaquinaBadge from '@/components/maquinaria/EstadoMaquinaBadge'
import FormError from '@/components/ui/FormError'

// Placeholder ficha: header only. Historial, costos and órdenes come in later steps.
export default function MaquinaFichaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data: maquina, isLoading, error } = useQuery({
    queryKey: ['maquinaria', 'maquina', id],
    queryFn: () => getMaquina(id),
  })

  return (
    <div className="space-y-5">
      <Link
        href="/dashboard/maquinaria"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft size={14} /> Maquinaria
      </Link>

      {isLoading ? (
        <div className="h-16 bg-gray-100 rounded-lg animate-pulse" />
      ) : error || !maquina ? (
        <FormError
          title="No se pudo cargar la máquina"
          description={getMaquinariaErrorMessage(error, 'La máquina no existe o no tenés acceso.')}
        />
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {maquina.marca} {maquina.modelo}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {TIPO_MAQUINA_LABELS[maquina.tipo]} · {FINCA_LABELS[maquina.finca]}
              {maquina.anio ? ` · ${maquina.anio}` : ''}
              {maquina.patente_serie ? ` · ${maquina.patente_serie}` : ''}
            </p>
          </div>
          <EstadoMaquinaBadge estado={maquina.estado} semaforo={maquina.semaforo} />
        </div>
      )}
    </div>
  )
}
