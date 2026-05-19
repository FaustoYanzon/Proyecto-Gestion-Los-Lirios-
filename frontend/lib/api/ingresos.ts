import api from '@/lib/api'

export const PRODUCTO_INGRESO_VALUES = ['uva_fresca', 'pasa', 'mosto', 'otro'] as const
export type ProductoIngreso = (typeof PRODUCTO_INGRESO_VALUES)[number]

export const VARIEDAD_VALUES = [
  'flame', 'red_globe', 'fiesta', 'bonarda',
  'sultanina', 'syrah', 'aspirant', 'alfalfa', 'otro',
] as const
export type VariedadUva = (typeof VARIEDAD_VALUES)[number]

export const PRODUCTO_INGRESO_LABELS: Record<ProductoIngreso, string> = {
  uva_fresca: 'Uva Fresca',
  pasa: 'Pasa',
  mosto: 'Mosto',
  otro: 'Otro',
}

export const VARIEDAD_LABELS: Record<VariedadUva, string> = {
  flame: 'Flame',
  red_globe: 'Red Globe',
  fiesta: 'Fiesta',
  bonarda: 'Bonarda',
  sultanina: 'Sultanina',
  syrah: 'Syrah',
  aspirant: 'Aspirant',
  alfalfa: 'Alfalfa',
  otro: 'Otro',
}

export interface IngresoCreate {
  fecha: string
  cliente: string
  producto: ProductoIngreso
  variedad?: VariedadUva
  kg_totales?: number
  precio_por_kg?: number
  monto: number
  moneda: 'ars' | 'usd'
  tipo_cambio?: number
  origen: 'oficial' | 'no_oficial'
  finca: 'los_mimbres' | 'media_agua' | 'caucete'
  forma_pago: 'efectivo' | 'transferencia' | 'cheque' | 'credito'
  descripcion?: string
}

export interface IngresoResponse extends IngresoCreate {
  id: string
  created_by: string
  created_at: string
}

export interface IngresosFilter {
  fecha_desde?: string
  fecha_hasta?: string
  cliente?: string
  producto?: string
  origen?: string
  finca?: string
  moneda?: string
  skip?: number
  limit?: number
}

export async function getIngresos(params: IngresosFilter): Promise<IngresoResponse[]> {
  const { data } = await api.get('/finanzas/ingresos/', { params })
  return data
}

export async function createIngreso(data: IngresoCreate): Promise<IngresoResponse> {
  const { data: res } = await api.post('/finanzas/ingresos/', data)
  return res
}

export async function updateIngreso(id: string, data: Partial<IngresoCreate>): Promise<IngresoResponse> {
  const { data: res } = await api.put(`/finanzas/ingresos/${id}`, data)
  return res
}

export async function deleteIngreso(id: string): Promise<void> {
  await api.delete(`/finanzas/ingresos/${id}`)
}
