'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCosechaResumenPorParcela } from '@/lib/api/cosecha'
import {
  getFenologiaEstadoActual,
  getCumplimientoRiego, getEstadoCampanaActual,
} from '@/lib/api/produccion'
import { getRiegosEnCurso } from '@/lib/api/riego'
import type { FenologiaMapaInfo, EstadoCampanaMapaInfo } from './FincaMapInner'

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

  // Ciclo de Campaña nuevo (calendario único por variedad, con riegos
  // esperados por estado) — separado a propósito de `fenologiaByVariedad`
  // de arriba (motor de tareas recomendadas, sistema viejo que sigue igual).
  const { data: cumplimientoData = [] } = useQuery({
    queryKey: ['cumplimiento-riego-mapa'],
    queryFn: getCumplimientoRiego,
    staleTime: 300_000,
  })

  const cumplimientoByParcelaId = useMemo((): Record<string, number | null> => {
    const map: Record<string, number | null> = {}
    for (const item of cumplimientoData) map[item.parcela_id] = item.cumplimiento_pct
    return map
  }, [cumplimientoData])

  const { data: estadoCampanaData = [] } = useQuery({
    queryKey: ['estado-campana-actual-mapa'],
    queryFn: getEstadoCampanaActual,
    staleTime: 300_000,
  })

  const estadoCampanaByVariedad = useMemo((): Record<string, EstadoCampanaMapaInfo> => {
    const map: Record<string, EstadoCampanaMapaInfo> = {}
    for (const item of estadoCampanaData) {
      map[item.variedad] = {
        estado_campana: item.estado_campana,
        estado_campana_label: item.estado_campana_label,
        fuente: item.fuente,
        fecha_confirmacion: item.fecha_confirmacion,
        riegos_esperados: item.riegos_esperados,
      }
    }
    return map
  }, [estadoCampanaData])

  // Riegos en curso — para resaltar en el mapa el parral que se está regando
  // ahora mismo. 30s, mismo intervalo que RiegosEnCurso.tsx en otras
  // pantallas. require_encargado_up en el backend: regador/obrero no ven
  // esto (403), pero eso no rompe el mapa — solo no les aparece el resaltado.
  const { data: riegosEnCurso = [] } = useQuery({
    queryKey: ['riegos-en-curso-mapa'],
    queryFn: getRiegosEnCurso,
    refetchInterval: 30_000,
    retry: false,
  })

  const parcelasEnRiego = useMemo(
    () => new Set(riegosEnCurso.map((r) => r.parcela_id)),
    [riegosEnCurso],
  )

  return (
    <Inner
      compact={compact}
      height={height}
      cosechaByParcelaId={cosechaByParcelaId}
      fenologiaByVariedad={fenologiaByVariedad}
      cumplimientoByParcelaId={cumplimientoByParcelaId}
      estadoCampanaByVariedad={estadoCampanaByVariedad}
      parcelasEnRiego={parcelasEnRiego}
    />
  )
}
