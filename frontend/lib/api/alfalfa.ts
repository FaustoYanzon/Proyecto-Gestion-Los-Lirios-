import api from '@/lib/api'
import { abrirPdf } from '@/lib/api/altaProduccion'

// Backend Decimals arrive as JSON strings: converted here, in the API layer.

export type ProductoAlfalfa = 'fardo' | 'rollo' | 'semilla'
export type TipoDocumentoAlfalfa = 'alta' | 'salida'

export const PRODUCTO_LABELS: Record<ProductoAlfalfa, string> = {
  fardo: 'Fardos',
  rollo: 'Rollos',
  semilla: 'Semilla',
}

export const TIPO_DOC_LABELS: Record<TipoDocumentoAlfalfa, string> = {
  alta: 'Alta',
  salida: 'Salida',
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
}

export interface FiltrosDocumentosAlfalfa {
  tipo?: TipoDocumentoAlfalfa
  fecha_desde?: string
  fecha_hasta?: string
  potrero_id?: string
  comprador_id?: string
  skip?: number
  limit?: number
}

export interface DocumentoAlfalfaCreate {
  tipo: TipoDocumentoAlfalfa
  fecha: string
  potrero_id?: string | null
  comprador_id?: string | null
  vehiculo_patente?: string | null
  observaciones?: string | null
  /** Reused by the caller when retrying after a network error. */
  idempotency_key?: string
  lineas: { producto: ProductoAlfalfa; cantidad: string }[]
}

function parseDocumento(d: Record<string, unknown>): DocumentoAlfalfa {
  const lineas = (d.lineas as Record<string, unknown>[]).map((l) => ({
    ...(l as unknown as LineaAlfalfa),
    cantidad: Number(l.cantidad),
    kg: Number(l.kg),
  }))
  return {
    ...(d as unknown as DocumentoAlfalfa),
    kg_total: Number(d.kg_total),
    lineas,
  }
}

export async function getStockAlfalfa(): Promise<StockAlfalfa[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/alfalfa/stock')
  return data.map((s) => ({
    producto: s.producto as ProductoAlfalfa,
    unidades: Number(s.unidades),
    kg: Number(s.kg),
  }))
}

export async function listarDocumentosAlfalfa(
  filtros: FiltrosDocumentosAlfalfa = {},
): Promise<DocumentoAlfalfa[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/alfalfa/documentos', {
    params: { limit: 200, ...filtros },
  })
  return data.map(parseDocumento)
}

export async function crearDocumentoAlfalfa(payload: DocumentoAlfalfaCreate): Promise<DocumentoAlfalfa> {
  const body = { ...payload, idempotency_key: payload.idempotency_key ?? crypto.randomUUID() }
  const { data } = await api.post<Record<string, unknown>>('/alfalfa/documentos', body)
  return parseDocumento(data)
}

export const abrirPdfAlfalfa = (id: string, numero: string): Promise<void> =>
  abrirPdf(`/alfalfa/documentos/${id}/pdf`, `alfalfa-${numero}.pdf`)
