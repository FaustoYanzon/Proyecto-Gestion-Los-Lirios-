import api from '@/lib/api'

export interface PlanFitosanitario {
  id: string
  temporada: number
  variedad: string
  numero_aplicacion: number
  mes: number
  insumo_id: string
  insumo_nombre: string
  insumo_unidad: 'kg' | 'lt'
  objetivo: string
  dosis_por_ha: number
  notas: string | null
  created_by: string
  created_at: string
}

export interface PlanFitosanitarioCreate {
  temporada: number
  variedades: string[]
  numero_aplicacion: number
  mes: number
  insumo_id: string
  objetivo: string
  dosis_por_ha: number
  notas?: string | null
}

export interface PlanFitosanitarioUpdate {
  variedad?: string
  numero_aplicacion?: number
  mes?: number
  insumo_id?: string
  objetivo?: string
  dosis_por_ha?: number
  notas?: string | null
}

export async function getPlanFitosanitario(temporada: number, variedad?: string): Promise<PlanFitosanitario[]> {
  const { data } = await api.get('/plan-fitosanitario/', {
    params: variedad ? { temporada, variedad } : { temporada },
  })
  return data
}

export async function createPlanFitosanitario(payload: PlanFitosanitarioCreate): Promise<PlanFitosanitario[]> {
  const { data } = await api.post('/plan-fitosanitario/', payload)
  return data
}

export async function updatePlanFitosanitario(id: string, payload: PlanFitosanitarioUpdate): Promise<PlanFitosanitario> {
  const { data } = await api.put(`/plan-fitosanitario/${id}`, payload)
  return data
}

export async function deletePlanFitosanitario(id: string): Promise<void> {
  await api.delete(`/plan-fitosanitario/${id}`)
}

export interface CumplimientoPlanItem {
  plan_id: string
  variedad: string
  numero_aplicacion: number
  mes: number
  insumo_nombre: string
  objetivo: string
  dosis_por_ha: number
  parcelas_total: number
  parcelas_aplicadas: number
  porcentaje: number
  estado: 'pendiente' | 'parcial' | 'completo'
  ha_total: number
  ha_cubiertas: number
  pendiente_ha: number
  pendiente_cantidad: number
  // Hectare-weighted actual dose; null = nothing applied yet.
  dosis_real_promedio: number | null
}

export interface NecesidadInsumoItem {
  insumo_id: string
  insumo_nombre: string
  unidad: 'kg' | 'lt'
  cantidad_pendiente: number
  stock_actual: number
  faltante: number
}

export async function getCumplimiento(temporada: number, variedad?: string): Promise<CumplimientoPlanItem[]> {
  const { data } = await api.get('/plan-fitosanitario/cumplimiento', {
    params: variedad ? { temporada, variedad } : { temporada },
  })
  return data
}

export async function getNecesidadStock(temporada: number): Promise<NecesidadInsumoItem[]> {
  const { data } = await api.get('/plan-fitosanitario/necesidad-stock', { params: { temporada } })
  // stock_actual is a Decimal: it arrives as a string.
  return (data as NecesidadInsumoItem[]).map((item) => ({
    ...item,
    stock_actual: Number(item.stock_actual),
  }))
}

export interface RondaPendienteLinea {
  insumo_id: string
  insumo_nombre: string
  unidad: 'kg' | 'lt'
  dosis_por_ha: number
}

export interface RondaPendienteParcela {
  id: string
  nombre: string
  // Area still missing at least one of the card's lines.
  ha_pendientes: number
  // Some line is already (partly) applied here: leave it unticked by default.
  parcial: boolean
}

export interface RondaPendienteVariedad {
  variedad: string
  ha_pendientes: number
  parcelas: RondaPendienteParcela[]
}

// A pending plan round across varieties sharing the same products/doses.
export interface RondaPendiente {
  numero_aplicacion: number
  objetivo: string
  mes: number
  lineas: RondaPendienteLinea[]
  variedades: RondaPendienteVariedad[]
}

export async function getRondasPendientes(temporada: number): Promise<RondaPendiente[]> {
  const { data } = await api.get('/plan-fitosanitario/rondas-pendientes', { params: { temporada } })
  return data
}
