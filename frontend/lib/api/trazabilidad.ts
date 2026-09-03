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
