import api from '@/lib/api'

export type CultivoCosecha = 'vid' | 'chacra' | 'ind_pasa' | 'alfalfa' | 'otro'
export type DestinoCosecha = 'MI' | 'BODEGA' | 'EXPO' | 'PASAS' | 'RAMA_PASA' | 'SEMILLA' | 'DESC' | 'FARDO'
export type TipoEnvase = 'caja' | 'bin' | 'chasis' | 'ficha' | 'vin' | 'bolsa' | 'otro'

export interface RegistroCosechaResponse {
  id: string
  temporada: number
  semana: number | null
  fecha: string
  parcela_id: string | null
  parcela_nombre: string | null
  cultivo: CultivoCosecha
  variedad: string | null
  n_remito: string | null
  n_ciu: string | null
  destino: DestinoCosecha
  comprador: string | null
  cuadrilla: string | null
  acarreo: string | null
  vehiculo_patente: string | null
  tipo_envase: TipoEnvase
  cantidad_envases: number | null
  peso_unitario_kg: number | null
  bruto_kg: number | null
  tara_kg: number | null
  kg_total: number
  imagen_remito_url: string | null
  observaciones: string | null
  created_at: string
}

export interface RegistroCosechaCreate {
  fecha: string
  parcela_id?: string | null
  cultivo?: CultivoCosecha
  variedad?: string | null
  n_remito?: string | null
  n_ciu?: string | null
  destino: DestinoCosecha
  comprador?: string | null
  cuadrilla?: string | null
  acarreo?: string | null
  vehiculo_patente?: string | null
  tipo_envase?: TipoEnvase
  cantidad_envases?: number | null
  peso_unitario_kg?: number | null
  bruto_kg?: number | null
  tara_kg?: number | null
  kg_total: number
  observaciones?: string | null
}

export interface CosechaResumenPorParcela {
  parcela_id: string | null
  parcela_nombre: string
  variedad: string | null
  kg_total: number
  n_registros: number
}

export interface CosechaResumenPorSemana {
  semana: number
  kg_total: number
  n_registros: number
}

export interface CosechaResumenPorDestino {
  destino: string
  kg_total: number
  n_registros: number
}

export interface CosechaTotalesResponse {
  temporada: number
  kg_total: number
  n_registros: number
  n_parcelas: number
  resumen_por_destino: CosechaResumenPorDestino[]
}

export const DESTINO_LABELS: Record<DestinoCosecha, string> = {
  MI: 'Mercado Interno',
  BODEGA: 'Bodega',
  EXPO: 'Exportación',
  PASAS: 'Pasas',
  RAMA_PASA: 'Rama Pasa',
  SEMILLA: 'Semilla',
  DESC: 'Descarte',
  FARDO: 'Fardo',
}

export const CULTIVO_LABELS: Record<CultivoCosecha, string> = {
  vid: 'Vid',
  chacra: 'Chacra',
  ind_pasa: 'Ind. Pasa',
  alfalfa: 'Alfalfa',
  otro: 'Otro',
}

export const ENVASE_LABELS: Record<TipoEnvase, string> = {
  caja: 'Caja',
  bin: 'Bin',
  chasis: 'Chasis',
  ficha: 'Ficha',
  vin: 'Vin Grande',
  bolsa: 'Bolsa',
  otro: 'Otro',
}

export async function getCosechas(params?: {
  fecha_desde?: string
  fecha_hasta?: string
  temporada?: number
  parcela_id?: string
  destino?: DestinoCosecha
  cultivo?: CultivoCosecha
  skip?: number
  limit?: number
}): Promise<RegistroCosechaResponse[]> {
  const { data } = await api.get<RegistroCosechaResponse[]>('/produccion/cosecha/', { params })
  return data
}

export async function createCosecha(payload: RegistroCosechaCreate): Promise<RegistroCosechaResponse> {
  const { data } = await api.post<RegistroCosechaResponse>('/produccion/cosecha/', payload)
  return data
}

export async function updateCosecha(id: string, payload: Partial<RegistroCosechaCreate>): Promise<RegistroCosechaResponse> {
  const { data } = await api.put<RegistroCosechaResponse>(`/produccion/cosecha/${id}`, payload)
  return data
}

export async function deleteCosecha(id: string): Promise<void> {
  await api.delete(`/produccion/cosecha/${id}`)
}

export async function getCosechaTotales(temporada?: number): Promise<CosechaTotalesResponse> {
  const { data } = await api.get<CosechaTotalesResponse>('/produccion/cosecha/resumen/totales', {
    params: temporada != null ? { temporada } : {},
  })
  return data
}

export async function getCosechaResumenPorParcela(temporada?: number): Promise<CosechaResumenPorParcela[]> {
  const { data } = await api.get<CosechaResumenPorParcela[]>('/produccion/cosecha/resumen/por-parcela', {
    params: temporada != null ? { temporada } : {},
  })
  return data
}

export async function getCosechaResumenPorSemana(temporada?: number): Promise<CosechaResumenPorSemana[]> {
  const { data } = await api.get<CosechaResumenPorSemana[]>('/produccion/cosecha/resumen/por-semana', {
    params: temporada != null ? { temporada } : {},
  })
  return data
}
