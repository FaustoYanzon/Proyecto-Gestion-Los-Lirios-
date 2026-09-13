import api from '@/lib/api'

export type UnidadInsumo = 'kg' | 'lt'
export type TipoInsumo = 'fitosanitario' | 'vario' | 'riego'
export type TipoMovimientoStock = 'ingreso' | 'egreso_aplicacion' | 'ajuste'

export interface InsumoResponse {
  id: string
  nombre: string
  unidad: UnidadInsumo
  tipo: TipoInsumo
  categoria: string | null
  stock_actual: number
  is_active: boolean
  created_at: string
}

export interface InsumoUpdate {
  nombre?: string
  unidad?: UnidadInsumo
  tipo?: TipoInsumo
  categoria?: string
  is_active?: boolean
}

export interface MovimientoStockResponse {
  id: string
  insumo_id: string
  tipo: TipoMovimientoStock
  cantidad: number
  fecha: string
  observacion: string | null
  registro_fitosanitario_id: string | null
  created_by: string
  created_at: string
}

export async function getInsumos(isActive?: boolean, tipo?: TipoInsumo): Promise<InsumoResponse[]> {
  const params: Record<string, boolean | string> = {}
  if (isActive !== undefined) params.is_active = isActive
  if (tipo !== undefined) params.tipo = tipo
  const { data } = await api.get('/insumos/', { params })
  return data
}

export async function createInsumo(data: {
  nombre: string
  unidad: UnidadInsumo
  tipo: TipoInsumo
  categoria?: string
  stock_actual?: number
}): Promise<InsumoResponse> {
  const { data: res } = await api.post('/insumos/', data)
  return res
}

export async function updateInsumo(id: string, data: InsumoUpdate): Promise<InsumoResponse> {
  const { data: res } = await api.put(`/insumos/${id}`, data)
  return res
}

export async function registrarMovimiento(
  insumoId: string,
  data: { tipo: TipoMovimientoStock; cantidad: number; fecha: string; observacion?: string }
): Promise<MovimientoStockResponse> {
  const { data: res } = await api.post(`/insumos/${insumoId}/movimientos`, data)
  return res
}

export async function getMovimientos(insumoId: string): Promise<MovimientoStockResponse[]> {
  const { data } = await api.get(`/insumos/${insumoId}/movimientos`)
  return data
}
