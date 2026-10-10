// Alta de Producción (pasero, lotes de pasa, productores) para mobile.
// Espejo reducido de frontend/lib/api/altaProduccion.ts: solo lo que usa el
// operario en campo. Los Decimal del backend llegan como string en JSON: se
// convierten a number acá, en la capa de API.
//
// Estas escrituras NO soportan idempotency_key ni la cola offline (el backend
// no deduplica y la validación depende del saldo de uva al momento): requieren
// conexión y muestran el error del backend.
import api from './api'
import type { DestinoCosecha, Parcela, UserRole, VariedadUva } from './types'

const num = (v: unknown): number => Number(v)

export const VARIEDADES: VariedadUva[] = [
  'flame', 'red_globe', 'fiesta', 'bonarda', 'sultanina', 'syrah', 'aspirant', 'alfalfa', 'otro',
]

// Mismo criterio que backend require_encargado_up: regador/obrero no entran.
export function puedeAltaProduccion(role: UserRole | undefined): boolean {
  return role === 'encargado' || role === 'gerencial' || role === 'super_admin'
}

const KG_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
export const fmtKg = (n: number): string => KG_FMT.format(n)
export const fmtFecha = (iso: string): string => iso.split('-').reverse().join('/')

// Fecha local YYYY-MM-DD (toISOString da la de UTC: de noche en AR sería mañana).
export function hoyISO(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// kg viajan como string decimal (hasta 2 decimales); se acepta coma.
const KG_REGEX = /^\d+([.,]\d{1,2})?$/
export const kgValido = (v: string): boolean => KG_REGEX.test(v.trim()) && Number(v.trim().replace(',', '.')) > 0
export const kgToString = (v: string): string => v.trim().replace(',', '.')

/** Mensaje legible del `detail` de un error de la API; avisa si no hay conexión. */
export function errorDetail(e: unknown, fallback = 'No se pudo completar la operación'): string {
  const err = e as { response?: { data?: { detail?: unknown } }; request?: unknown }
  if (!err?.response) {
    return 'Sin conexión con el servidor. Esta carga necesita conexión: reintentá cuando tengas señal.'
  }
  const detail = err.response.data?.detail
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

export interface Productor {
  id: string
  nombre: string
  tipo: 'propio' | 'externo'
  is_active: boolean
}

export async function getProductores(): Promise<Productor[]> {
  const { data } = await api.get<Productor[]>('/alta-produccion/productores')
  return data
}

export interface ParametrosProduccion {
  kg_por_ficha: number
  fichas_por_carro: number
  ratio_uva_pasa: number
  kg_nominal_bin: number
  tope_bines_lote: number | null
}

export async function getParametros(): Promise<ParametrosProduccion> {
  const { data } = await api.get<Record<string, unknown>>('/alta-produccion/parametros')
  return {
    kg_por_ficha: num(data.kg_por_ficha),
    fichas_por_carro: num(data.fichas_por_carro),
    ratio_uva_pasa: num(data.ratio_uva_pasa),
    kg_nominal_bin: num(data.kg_nominal_bin),
    tope_bines_lote: data.tope_bines_lote == null ? null : num(data.tope_bines_lote),
  }
}

export async function getPaseros(): Promise<Parcela[]> {
  const { data } = await api.get<Parcela[]>('/parcelas/mapa')
  return data.filter((p) => p.tipo === 'pasero' && p.is_active)
}

// ── Cosechas con destino a pasa (para vincular el ingreso) ────────────────────

export interface CosechaPasa {
  id: string
  fecha: string
  variedad: string | null
  origen: 'propio' | 'tercero'
  proveedor_tercero: string | null
  parcela_nombre: string | null
  productor_id: string | null
  destino: DestinoCosecha
  kg_total: number
  saldo_kg: number | null
}

export async function getCosechasPasa(temporada: number): Promise<CosechaPasa[]> {
  const pedir = async (destino: DestinoCosecha) => {
    const { data } = await api.get<Record<string, unknown>[]>('/produccion/cosecha/', {
      params: { temporada, destino, limit: 200 },
    })
    return data
  }
  const [pasas, rama] = await Promise.all([pedir('PASAS'), pedir('RAMA_PASA')])
  return [...pasas, ...rama]
    .map((d) => ({
      ...(d as unknown as CosechaPasa),
      kg_total: num(d.kg_total),
      saldo_kg: d.saldo_kg == null ? null : num(d.saldo_kg),
    }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
}

export function cosechaLabel(c: CosechaPasa): string {
  const origen = c.origen === 'tercero' ? (c.proveedor_tercero ?? 'Tercero') : (c.parcela_nombre ?? 'Sin parcela')
  return `${fmtFecha(c.fecha)} · ${origen} · ${c.variedad ?? 'sin variedad'}`
}

// ── Pasero ────────────────────────────────────────────────────────────────────

export type OrigenIngreso = 'propio' | 'tercero'

export interface IngresoPasero {
  id: string
  fecha: string
  pasero_id: string
  cosecha_id: string | null
  variedad: VariedadUva
  origen: OrigenIngreso
  productor_id: string | null
  carros: number
  fichas: number
  kg_teorico: number
  kg_real: number
  merma_kg: number
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

export async function getIngresosPasero(): Promise<IngresoPasero[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/pasero/ingresos')
  return data.map(parseIngreso)
}

export async function createIngresoPasero(payload: IngresoPaseroCreate): Promise<IngresoPasero> {
  const { data } = await api.post<Record<string, unknown>>('/pasero/ingresos', payload)
  return parseIngreso(data)
}

export interface StockPaseroItem {
  pasero_id: string
  pasero_nombre: string
  variedad: VariedadUva
  uva_disponible_kg: number
}

export async function getStockPasero(pasero_id?: string): Promise<StockPaseroItem[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/pasero/stock', {
    params: pasero_id ? { pasero_id } : {},
  })
  return data.map((d) => ({
    pasero_id: String(d.pasero_id),
    pasero_nombre: String(d.pasero_nombre),
    variedad: d.variedad as VariedadUva,
    uva_disponible_kg: num(d.uva_disponible_kg),
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
  kg_total: number
  saldo_kg: number
  tope_bines: number | null
  cantidad_bines: number
}

export interface BinPasa {
  id: string
  pasero_id: string
  fecha: string
  kg_real: number
  uva_consumida_kg: number
}

export interface LotePasaDetalle extends LotePasa {
  bines: BinPasa[]
}

function parseLote(d: Record<string, unknown>): LotePasa {
  return {
    ...(d as unknown as LotePasa),
    kg_total: num(d.kg_total),
    saldo_kg: num(d.saldo_kg),
  }
}

export async function getLotesPasa(estado?: EstadoLote): Promise<LotePasa[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/lotes-pasa/', {
    params: estado ? { estado } : {},
  })
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

export async function cerrarLotePasa(loteId: string): Promise<LotePasa> {
  const { data } = await api.post<Record<string, unknown>>(`/lotes-pasa/${loteId}/cerrar`, {})
  return parseLote(data)
}
