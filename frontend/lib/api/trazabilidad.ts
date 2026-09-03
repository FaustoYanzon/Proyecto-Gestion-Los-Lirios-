import api from '@/lib/api'
import type { RiegoResponse } from '@/lib/api/riego'
import type { FitosanitarioResponse } from '@/lib/api/fitosanitarios'
import type { RegistroTrabajoResponse } from '@/lib/api/produccion'
import type { RegistroCosechaResponse } from '@/lib/api/cosecha'
import type { CicloCampanaItem } from '@/lib/api/produccion'

// ── Fotos ────────────────────────────────────────────────────────────────────

export interface FotoResponse {
  id: string
  parcela_id: string
  fecha: string
  categoria: string
  descripcion: string | null
  url: string
  created_by: string
  created_at: string
}

export async function createFoto(payload: {
  parcela_id: string
  fecha: string
  categoria: string
  descripcion?: string
  file: File
}): Promise<FotoResponse> {
  const formData = new FormData()
  formData.append('parcela_id', payload.parcela_id)
  formData.append('fecha', payload.fecha)
  formData.append('categoria', payload.categoria)
  if (payload.descripcion) formData.append('descripcion', payload.descripcion)
  formData.append('file', payload.file)
  const { data } = await api.post('/trazabilidad/fotos/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function getFotos(params: {
  parcela_id?: string; desde?: string; hasta?: string
}): Promise<FotoResponse[]> {
  const { data } = await api.get('/trazabilidad/fotos/', { params })
  return data
}

export async function deleteFoto(id: string): Promise<void> {
  await api.delete(`/trazabilidad/fotos/${id}`)
}

// ── Analisis de Calidad ───────────────────────────────────────────────────────

export type OrigenAnalisis = 'propio' | 'laboratorio'
export type EstadoSanitarioAnalisis = 'sano' | 'con_observaciones' | 'rechazado'

export const ORIGEN_ANALISIS_LABELS: Record<OrigenAnalisis, string> = {
  propio: 'Medición propia',
  laboratorio: 'Informe de laboratorio',
}

export const ESTADO_SANITARIO_LABELS: Record<EstadoSanitarioAnalisis, string> = {
  sano: 'Sano',
  con_observaciones: 'Con observaciones',
  rechazado: 'Rechazado',
}

export interface AnalisisCalidadResponse {
  id: string
  parcela_id: string
  fecha: string
  origen: OrigenAnalisis
  brix: number | null
  acidez: number | null
  ph: number | null
  estado_sanitario: EstadoSanitarioAnalisis | null
  laboratorio_nombre: string | null
  informe_url: string | null
  observaciones: string | null
  created_by: string
  created_at: string
}

export async function createAnalisisCalidad(payload: {
  parcela_id: string
  fecha: string
  origen: OrigenAnalisis
  brix?: number
  acidez?: number
  ph?: number
  estado_sanitario?: EstadoSanitarioAnalisis
  laboratorio_nombre?: string
  observaciones?: string
  file?: File
}): Promise<AnalisisCalidadResponse> {
  const formData = new FormData()
  formData.append('parcela_id', payload.parcela_id)
  formData.append('fecha', payload.fecha)
  formData.append('origen', payload.origen)
  if (payload.brix !== undefined) formData.append('brix', String(payload.brix))
  if (payload.acidez !== undefined) formData.append('acidez', String(payload.acidez))
  if (payload.ph !== undefined) formData.append('ph', String(payload.ph))
  if (payload.estado_sanitario) formData.append('estado_sanitario', payload.estado_sanitario)
  if (payload.laboratorio_nombre) formData.append('laboratorio_nombre', payload.laboratorio_nombre)
  if (payload.observaciones) formData.append('observaciones', payload.observaciones)
  if (payload.file) formData.append('file', payload.file)
  const { data } = await api.post('/trazabilidad/analisis/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function getAnalisisCalidad(params: {
  parcela_id?: string; desde?: string; hasta?: string
}): Promise<AnalisisCalidadResponse[]> {
  const { data } = await api.get('/trazabilidad/analisis/', { params })
  return data
}

export async function deleteAnalisisCalidad(id: string): Promise<void> {
  await api.delete(`/trazabilidad/analisis/${id}`)
}

// ── Historial / Ficha de Trazabilidad ─────────────────────────────────────────

export type ComplianceEstado = 'cumplido' | 'incumplido' | 'pendiente'

export const COMPLIANCE_ESTADO_LABELS: Record<ComplianceEstado, string> = {
  cumplido: 'Cumplido',
  incumplido: 'Incumplido',
  pendiente: 'Pendiente',
}

export interface ComplianceFitosanitarioItem {
  fitosanitario_id: string
  fecha_aplicacion: string
  producto_nombre: string
  fecha_habilitacion_cosecha: string
  estado: ComplianceEstado
  cosecha_conflictiva_id: string | null
  cosecha_conflictiva_fecha: string | null
}

export interface CumplimientoEstadoItem {
  estado_campana: string
  estado_campana_label: string
  fecha_inicio: string
  fecha_fin: string
  riegos_esperados: number
  mm_aplicados: number
  riegos_equivalentes: number
  cumplimiento_pct: number
  cumplido: boolean
}

export interface ResumenDestinoItem {
  destino: string
  destino_label: string
  kg_total: number
  n_registros: number
  pct_del_total: number
}

