import api from '@/lib/api'

// Types mirror backend schemas/kpis.py (rows come from vw_kpi_* SQL views)

export interface PresupuestoVsRealItem {
  temporada: number
  mes: number
  concepto: 'ingreso' | 'egreso'
  tipo: string | null
  moneda: 'ars' | 'usd'
  monto_presupuesto: number
  monto_real: number
  desvio: number
  desvio_pct: number | null
}

export interface ProduccionParcelaKpi {
  temporada: number
  parcela_id: string
  parcela_nombre: string
  variedad: string | null
  superficie_ha: number | null
  kg_total: number
  kg_ha: number | null
  kg_plan: number | null
  desvio_plan_pct: number | null
  litros_riego_estimados: number | null
  litros_por_kg: number | null
}

export interface ProduccionVariedadKpi {
  temporada: number
  variedad: string | null
  kg_total: number
  superficie_ha: number | null
  kg_ha: number | null
}

export interface CompradorKpi {
  temporada: number
  comprador: string
  kg_entregados: number
  monto_cobrado_ars: number
  monto_cobrado_usd: number
}

export interface ManoObraMensualKpi {
  temporada: number
  mes: number
  clasificacion: string
  jornales: number | null
  monto: number
}

export interface ManoObraParcelaKpi {
  temporada: number
  parcela_id: string
  parcela_nombre: string
  superficie_ha: number | null
  jornales: number | null
  monto: number
  monto_por_ha: number | null
}

export interface ManoObraParcelaMesKpi {
  temporada: number
  mes: number
  parcela_id: string
  parcela_nombre: string
  jornales: number | null
  monto: number
}

export async function getPresupuestoVsReal(params: {
  temporada: number
  mes?: number
  concepto?: 'ingreso' | 'egreso'
  moneda?: 'ars' | 'usd'
}): Promise<PresupuestoVsRealItem[]> {
  const { data } = await api.get('/kpis/presupuesto-vs-real', { params })
  return data
}

export async function getKpiProduccionParcelas(temporada?: number): Promise<ProduccionParcelaKpi[]> {
  const { data } = await api.get('/kpis/produccion/parcelas', {
    params: temporada != null ? { temporada } : {},
  })
  return data
}

export async function getKpiProduccionVariedades(temporada?: number): Promise<ProduccionVariedadKpi[]> {
  const { data } = await api.get('/kpis/produccion/variedades', {
    params: temporada != null ? { temporada } : {},
  })
  return data
}

export async function getKpiCompradores(temporada: number): Promise<CompradorKpi[]> {
  const { data } = await api.get('/kpis/compradores', { params: { temporada } })
  return data
}

export async function getKpiManoObraMensual(temporada: number): Promise<ManoObraMensualKpi[]> {
  const { data } = await api.get('/kpis/mano-obra/mensual', { params: { temporada } })
  return data
}

export async function getKpiManoObraParcelas(temporada?: number): Promise<ManoObraParcelaKpi[]> {
  const { data } = await api.get('/kpis/mano-obra/parcelas', {
    params: temporada != null ? { temporada } : {},
  })
  return data
}

export async function getKpiManoObraParcelasMes(temporada: number): Promise<ManoObraParcelaMesKpi[]> {
  const { data } = await api.get('/kpis/mano-obra/parcelas-mes', { params: { temporada } })
  return data
}
