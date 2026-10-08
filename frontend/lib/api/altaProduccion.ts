import api from '@/lib/api'
import type { VariedadUva } from '@/lib/api/parcelas'

// Los Decimal del backend llegan como string en JSON: se convierten a number
// acá, en la capa de API, para que el resto del front opere con números.

const num = (v: unknown): number => Number(v)
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v))

/** Mensaje legible del `detail` de un error de la API (409/422/404...). */
export function errorDetail(e: unknown, fallback = 'No se pudo completar la operación'): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : ''))
      .filter(Boolean)
    if (msgs.length) return msgs.join('. ')
  }
  return fallback
}

// ── Maestros ──────────────────────────────────────────────────────────────────

export type TipoProductor = 'propio' | 'externo'

export const TIPO_PRODUCTOR_LABELS: Record<TipoProductor, string> = {
  propio: 'Propio',
  externo: 'Externo',
}

export interface Productor {
  id: string
  nombre: string
  tipo: TipoProductor
  cuit: string | null
  contacto: string | null
  is_active: boolean
  created_at: string
}

export interface Comprador {
  id: string
  nombre: string
  cuit: string | null
  contacto: string | null
  is_active: boolean
  created_at: string
}

export interface Deposito {
  id: string
  nombre: string
  is_active: boolean
  created_at: string
}

export interface ProductorInput {
  nombre?: string
  tipo?: TipoProductor
  cuit?: string | null
  contacto?: string | null
  is_active?: boolean
}
export interface CompradorInput {
  nombre?: string
  cuit?: string | null
  contacto?: string | null
  is_active?: boolean
}
export interface DepositoInput {
  nombre?: string
  is_active?: boolean
}

const BASE = '/alta-produccion'

export async function getProductores(isActive?: boolean): Promise<Productor[]> {
  const { data } = await api.get<Productor[]>(`${BASE}/productores`, {
    params: isActive === undefined ? {} : { is_active: isActive },
  })
  return data
}
export async function createProductor(payload: ProductorInput): Promise<Productor> {
  const { data } = await api.post<Productor>(`${BASE}/productores`, payload)
  return data
}
export async function updateProductor(id: string, payload: ProductorInput): Promise<Productor> {
  const { data } = await api.patch<Productor>(`${BASE}/productores/${id}`, payload)
  return data
}

export async function getCompradores(isActive?: boolean): Promise<Comprador[]> {
  const { data } = await api.get<Comprador[]>(`${BASE}/compradores`, {
    params: isActive === undefined ? {} : { is_active: isActive },
  })
  return data
}
export async function createComprador(payload: CompradorInput): Promise<Comprador> {
  const { data } = await api.post<Comprador>(`${BASE}/compradores`, payload)
  return data
}
export async function updateComprador(id: string, payload: CompradorInput): Promise<Comprador> {
  const { data } = await api.patch<Comprador>(`${BASE}/compradores/${id}`, payload)
  return data
}

export async function getDepositos(isActive?: boolean): Promise<Deposito[]> {
  const { data } = await api.get<Deposito[]>(`${BASE}/depositos`, {
    params: isActive === undefined ? {} : { is_active: isActive },
  })
  return data
}
export async function createDeposito(payload: DepositoInput): Promise<Deposito> {
  const { data } = await api.post<Deposito>(`${BASE}/depositos`, payload)
  return data
}
export async function updateDeposito(id: string, payload: DepositoInput): Promise<Deposito> {
  const { data } = await api.patch<Deposito>(`${BASE}/depositos/${id}`, payload)
  return data
}

// ── Parámetros ────────────────────────────────────────────────────────────────

export interface ParametrosProduccion {
  kg_por_ficha: number
  fichas_por_carro: number
  ratio_uva_pasa: number
  kg_nominal_bin: number
  tope_bines_lote: number | null
}

export type ParametrosUpdate = Partial<ParametrosProduccion>

function parseParametros(d: Record<string, unknown>): ParametrosProduccion {
  return {
    kg_por_ficha: num(d.kg_por_ficha),
    fichas_por_carro: num(d.fichas_por_carro),
    ratio_uva_pasa: num(d.ratio_uva_pasa),
    kg_nominal_bin: num(d.kg_nominal_bin),
    tope_bines_lote: numOrNull(d.tope_bines_lote),
  }
}

export async function getParametros(): Promise<ParametrosProduccion> {
  const { data } = await api.get(`${BASE}/parametros`)
  return parseParametros(data)
}

