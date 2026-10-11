import api from '@/lib/api'
import type { VariedadUva } from '@/lib/api/parcelas'
import {
  parseRemito, parseIngreso,
  type Remito, type IngresoPasero,
} from '@/lib/api/altaProduccion'

export type CultivoCosecha = 'vid' | 'chacra' | 'ind_pasa' | 'alfalfa' | 'otro'
export type DestinoCosecha = 'MI' | 'BODEGA' | 'EXPO' | 'PASAS' | 'RAMA_PASA' | 'SEMILLA' | 'DESC' | 'FARDO'
export type TipoEnvase = 'caja' | 'bin' | 'chasis' | 'ficha' | 'vin' | 'bolsa' | 'otro'
export type OrigenCosecha = 'propio' | 'tercero'

export interface RegistroCosechaResponse {
  id: string
  temporada: number
  semana: number | null
  fecha: string
  parcela_id: string | null
  parcela_nombre: string | null
  cultivo: CultivoCosecha
  variedad: string | null
  origen: OrigenCosecha
  proveedor_tercero: string | null
  productor_id: string | null
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
  /** Kg sin despachar (remitos); null si no aplica. Llega como string Decimal. */
  saldo_kg: number | null
  imagen_remito_url: string | null
  observaciones: string | null
  /** Remito (BOD/FRE/TRA) generado por el despacho; ausente/null en registros históricos. */
  remito_id?: string | null
  remito_numero?: string | null
  comprador_id?: string | null
  created_at: string
}

export interface RegistroCosechaCreate {
  fecha: string
  parcela_id?: string | null
  cultivo?: CultivoCosecha
  variedad?: string | null
  origen?: OrigenCosecha
  proveedor_tercero?: string | null
  productor_id?: string | null
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

export interface CosechaResumenPorOrigen {
  origen: OrigenCosecha
  kg_total: number
  n_registros: number
}

export interface CosechaTotalesResponse {
  temporada: number
  kg_total: number
  n_registros: number
  n_parcelas: number
  resumen_por_destino: CosechaResumenPorDestino[]
  resumen_por_origen: CosechaResumenPorOrigen[]
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

export const ORIGEN_LABELS: Record<OrigenCosecha, string> = {
  propio: 'Propio',
  tercero: 'Tercero (materia prima comprada)',
}

// saldo_kg llega como string Decimal (o null): se convierte acá.
function parseCosecha(d: RegistroCosechaResponse): RegistroCosechaResponse {
  const raw = (d as unknown as { saldo_kg?: string | number | null }).saldo_kg
  return { ...d, kg_total: Number(d.kg_total), saldo_kg: raw == null ? null : Number(raw) }
}

export async function getCosechas(params?: {
  fecha_desde?: string
  fecha_hasta?: string
  temporada?: number
  parcela_id?: string
  destino?: DestinoCosecha
  cultivo?: CultivoCosecha
  origen?: OrigenCosecha
  skip?: number
  limit?: number
}): Promise<RegistroCosechaResponse[]> {
  const { data } = await api.get<RegistroCosechaResponse[]>('/produccion/cosecha/', { params })
  return data.map(parseCosecha)
}

export async function createCosecha(payload: RegistroCosechaCreate): Promise<RegistroCosechaResponse> {
  const { data } = await api.post<RegistroCosechaResponse>('/produccion/cosecha/', payload)
  return parseCosecha(data)
}

export async function updateCosecha(id: string, payload: Partial<RegistroCosechaCreate>): Promise<RegistroCosechaResponse> {
  const { data } = await api.put<RegistroCosechaResponse>(`/produccion/cosecha/${id}`, payload)
  return parseCosecha(data)
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

// ── Despacho de cosecha (De -> Para) ──────────────────────────────────────────

export type ParaDespacho = 'bodega' | 'comprador' | 'pasero'

export const PARA_LABELS: Record<ParaDespacho, string> = {
  bodega: 'Bodega',
  comprador: 'Uva en fresco',
  pasero: 'Pasero',
}

export interface DespachoCosechaCreate {
  fecha: string
  para: ParaDespacho
  origen?: OrigenCosecha
  parcela_id?: string | null
  productor_id?: string | null
  variedad?: VariedadUva | null
  comprador_id?: string | null
  pasero_id?: string | null
  ubicacion_id?: string | null
  carros?: number
  carro_incompleto?: boolean
  kg_total?: number | null
  tipo_envase?: TipoEnvase
  cantidad_envases?: number | null
  peso_unitario_kg?: number | null
  bruto_kg?: number | null
  tara_kg?: number | null
  vehiculo_patente?: string | null
  cuadrilla?: string | null
  acarreo?: string | null
  n_ciu?: string | null
  n_remito?: string | null
  observaciones?: string | null
  imagen_remito_url?: string | null
  idempotency_key?: string | null
}

export interface DespachoCosechaResponse {
  cosecha: RegistroCosechaResponse
  remito: Remito
  ingreso_pasero: IngresoPasero | null
}

export async function createDespachoCosecha(payload: DespachoCosechaCreate): Promise<DespachoCosechaResponse> {
  const { data } = await api.post<Record<string, unknown>>('/produccion/cosecha/despacho', payload)
  return {
    cosecha: parseCosecha(data.cosecha as RegistroCosechaResponse),
    remito: parseRemito(data.remito as Record<string, unknown>),
    ingreso_pasero: data.ingreso_pasero ? parseIngreso(data.ingreso_pasero as Record<string, unknown>) : null,
  }
}
