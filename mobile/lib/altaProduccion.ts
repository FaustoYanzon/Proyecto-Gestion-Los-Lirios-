// Alta de Producción (pasero, lotes de pasa, productores) para mobile.
// Espejo reducido de frontend/lib/api/altaProduccion.ts: solo lo que usa el
// operario en campo. Los Decimal del backend llegan como string en JSON: se
// convierten a number acá, en la capa de API.
//
// Estas escrituras NO soportan idempotency_key ni la cola offline (el backend
// no deduplica y la validación depende del saldo de uva al momento): requieren
// conexión y muestran el error del backend.
import { Linking } from 'react-native'
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
  tara_carro: number
  tope_bines_lote: number | null
}

export async function getParametros(): Promise<ParametrosProduccion> {
  const { data } = await api.get<Record<string, unknown>>('/alta-produccion/parametros')
  return {
    kg_por_ficha: num(data.kg_por_ficha),
    fichas_por_carro: num(data.fichas_por_carro),
    ratio_uva_pasa: num(data.ratio_uva_pasa),
    kg_nominal_bin: num(data.kg_nominal_bin),
    tara_carro: num(data.tara_carro),
    tope_bines_lote: data.tope_bines_lote == null ? null : num(data.tope_bines_lote),
  }
}

// "Pasero 2" antes que "Pasero 10": orden natural ascendente por nombre.
const porNombre = (a: Parcela, b: Parcela): number =>
  a.nombre.localeCompare(b.nombre, 'es', { numeric: true })

async function getParcelasActivas(tipo: Parcela['tipo']): Promise<Parcela[]> {
  const { data } = await api.get<Parcela[]>('/parcelas/mapa')
  return data.filter((p) => p.tipo === tipo && p.is_active).sort(porNombre)
}

export const getPaseros = (): Promise<Parcela[]> => getParcelasActivas('pasero')
export const getParrales = (): Promise<Parcela[]> => getParcelasActivas('parral')

export interface Comprador {
  id: string
  nombre: string
  cuit: string | null
  is_active: boolean
}

export async function getCompradores(): Promise<Comprador[]> {
  const { data } = await api.get<Comprador[]>('/alta-produccion/compradores')
  return data
}

export interface UbicacionPasero {
  id: string
  pasero_id: string
  hilera: number
  parte: number
}

export async function getUbicacionesPasero(pasero_id: string): Promise<UbicacionPasero[]> {
  const { data } = await api.get<UbicacionPasero[]>('/pasero/ubicaciones', { params: { pasero_id } })
  return data
}

// ── Despacho de cosecha ("De -> Para") ────────────────────────────────────────
// POST /produccion/cosecha/despacho: crea cosecha + remito (+ ingreso al pasero)
// en una transacción. Requiere conexión; la idempotency_key evita duplicados al
// reintentar el mismo envío. Espejo de frontend/lib/api/cosecha.ts.

export type ParaDespacho = 'bodega' | 'comprador' | 'pasero'
export type TipoEnvaseDespacho = 'caja' | 'bin' | 'chasis' | 'ficha' | 'vin' | 'bolsa' | 'otro'

export const PARA_LABELS: Record<ParaDespacho, string> = {
  bodega: 'Bodega',
  comprador: 'Uva en fresco',
  pasero: 'Pasero',
}

export const ENVASE_LABELS: Record<TipoEnvaseDespacho, string> = {
  caja: 'Caja', bin: 'Bin', chasis: 'Chasis', ficha: 'Ficha', vin: 'Vin Grande', bolsa: 'Bolsa', otro: 'Otro',
}

export const PREFIJO_REMITO: Record<ParaDespacho, string> = { bodega: 'BOD', comprador: 'FRE', pasero: 'TRA' }

export interface DespachoCosechaCreate {
  fecha: string
  para: ParaDespacho
  origen: OrigenIngreso
  parcela_id?: string | null
  productor_id?: string | null
  variedad?: VariedadUva | null
  comprador_id?: string | null
  pasero_id?: string | null
  ubicacion_id?: string | null
  carros?: number
  carro_incompleto?: boolean
  kg_total?: number | null
  tipo_envase?: TipoEnvaseDespacho
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
  idempotency_key: string
}

export interface RemitoDespacho {
  id: string
  numero: string
  kg_total: number
  comprador_nombre: string | null
  pasero_nombre: string | null
}

export interface DespachoCosechaResultado {
  remito: RemitoDespacho
  ingresoPasero: boolean
}

export async function createDespachoCosecha(payload: DespachoCosechaCreate): Promise<DespachoCosechaResultado> {
  const { data } = await api.post<Record<string, unknown>>('/produccion/cosecha/despacho', payload)
  const r = data.remito as Record<string, unknown>
  return {
    remito: {
      id: String(r.id),
      numero: String(r.numero),
      kg_total: num(r.kg_total),
      comprador_nombre: (r.comprador_nombre as string | null) ?? null,
      pasero_nombre: (r.pasero_nombre as string | null) ?? null,
    },
    ingresoPasero: data.ingreso_pasero != null,
  }
}

/** Pide un link firmado (5 min) del PDF del remito y lo abre en el navegador/visor del teléfono. */
export async function abrirRemitoPdf(remitoId: string): Promise<void> {
  const { data } = await api.post<{ url: string }>(`/remitos/${remitoId}/pdf-link`)
  await Linking.openURL(data.url)
}

// ── Cosechas con destino a pasa (para vincular el ingreso) ────────────────────

export interface CosechaPasa {
  id: string
  fecha: string
  variedad: string | null
  origen: 'propio' | 'tercero'
  proveedor_tercero: string | null
  parcela_id: string | null
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
  parcela_origen_id?: string | null
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
  /** Parral de origen (solo origen propio). */
  parcela_origen_id?: string | null
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
  tarja: string
  pasero_id: string
  fecha: string
  kg_real: number
  uva_consumida_kg: number
  observaciones: string | null
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
  payload: { pasero_id: string; kg_real: string; fecha?: string | null; observaciones?: string | null },
): Promise<LotePasa> {
  const { data } = await api.post<Record<string, unknown>>(`/lotes-pasa/${loteId}/bines`, payload)
  return parseLote(data)
}

export async function cerrarLotePasa(loteId: string): Promise<LotePasa> {
  const { data } = await api.post<Record<string, unknown>>(`/lotes-pasa/${loteId}/cerrar`, {})
  return parseLote(data)
}

// PDF de lotes: link firmado de 5 min (mismo esquema que el remito) y se abre con
// Linking, sin header Authorization.

/** Tarja del bin: media hoja A4 horizontal con los datos de los dos lados. */
export async function abrirTarjaPdf(loteId: string, binId: string): Promise<void> {
  const { data } = await api.post<{ url: string }>(`/lotes-pasa/${loteId}/bines/${binId}/tarja-pdf-link`)
  await Linking.openURL(data.url)
}

/** Hoja del lote con el listado de bines (solo lotes completos / cerrados). */
export async function abrirHojaLotePdf(loteId: string): Promise<void> {
  const { data } = await api.post<{ url: string }>(`/lotes-pasa/${loteId}/pdf-link`)
  await Linking.openURL(data.url)
}