/** PATCH parcial: solo se envían los campos informados. `tope_bines_lote: null` quita el tope. */
export async function updateParametros(payload: ParametrosUpdate): Promise<ParametrosProduccion> {
  const { data } = await api.patch(`${BASE}/parametros`, payload)
  return parseParametros(data)
}

// ── Pasero ────────────────────────────────────────────────────────────────────

export type OrigenIngreso = 'propio' | 'tercero'

export interface IngresoPasero {
  id: string
  fecha: string
  pasero_id: string
  ubicacion_id: string | null
  cosecha_id: string | null
  variedad: VariedadUva
  origen: OrigenIngreso
  productor_id: string | null
  carros: number
  fichas: number
  kg_teorico: number
  kg_real: number
  merma_kg: number
  observaciones: string | null
  created_at: string
}

export interface IngresoPaseroCreate {
  fecha: string
  pasero_id: string
  variedad: VariedadUva
  /** Decimal con hasta 2 decimales; se envía como string. */
  kg_real: string
  carros: number
  fichas?: number | null
  origen: OrigenIngreso
  productor_id?: string | null
  ubicacion_id?: string | null
  cosecha_id?: string | null
  observaciones?: string | null
}

function parseIngreso(d: Record<string, unknown>): IngresoPasero {
  return {
    ...(d as unknown as IngresoPasero),
    kg_teorico: num(d.kg_teorico),
    kg_real: num(d.kg_real),
    merma_kg: num(d.merma_kg),
  }
}

export async function getIngresosPasero(params?: {
  pasero_id?: string
  variedad?: VariedadUva
}): Promise<IngresoPasero[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/pasero/ingresos', { params })
  return data.map(parseIngreso)
}

export async function createIngresoPasero(payload: IngresoPaseroCreate): Promise<IngresoPasero> {
  const { data } = await api.post<Record<string, unknown>>('/pasero/ingresos', payload)
  return parseIngreso(data)
}

export interface UbicacionPasero {
  id: string
  pasero_id: string
  hilera: number
  parte: number
}

export async function getUbicacionesPasero(pasero_id?: string): Promise<UbicacionPasero[]> {
  const { data } = await api.get<UbicacionPasero[]>('/pasero/ubicaciones', {
    params: pasero_id ? { pasero_id } : {},
  })
  return data
}

export async function createUbicacionPasero(payload: {
  pasero_id: string
  hilera: number
  parte: number
}): Promise<UbicacionPasero> {
  const { data } = await api.post<UbicacionPasero>('/pasero/ubicaciones', payload)
  return data
}

export interface StockPaseroItem {
  pasero_id: string
  pasero_nombre: string
  variedad: VariedadUva
  uva_ingresada_kg: number
  uva_consumida_kg: number
  uva_disponible_kg: number
  pasa_levantada_kg: number
  pasa_esperada_kg: number
  diferencia_pasa_kg: number
}

export async function getStockPasero(pasero_id?: string): Promise<StockPaseroItem[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/pasero/stock', {
    params: pasero_id ? { pasero_id } : {},
  })
  return data.map((d) => ({
    ...(d as unknown as StockPaseroItem),
    uva_ingresada_kg: num(d.uva_ingresada_kg),
    uva_consumida_kg: num(d.uva_consumida_kg),
    uva_disponible_kg: num(d.uva_disponible_kg),
    pasa_levantada_kg: num(d.pasa_levantada_kg),
    pasa_esperada_kg: num(d.pasa_esperada_kg),
    diferencia_pasa_kg: num(d.diferencia_pasa_kg),
  }))
}

// ── Lotes de pasa ─────────────────────────────────────────────────────────────

export type EstadoLote = 'abierto' | 'cerrado'

export interface LotePasa {
  id: string
  temporada: number
  variedad: VariedadUva
  calidad: number
  numero: number
  estado: EstadoLote
  deposito_id: string | null
  kg_total: number
  saldo_kg: number
  tope_bines: number | null
  cantidad_bines: number
  merma_bines_kg: number
  created_at: string
  closed_at: string | null
}

export interface BinPasa {
  id: string
  lote_id: string
  pasero_id: string
  fecha: string
  kg_real: number
  uva_consumida_kg: number
  created_at: string
}

export interface LotePasaDetalle extends LotePasa {
  bines: BinPasa[]
}

function parseLote(d: Record<string, unknown>): LotePasa {
  return {
    ...(d as unknown as LotePasa),
    kg_total: num(d.kg_total),
    saldo_kg: num(d.saldo_kg),
    merma_bines_kg: num(d.merma_bines_kg),
  }
}

