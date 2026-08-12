import api from '@/lib/api'
import type { EgresoResponse } from '@/lib/api/egresos'
import type { IngresoResponse } from '@/lib/api/ingresos'

export type TipoArchivoArca = 'recibido' | 'emitido'
export type EstadoComprobanteArca = 'pendiente' | 'clasificado' | 'descartado'

export interface ComprobanteArcaResponse {
  id: string
  lote_id: string
  tipo_archivo: TipoArchivoArca
  fecha_emision: string
  tipo_comprobante: number
  tipo_comprobante_desc: string
  es_nota_credito: boolean
  punto_venta: number
  numero_desde: number
  numero_hasta: number
  cod_autorizacion: string | null
  cuit_contraparte: string
  denominacion_contraparte: string
  moneda: 'ars' | 'usd'
  tipo_cambio: number
  total_iva: number
  imp_total: number
  estado: EstadoComprobanteArca
  egreso_id: string | null
  ingreso_id: string | null
  created_at: string
}

export interface LoteImportacionArcaResponse {
  id: string
  tipo_archivo: TipoArchivoArca
  nombre_archivo: string
  cantidad_filas: number
  cantidad_nuevas: number
  cantidad_duplicadas: number
  importado_por: string
  importado_at: string
}

export interface ImportarArcaResponse {
  lote: LoteImportacionArcaResponse
  nuevos: number
  duplicados: number
  errores: string[]
}

export interface ClasificarEgresoRequest {
  tipo: string
  clasificacion: string
  finca: 'los_mimbres' | 'media_agua' | 'caucete'
  forma_pago: 'efectivo' | 'transferencia' | 'cheque' | 'echeque' | 'credito'
  parcela_id?: string
  descripcion?: string
}

export interface ClasificarIngresoRequest {
  destino: string
  comprador?: string
  finca: 'los_mimbres' | 'media_agua' | 'caucete'
  forma_pago: 'efectivo' | 'transferencia' | 'cheque' | 'echeque' | 'credito'
  cuenta_destino?: string
  descripcion?: string
}

export interface ResumenIvaResponse {
  anio: number
  mes: number
  iva_compra: number
  iva_venta: number
  iva_saldo: number
}

export async function importarArcaCsv(
  tipoArchivo: TipoArchivoArca,
  file: File
): Promise<ImportarArcaResponse> {
  const formData = new FormData()
  formData.append('tipo_archivo', tipoArchivo)
  formData.append('file', file)
  const { data } = await api.post('/finanzas/arca/importar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function getPendientesArca(
  tipoArchivo: TipoArchivoArca,
  estado: EstadoComprobanteArca = 'pendiente'
): Promise<ComprobanteArcaResponse[]> {
  const { data } = await api.get('/finanzas/arca/pendientes', {
    params: { tipo_archivo: tipoArchivo, estado },
  })
  return data
}

export async function restaurarComprobanteArca(comprobanteId: string): Promise<ComprobanteArcaResponse> {
  const { data } = await api.post(`/finanzas/arca/${comprobanteId}/restaurar`)
  return data
}

export async function eliminarComprobanteArca(comprobanteId: string): Promise<void> {
  await api.delete(`/finanzas/arca/${comprobanteId}`)
}

export async function getLotesArca(params: {
  tipo_archivo?: TipoArchivoArca
  limit?: number
}): Promise<LoteImportacionArcaResponse[]> {
  const { data } = await api.get('/finanzas/arca/lotes', { params })
  return data
}

export async function clasificarComoEgreso(
  comprobanteId: string,
  data: ClasificarEgresoRequest
): Promise<EgresoResponse> {
  const { data: res } = await api.post(`/finanzas/arca/${comprobanteId}/clasificar-egreso`, data)
  return res
}

export async function clasificarComoIngreso(
  comprobanteId: string,
  data: ClasificarIngresoRequest
): Promise<IngresoResponse> {
  const { data: res } = await api.post(`/finanzas/arca/${comprobanteId}/clasificar-ingreso`, data)
  return res
}

export async function descartarComprobanteArca(comprobanteId: string): Promise<void> {
  await api.post(`/finanzas/arca/${comprobanteId}/descartar`)
}

export async function getResumenIva(params: { anio?: number; mes?: number }): Promise<ResumenIvaResponse> {
  const { data } = await api.get('/finanzas/arca/resumen-iva', { params })
  return data
}
