import api from '@/lib/api'

export const DESTINO_INGRESO_VALUES = [
  'uva_mesa', 'bodega', 'pasa', 'alfalfa', 'cebolla', 'sandia', 'alquiler', 'otro',
] as const
export type DestinoIngreso = (typeof DESTINO_INGRESO_VALUES)[number]

export const DESTINO_INGRESO_LABELS: Record<DestinoIngreso, string> = {
  uva_mesa: 'Uva de Mesa',
  bodega: 'Bodega',
  pasa: 'Pasa',
  alfalfa: 'Alfalfa',
  cebolla: 'Cebolla',
  sandia: 'Sandía',
  alquiler: 'Alquiler',
  otro: 'Otro',
}

export const ESTADO_INGRESO_VALUES = ['no_registrado', 'facturado'] as const
export type EstadoIngreso = (typeof ESTADO_INGRESO_VALUES)[number]

export const ESTADO_INGRESO_LABELS: Record<EstadoIngreso, string> = {
  no_registrado: 'No Registrado',
  facturado: 'Facturado',
}

export const FORMA_PAGO_INGRESO_VALUES = [
  'efectivo', 'transferencia', 'cheque', 'echeque', 'credito',
] as const
export type FormaPagoIngreso = (typeof FORMA_PAGO_INGRESO_VALUES)[number]

export const FORMA_PAGO_INGRESO_LABELS: Record<FormaPagoIngreso, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  echeque: 'E-Cheque',
  credito: 'Crédito',
}

// forma_pago values that carry cheque-specific fields (banco, n_cheque, f_pago, uso_cheque).
export const FORMAS_PAGO_CHEQUE: readonly FormaPagoIngreso[] = ['cheque', 'echeque']

export interface IngresoCreate {
  fecha: string
  destino: DestinoIngreso
  comprador: string
  forma_pago: FormaPagoIngreso
  estado?: EstadoIngreso
  cuenta_destino?: string
  banco?: string
  n_cheque?: string
  f_pago?: string
  uso_cheque?: string
  monto: number
  moneda: 'ars' | 'usd'
  tipo_cambio?: number
  origen: 'oficial' | 'no_oficial'
  finca: 'los_mimbres' | 'media_agua' | 'caucete'
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
  comprador?: string
  destino?: string
  forma_pago?: string
  origen?: string
  finca?: string
  moneda?: string
  solo_cheques_disponibles?: boolean
  skip?: number
  limit?: number
}

export async function getIngresos(params: IngresosFilter): Promise<IngresoResponse[]> {
  const { data } = await api.get('/finanzas/ingresos/', { params })
  return data
}

export async function getCuentasDestino(): Promise<string[]> {
  const { data } = await api.get('/finanzas/ingresos/cuentas-destino')
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
