'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCosechaResumenPorParcela } from '@/lib/api/cosecha'
import {
  getFenologiaEstadoActual,
  getCumplimientoRiego, getEstadoCampanaActual,
  getResumenTrabajoPorParcela,
} from '@/lib/api/produccion'
import { getRiegosEnCurso, getRiegos } from '@/lib/api/riego'
import { getFitosanitarios } from '@/lib/api/fitosanitarios'
import { useContextStore, campanaToAnio } from '@/store/contextStore'
import type { FenologiaMapaInfo, EstadoCampanaMapaInfo, RiegoMapaInfo } from './FincaMapInner'

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
const TODAY_ISO = nowMap.toISOString().split('T')[0]

export default function FincaMap({ compact, height }: { compact?: boolean; height?: string }) {
  const campana = useContextStore((s) => s.campana)
  const anio = campanaToAnio(campana)
  const esTemporadaActual = anio === CURRENT_TEMPORADA

  const campanaFechaDesde = `${anio}-05-01`
  const campanaFechaHasta = esTemporadaActual ? TODAY_ISO : `${anio + 1}-04-30`

  const { data: cosechaData = [] } = useQuery({
    queryKey: ['cosecha-mapa', anio],
    queryFn: () => getCosechaResumenPorParcela(anio),
    staleTime: 300_000,
  })

  const cosechaByParcelaId = useMemo((): Record<string, number> => {
    const map: Record<string, number> = {}
    for (const item of cosechaData) {
      if (item.parcela_id) map[item.parcela_id] = item.kg_total
    }
    return map
  }, [cosechaData])

  const { data: costoData = [] } = useQuery({
    queryKey: ['costo-mapa', campanaFechaDesde, campanaFechaHasta],
    queryFn: () => getResumenTrabajoPorParcela({ fecha_desde: campanaFechaDesde, fecha_hasta: campanaFechaHasta }),
    staleTime: 300_000,
  })

  const costoByParcelaId = useMemo((): Record<string, number> => {
    const map: Record<string, number> = {}
    for (const item of costoData) {
      if (item.parcela_id) map[item.parcela_id] = item.monto_total
    }
    return map
  }, [costoData])

  // Tareas cargadas como "General (sin parcela)" no tienen polígono que
  // pintar — se muestran aparte en la leyenda en vez de perderse.
  const costoGeneral = useMemo(
    () => costoData.find((item) => !item.parcela_id)?.monto_total ?? 0,
    [costoData],
  )

  // Riego y fitosanitarios por parcela de la temporada seleccionada — se
  // agregan acá en el cliente (listados chicos, sin endpoint de resumen
  // dedicado todavía) en vez de en el backend, mismo criterio que costo de
  // arriba pero sin vista SQL propia.
  const { data: riegoData = [] } = useQuery({
    queryKey: ['riego-mapa', campanaFechaDesde, campanaFechaHasta],
    queryFn: () => getRiegos({ fecha_desde: campanaFechaDesde, fecha_hasta: campanaFechaHasta, limit: 1000 }),
    staleTime: 300_000,
    retry: false,
  })

  const riegoByParcelaId = useMemo((): Record<string, RiegoMapaInfo> => {
    const map: Record<string, RiegoMapaInfo> = {}
    for (const r of riegoData) {
      const prev = map[r.parcela_id] ?? { litros: 0, mm: 0, nRiegos: 0 }
      prev.litros += r.litros_aplicados ?? 0
      prev.mm += r.mm_aplicados ?? 0
      prev.nRiegos += 1
      map[r.parcela_id] = prev
    }
    return map
  }, [riegoData])

  const { data: fitoData = [] } = useQuery({
    queryKey: ['fito-mapa', campanaFechaDesde, campanaFechaHasta],
    queryFn: () => getFitosanitarios({ fecha_desde: campanaFechaDesde, fecha_hasta: campanaFechaHasta, limit: 1000 }),
    staleTime: 300_000,
    retry: false,
  })

  const fitoByParcelaId = useMemo((): Record<string, number> => {
    const map: Record<string, number> = {}
    for (const f of fitoData) {
      map[f.parcela_id] = (map[f.parcela_id] ?? 0) + 1
    }
    return map
  }, [fitoData])

  // Fenología, ciclo de campaña, cumplimiento de riego y riego en curso son
  // estado del PRESENTE (no hay snapshot histórico guardado por temporada):
  // sólo tienen sentido cuando la temporada elegida es la actual.
  const { data: fenologiaData = [] } = useQuery({
    queryKey: ['fenologia-mapa'],
    queryFn: getFenologiaEstadoActual,
    staleTime: 3_600_000, // cambia una vez por día como mucho
    enabled: esTemporadaActual,
  })

  const fenologiaByVariedad = useMemo((): Record<string, FenologiaMapaInfo> => {
    if (!esTemporadaActual) return {}
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
  }, [fenologiaData, esTemporadaActual])

  // Ciclo de Campaña nuevo (calendario único por variedad, con riegos
  // esperados por estado) — separado a propósito de `fenologiaByVariedad`
  // de arriba (motor de tareas recomendadas, sistema viejo que sigue igual).
  const { data: cumplimientoData = [] } = useQuery({
    queryKey: ['cumplimiento-riego-mapa'],
    queryFn: getCumplimientoRiego,
    staleTime: 300_000,
    enabled: esTemporadaActual,
  })

  const cumplimientoByParcelaId = useMemo((): Record<string, number | null> => {
    if (!esTemporadaActual) return {}
    const map: Record<string, number | null> = {}
    for (const item of cumplimientoData) map[item.parcela_id] = item.cumplimiento_pct
    return map
  }, [cumplimientoData, esTemporadaActual])

  const { data: estadoCampanaData = [] } = useQuery({
    queryKey: ['estado-campana-actual-mapa'],
    queryFn: getEstadoCampanaActual,
    staleTime: 300_000,
    enabled: esTemporadaActual,
  })

  const estadoCampanaByVariedad = useMemo((): Record<string, EstadoCampanaMapaInfo> => {
    if (!esTemporadaActual) return {}
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
  }, [estadoCampanaData, esTemporadaActual])

  // Riegos en curso — para resaltar en el mapa el parral que se está regando
  // ahora mismo. 30s, mismo intervalo que RiegosEnCurso.tsx en otras
  // pantallas. require_encargado_up en el backend: regador/obrero no ven
  // esto (403), pero eso no rompe el mapa — solo no les aparece el resaltado.
  // Sólo tiene sentido con la campaña actual seleccionada.
  const { data: riegosEnCurso = [] } = useQuery({
    queryKey: ['riegos-en-curso-mapa'],
    queryFn: getRiegosEnCurso,
    refetchInterval: 30_000,
    retry: false,
    enabled: esTemporadaActual,
  })

  const parcelasEnRiego = useMemo(
    () => (esTemporadaActual ? new Set(riegosEnCurso.map((r) => r.parcela_id)) : new Set<string>()),
    [riegosEnCurso, esTemporadaActual],
  )

  // Nombres reales de válvula abiertas ahora mismo (ej. "21", "SU1") — solo
  // los riegos cargados después de la migración a válvulas reales tienen
  // este formato; los registros viejos (índice posicional "1","2") no van a
  // matchear ningún cuadrante, así que simplemente no se resaltan a ese
  // nivel (el resaltado por parral de arriba sigue cubriéndolos igual).
  const valvulasEnRiego = useMemo(
    () => (esTemporadaActual ? new Set(riegosEnCurso.flatMap((r) => r.valvula.split(',').map((v) => v.trim()))) : new Set<string>()),
    [riegosEnCurso, esTemporadaActual],
  )

  return (
    <Inner
      compact={compact}
      height={height}
      anio={anio}
      esTemporadaActual={esTemporadaActual}
      cosechaByParcelaId={cosechaByParcelaId}
      fenologiaByVariedad={fenologiaByVariedad}
      cumplimientoByParcelaId={cumplimientoByParcelaId}
      estadoCampanaByVariedad={estadoCampanaByVariedad}
      costoByParcelaId={costoByParcelaId}
      costoGeneral={costoGeneral}
      riegoByParcelaId={riegoByParcelaId}
      fitoByParcelaId={fitoByParcelaId}
      parcelasEnRiego={parcelasEnRiego}
      valvulasEnRiego={valvulasEnRiego}
    />
  )
}
