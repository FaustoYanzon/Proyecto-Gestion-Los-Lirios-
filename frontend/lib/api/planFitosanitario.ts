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
  numero_aplicacion?: number
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

export interface NecesidadInsumoItem {
  insumo_id: string
  insumo_nombre: string
  unidad: 'kg' | 'lt'
  cantidad_pendiente: number
  stock_actual: number
  faltante: number
}

export async function getNecesidadStock(temporada: number): Promise<NecesidadInsumoItem[]> {
  const { data } = await api.get('/plan-fitosanitario/necesidad-stock', { params: { temporada } })
  // stock_actual is a Decimal: it arrives as a string.
  return (data as NecesidadInsumoItem[]).map((item) => ({
    ...item,
    stock_actual: Number(item.stock_actual),
  }))
}

// ── Monthly progress against the plan ───────────────────────────────────────
// Decimals arrive as strings: always go through Number() before computing.

export type EstadoAvance = 'pendiente' | 'bajo' | 'ok' | 'exceso' | 'no_planificado'

export interface AvanceParcela {
  id: string
  nombre: string
  ha: string
  dosis_aplicada: string
  porcentaje: string | null
  estado: EstadoAvance
}

export interface AvanceItem {
  variedad: string
  mes: number
  insumo_id: string
  insumo_nombre: string
  unidad: string | null
  // null = applied but not in the plan for that variety and month.
  dosis_plan: string | null
  dosis_aplicada_promedio: string
  porcentaje: string | null
  estado: EstadoAvance
  ha_total: string
  parcelas: AvanceParcela[]
}

export async function getAvance(temporada: number, mes?: number, variedad?: string): Promise<AvanceItem[]> {
  const { data } = await api.get('/plan-fitosanitario/avance', {
    params: { temporada, ...(mes ? { mes } : {}), ...(variedad ? { variedad } : {}) },
  })
  return data
}

export type EstadoContraste = 'en_plan' | 'excede' | 'fuera_del_plan'

export interface ContrasteVariedad {
  variedad: string
  estado: EstadoContraste
  dosis_plan: string | null
  dosis_aplicada_promedio: string
  dosis_proyectada_promedio: string
  porcentaje_proyectado: string | null
}

export interface ContrasteLineaResultado {
  insumo_id: string
  variedades: ContrasteVariedad[]
}

export interface ContrasteBody {
  fecha: string
  parcelas: { parcela_id: string; valvula_ids?: string[] }[]
  lineas: { insumo_id: string; dosis_por_ha: number }[]
}

export async function postContraste(body: ContrasteBody): Promise<ContrasteLineaResultado[]> {
  const { data } = await api.post('/plan-fitosanitario/contraste', body)
  return data
}
