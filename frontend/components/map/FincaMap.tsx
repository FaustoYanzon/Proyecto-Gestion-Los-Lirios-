'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCosechaResumenPorParcela } from '@/lib/api/cosecha'
import { getEficienciaHidrica, getFenologiaEstadoActual } from '@/lib/api/produccion'
import type { RiegoMapaInfo, FenologiaMapaInfo } from './FincaMapInner'

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

  const { data: eficienciaData = [] } = useQuery({
    queryKey: ['eficiencia-hidrica-mapa', CURRENT_TEMPORADA],
    queryFn: () => getEficienciaHidrica(CURRENT_TEMPORADA),
    staleTime: 300_000,
  })

  const riegoByParcelaId = useMemo((): Record<string, RiegoMapaInfo> => {
    const map: Record<string, RiegoMapaInfo> = {}
    for (const item of eficienciaData) {
      map[item.parcela_id] = {
        litros_totales: item.litros_totales,
        porcentaje_cumplimiento: item.porcentaje_cumplimiento,
      }
    }
    return map
  }, [eficienciaData])

  const { data: fenologiaData = [] } = useQuery({
    queryKey: ['fenologia-mapa'],
    queryFn: getFenologiaEstadoActual,
    staleTime: 3_600_000, // cambia una vez por día como mucho
  })

  const fenologiaByVariedad = useMemo((): Record<string, FenologiaMapaInfo> => {
    const map: Record<string, FenologiaMapaInfo> = {}
    for (const item of fenologiaData) {
      map[item.variedad] = {
        estado_fenologico: item.estado_fenologico,
        fase_label: item.fase_label,
        tareas_recomendadas: item.tareas_recomendadas,
        proxima_fase_label: item.proxima_fase_label,
        proxima_fase_fecha: item.proxima_fase_fecha,
      }
    }
    return map
  }, [fenologiaData])

  return (
    <Inner
      compact={compact}
      height={height}
      cosechaByParcelaId={cosechaByParcelaId}
      riegoByParcelaId={riegoByParcelaId}
      fenologiaByVariedad={fenologiaByVariedad}
    />
  )
}
