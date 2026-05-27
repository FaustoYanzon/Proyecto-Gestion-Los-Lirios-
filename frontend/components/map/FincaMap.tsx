'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCosechaResumenPorParcela } from '@/lib/api/cosecha'

const Inner = dynamic(() => import('./FincaMapInner'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center bg-gray-100 w-full h-full min-h-40">
      <p className="text-sm text-gray-400">Cargando mapa...</p>
    </div>
  ),
})

const nowMap = new Date()
const CURRENT_TEMPORADA = nowMap.getMonth() >= 4 ? nowMap.getFullYear() : nowMap.getFullYear() - 1

export default function FincaMap({ compact, height }: { compact?: boolean; height?: string }) {
  const { data: cosechaData = [] } = useQuery({
    queryKey: ['cosecha-mapa', CURRENT_TEMPORADA],
    queryFn: () => getCosechaResumenPorParcela(CURRENT_TEMPORADA),
    staleTime: 300_000,
  })

  const cosechaByParcelaId = useMemo((): Record<string, number> => {
    const map: Record<string, number> = {}
    for (const item of cosechaData) {
      if (item.parcela_id) map[item.parcela_id] = item.kg_total
    }
    return map
  }, [cosechaData])

  return <Inner compact={compact} height={height} cosechaByParcelaId={cosechaByParcelaId} />
}
