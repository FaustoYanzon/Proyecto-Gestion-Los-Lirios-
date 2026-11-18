// Alfalfa inventory (alta/salida documents + derived stock) for mobile.
// Reduced mirror of frontend/lib/api/alfalfa.ts. Backend Decimals arrive as JSON
// strings: converted to number here, in the API layer.
//
// Writes need connection (no offline queue): stock validation depends on the
// server balance at the time of the request.
import { Linking } from 'react-native'
import api from './api'
import type { Parcela } from './types'

const num = (v: unknown): number => Number(v)

export type ProductoAlfalfa = 'fardo' | 'rollo' | 'semilla'
export type TipoDocumentoAlfalfa = 'alta' | 'salida'

export const PRODUCTO_LABELS: Record<ProductoAlfalfa, string> = {
  fardo: 'Fardos',
  rollo: 'Rollos',
  semilla: 'Semilla',
}

/** Unit the quantity is counted in: fardo/rollo by unit, semilla by kg. */
export const PRODUCTO_UNIDAD: Record<ProductoAlfalfa, 'unidades' | 'kg'> = {
  fardo: 'unidades',
  rollo: 'unidades',
  semilla: 'kg',
}

export interface StockAlfalfa {
  producto: ProductoAlfalfa
  unidades: number
  kg: number
}

export interface LineaAlfalfa {
  id: string
  producto: ProductoAlfalfa
  cantidad: number
  kg: number
}

export interface DocumentoAlfalfa {
  id: string
  tipo: TipoDocumentoAlfalfa
  numero: string
  fecha: string
  potrero_id: string | null
  comprador_id: string | null
  deposito_id: string
  vehiculo_patente: string | null
  observaciones: string | null
  idempotency_key: string | null
  created_by: string
  created_at: string
  kg_total: number
  lineas: LineaAlfalfa[]
  anulado: boolean
  anulado_at: string | null
  motivo_anulacion: string | null
}

export interface DocumentoAlfalfaCreate {
  tipo: TipoDocumentoAlfalfa
  fecha: string
  /** Required for alta, forbidden for salida. */
  potrero_id?: string | null
  /** Required for salida, forbidden for alta. */
  comprador_id?: string | null
  vehiculo_patente?: string | null
  observaciones?: string | null
  /** Reuse the same key when retrying the same submit. */
  idempotency_key?: string
  /** cantidad travels as a decimal string (max 2 decimals, dot separator). */
  lineas: { producto: ProductoAlfalfa; cantidad: string }[]
}

function parseDocumento(d: Record<string, unknown>): DocumentoAlfalfa {
  const lineas = (d.lineas as Record<string, unknown>[]).map((l) => ({
    ...(l as unknown as LineaAlfalfa),
    cantidad: num(l.cantidad),
    kg: num(l.kg),
  }))
  return {
    ...(d as unknown as DocumentoAlfalfa),
    kg_total: num(d.kg_total),
    lineas,
  }
}

export async function getStockAlfalfa(): Promise<StockAlfalfa[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/alfalfa/stock')
  return data.map((s) => ({
    producto: s.producto as ProductoAlfalfa,
    unidades: num(s.unidades),
    kg: num(s.kg),
  }))
}

export async function getDocumentosAlfalfa(limit = 20): Promise<DocumentoAlfalfa[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/alfalfa/documentos', { params: { limit } })
  return data.map(parseDocumento)
}

/** Active potreros, natural order by name ("Potrero 2" before "Potrero 10"). */
export async function getPotreros(): Promise<Parcela[]> {
  const { data } = await api.get<Parcela[]>('/parcelas/mapa')
  return data
    .filter((p) => p.tipo === 'potrero' && p.is_active)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
}

export async function createDocumentoAlfalfa(payload: DocumentoAlfalfaCreate): Promise<DocumentoAlfalfa> {
  const { data } = await api.post<Record<string, unknown>>('/alfalfa/documentos', payload)
  return parseDocumento(data)
}

/** Asks for a signed link (short-lived) to the document PDF and opens it in the phone's viewer. */
export async function abrirDocumentoAlfalfaPdf(documentoId: string): Promise<void> {
  const { data } = await api.post<{ url: string }>(`/alfalfa/documentos/${documentoId}/pdf-link`)
  await Linking.openURL(data.url)
}

// fardo/rollo: whole units > 0. semilla: kg > 0, up to 2 decimals, comma or dot.
const ENTERO_REGEX = /^\d+$/
const KG_REGEX = /^\d+([.,]\d{1,2})?$/

export function cantidadAlfalfaValida(producto: ProductoAlfalfa, texto: string): boolean {
  const t = texto.trim()
  const regex = PRODUCTO_UNIDAD[producto] === 'unidades' ? ENTERO_REGEX : KG_REGEX
  return regex.test(t) && Number(t.replace(',', '.')) > 0
}