export interface CentroideItem {
  lat: number
  lng: number
}

export interface TareaResumenItem {
  tarea: string
  unidad_medida_label: string
  fecha_inicio: string
  fecha_fin: string
  registros: number
}

export interface HistorialParcelaResponse {
  parcela_id: string
  parcela_nombre: string
  desde: string
  hasta: string
  riegos: RiegoResponse[]
  fitosanitarios: FitosanitarioResponse[]
  trabajos: RegistroTrabajoResponse[]
  cosechas: RegistroCosechaResponse[]
  ciclos_campana: CicloCampanaItem[]
  fotos: FotoResponse[]
  analisis_calidad: AnalisisCalidadResponse[]
  compliance_fitosanitarios: ComplianceFitosanitarioItem[]
  parcela_variedad_descripcion: string | null
  parcela_centroide: CentroideItem | null
  parcela_tipo_riego: string | null
  parcela_cobertura_invierno: string | null
  cumplimiento_riego_por_estado: CumplimientoEstadoItem[]
  resumen_destino: ResumenDestinoItem[]
  tareas_resumen: TareaResumenItem[]
  horas_de_frio: number | null
  mm_objetivo_anual: number
  meta_produccion_kg: number | null
}

export async function getHistorialParcela(
  parcelaId: string, desde: string, hasta: string,
): Promise<HistorialParcelaResponse> {
  const { data } = await api.get(`/trazabilidad/parcela/${parcelaId}/historial`, {
    params: { desde, hasta },
  })
  return data
}

export async function downloadCartaPdf(
  parcelaId: string, desde: string, hasta: string,
): Promise<Blob> {
  const { data } = await api.get(`/trazabilidad/parcela/${parcelaId}/carta-pdf`, {
    params: { desde, hasta },
    responseType: 'blob',
  })
  return data
}

// ── Enlace público (Fase 3: QR sin login) ────────────────────────────────────

export interface EnlacePublicoResponse {
  id: string
  parcela_id: string
  token: string
  desde: string
  hasta: string
  activo: boolean
  created_at: string
  revoked_at: string | null
}

export async function crearEnlacePublico(
  parcelaId: string, desde: string, hasta: string,
): Promise<EnlacePublicoResponse> {
  const { data } = await api.post(`/trazabilidad/parcela/${parcelaId}/enlaces`, { desde, hasta })
  return data
}

export async function listEnlacesPublicos(parcelaId: string): Promise<EnlacePublicoResponse[]> {
  const { data } = await api.get(`/trazabilidad/parcela/${parcelaId}/enlaces`)
  return data
}

export async function revocarEnlacePublico(enlaceId: string): Promise<EnlacePublicoResponse> {
  const { data } = await api.post(`/trazabilidad/enlaces/${enlaceId}/revocar`)
  return data
}

// ── Vista pública (schema curado por el backend, sin responsable/comprador) ───

export interface FitosanitarioPublicoItem {
  fecha: string
  producto_nombre: string
  dosis_lt_ha: number
  dias_carencia: number
  fecha_habilitacion_cosecha: string
  dias_reingreso: number
  fecha_habilitacion_reingreso: string
  estado_compliance: ComplianceEstado
}

export interface FotoPublicaItem {
  url: string
  categoria: string
  fecha: string
  descripcion: string | null
}

export interface AnalisisPublicoItem {
  fecha: string
  origen: OrigenAnalisis
  brix: number | null
  acidez: number | null
  ph: number | null
  estado_sanitario: EstadoSanitarioAnalisis | null
  laboratorio_nombre: string | null
  informe_url: string | null
}

export interface ResumenPublicoItem {
  kg_total: number
  meta_produccion_kg: number | null
  pct_meta_produccion: number | null
  mm_riego_total: number
  mm_objetivo_anual: number
  pct_objetivo_riego: number | null
  horas_de_frio: number | null
  fitos_cumplidos: number
  fitos_pendientes: number
  fitos_incumplidos: number
}

export interface EmpresaItem {
  razon_social: string
  cuit: string
  domicilio: string
}

export interface HistorialPublicoResponse {
  parcela_nombre: string
  parcela_tipo: string
  parcela_variedad: string | null
  parcela_variedad_descripcion: string | null
  parcela_superficie_ha: number | null
  parcela_finca: string | null
  parcela_tipo_riego: string | null
  parcela_cobertura_invierno: string | null
  parcela_centroide: CentroideItem | null
  desde: string
  hasta: string
  resumen: ResumenPublicoItem
  fitosanitarios: FitosanitarioPublicoItem[]
  cumplimiento_riego_por_estado: CumplimientoEstadoItem[]
  resumen_destino: ResumenDestinoItem[]
  tareas_resumen: TareaResumenItem[]
  fotos: FotoPublicaItem[]
  analisis_calidad: AnalisisPublicoItem[]
  empresa: EmpresaItem
}

export async function getHistorialPublico(token: string): Promise<HistorialPublicoResponse> {
  const { data } = await api.get(`/trazabilidad/publica/${token}`)
  return data
}

export async function downloadCartaPdfPublica(token: string): Promise<Blob> {
  const { data } = await api.get(`/trazabilidad/publica/${token}/pdf`, { responseType: 'blob' })
  return data
}