export async function getLotesPasa(params?: {
  estado?: EstadoLote
  variedad?: VariedadUva
  temporada?: number
  con_saldo?: boolean
}): Promise<LotePasa[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/lotes-pasa/', { params })
  return data.map(parseLote)
}

export async function getLotePasa(id: string): Promise<LotePasaDetalle> {
  const { data } = await api.get<Record<string, unknown>>(`/lotes-pasa/${id}`)
  const bines = (data.bines as Record<string, unknown>[]).map((b) => ({
    ...(b as unknown as BinPasa),
    kg_real: num(b.kg_real),
    uva_consumida_kg: num(b.uva_consumida_kg),
  }))
  return { ...parseLote(data), bines }
}

export async function abrirLotePasa(payload: {
  variedad: VariedadUva
  calidad: number
  fecha?: string | null
  deposito_id?: string | null
}): Promise<LotePasa> {
  const { data } = await api.post<Record<string, unknown>>('/lotes-pasa/', payload)
  return parseLote(data)
}

export async function agregarBinPasa(
  loteId: string,
  payload: { pasero_id: string; kg_real: string; fecha?: string | null },
): Promise<LotePasa> {
  const { data } = await api.post<Record<string, unknown>>(`/lotes-pasa/${loteId}/bines`, payload)
  return parseLote(data)
}

export async function cerrarLotePasa(loteId: string, deposito_id?: string | null): Promise<LotePasa> {
  const { data } = await api.post<Record<string, unknown>>(
    `/lotes-pasa/${loteId}/cerrar`,
    deposito_id ? { deposito_id } : {},
  )
  return parseLote(data)
}

// ── Remitos ───────────────────────────────────────────────────────────────────

export type TipoRemito = 'entrega_pasa' | 'salida_fresco' | 'salida_bodega'

export const TIPO_REMITO_LABELS: Record<TipoRemito, string> = {
  entrega_pasa: 'Entrega de pasa (PAS)',
  salida_fresco: 'Salida de fresco (FRE)',
  salida_bodega: 'Salida a bodega (BOD)',
}

export interface RemitoLinea {
  id: string
  lote_id: string | null
  cosecha_id: string | null
  lote_label: string | null
  cosecha_label: string | null
  kg: number
}

export interface ComprobanteBodega {
  id: string
  remito_id: string
  numero_suv: string
  kg_recibidos: number
  fecha: string | null
  observaciones: string | null
  diferencia_kg: number
  created_at: string
}

export interface Remito {
  id: string
  tipo: TipoRemito
  numero: string
  fecha: string
  comprador_id: string
  kg_total: number
  vehiculo_patente: string | null
  observaciones: string | null
  created_at: string
  lineas: RemitoLinea[]
  comprobante_bodega: ComprobanteBodega | null
}

export interface RemitoCreate {
  tipo: TipoRemito
  fecha: string
  comprador_id: string
  numero?: string | null
  vehiculo_patente?: string | null
  observaciones?: string | null
  /** kg como string decimal; entrega_pasa usa lote_id, salidas usan cosecha_id. */
  lineas: { kg: string; lote_id?: string | null; cosecha_id?: string | null }[]
}

function parseComprobante(d: Record<string, unknown>): ComprobanteBodega {
  return {
    ...(d as unknown as ComprobanteBodega),
    kg_recibidos: num(d.kg_recibidos),
    diferencia_kg: num(d.diferencia_kg),
  }
}

function parseRemito(d: Record<string, unknown>): Remito {
  return {
    ...(d as unknown as Remito),
    kg_total: num(d.kg_total),
    lineas: (d.lineas as Record<string, unknown>[]).map((l) => ({
      ...(l as unknown as RemitoLinea),
      kg: num(l.kg),
    })),
    comprobante_bodega: d.comprobante_bodega
      ? parseComprobante(d.comprobante_bodega as Record<string, unknown>)
      : null,
  }
}

export async function getRemitos(params?: {
  tipo?: TipoRemito
  comprador_id?: string
  desde?: string
  hasta?: string
}): Promise<Remito[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/remitos/', { params })
  return data.map(parseRemito)
}

export async function createRemito(payload: RemitoCreate): Promise<Remito> {
  const { data } = await api.post<Record<string, unknown>>('/remitos/', payload)
  return parseRemito(data)
}

export async function cargarComprobanteBodega(
  remitoId: string,
  payload: { numero_suv: string; kg_recibidos: string; fecha?: string | null; observaciones?: string | null },
): Promise<ComprobanteBodega> {
  const { data } = await api.post<Record<string, unknown>>(`/remitos/${remitoId}/comprobante-bodega`, payload)
  return parseComprobante(data)
}
