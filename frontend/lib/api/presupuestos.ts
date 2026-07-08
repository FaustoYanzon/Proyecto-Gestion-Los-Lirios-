import api from '@/lib/api'
import type { TipoEgreso } from '@/lib/api/egresos'

export type ConceptoPresupuesto = 'ingreso' | 'egreso'
export type MonedaPresupuesto = 'ars' | 'usd'

export interface Presupuesto {
  id: string
  temporada: number
  mes: number
  concepto: ConceptoPresupuesto
  tipo: TipoEgreso | null
  clasificacion: string | null
  cliente: string | null
  monto: number
  moneda: MonedaPresupuesto
  notas: string | null
  created_by: string
  created_at: string
}

export interface PresupuestoCreate {
  temporada: number
  mes: number
  concepto: ConceptoPresupuesto
  tipo?: TipoEgreso | null
  clasificacion?: string | null
  cliente?: string | null
  monto: number
  moneda: MonedaPresupuesto
  notas?: string | null
}

export async function getPresupuestos(params: {
  temporada: number
  mes?: number
  concepto?: ConceptoPresupuesto
  moneda?: MonedaPresupuesto
}): Promise<Presupuesto[]> {
  const { data } = await api.get('/presupuestos/', { params: { ...params, limit: 2000 } })
  return data
}

export async function createPresupuestosBulk(items: PresupuestoCreate[]): Promise<Presupuesto[]> {
  const { data } = await api.post('/presupuestos/bulk', { items })
  return data
}

export async function updatePresupuesto(
  id: string,
  payload: { mes?: number; monto?: number; cliente?: string | null; notas?: string | null },
): Promise<Presupuesto> {
  const { data } = await api.put(`/presupuestos/${id}`, payload)
  return data
}

export async function deletePresupuesto(id: string): Promise<void> {
  await api.delete(`/presupuestos/${id}`)
}
