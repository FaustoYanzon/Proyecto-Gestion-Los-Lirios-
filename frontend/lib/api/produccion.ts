import api from '@/lib/api'

// ── Constants ────────────────────────────────────────────────────────────────

export const TAREAS_POR_TEMPORADA: Record<string, string[]> = {
  verano:    ['Cosecha', 'Tractor Cosecha', 'Pasero', 'Levantar Pasa', 'Control Cosecha', 'Amontonar Pasa', 'Otros'],
  invierno:  ['Poda', 'Atada', 'Tejido', 'Otros'],
  primavera: ['Verde', 'Brote', 'Raleo', 'Polainas', 'Descole', 'Otros'],
  otono:     ['Murones', 'Otros'],
  general:   ['Jornal Comun', 'Tractor Comun', 'Riego', 'Mochila', 'Limpieza Acequia', 'Rastrillar Pasto', 'Anchada', 'Zanjeo', 'Otros'],
}

export const CLASIFICACION_POR_TAREA: Record<string, string> = {
  Cosecha: 'verano', 'Tractor Cosecha': 'verano', Pasero: 'verano',
  'Levantar Pasa': 'verano', 'Control Cosecha': 'verano', 'Amontonar Pasa': 'verano',
  Poda: 'invierno', Atada: 'invierno', Tejido: 'invierno',
  Verde: 'primavera', Brote: 'primavera', Raleo: 'primavera',
  Polainas: 'primavera', Descole: 'primavera',
  Murones: 'otono',
  'Jornal Comun': 'general', 'Tractor Comun': 'general', Riego: 'general',
  Mochila: 'general', 'Limpieza Acequia': 'general', 'Rastrillar Pasto': 'general',
  Anchada: 'general', Zanjeo: 'general',
}

export const TEMPORADA_LABELS: Record<string, string> = {
  verano: 'Verano', invierno: 'Invierno', primavera: 'Primavera',
  otono: 'Otoño', general: 'General',
}

export const UNIDAD_VALUES = ['dias', 'plantas', 'melgas', 'metros', 'vines', 'cajas', 'gamelas', 'otros'] as const
export type UnidadMedida = (typeof UNIDAD_VALUES)[number]

export const UNIDAD_LABELS: Record<UnidadMedida, string> = {
  dias: 'Días', plantas: 'Plantas', melgas: 'Melgas', metros: 'Metros',
  vines: 'Vines', cajas: 'Cajas', gamelas: 'Gamelas', otros: 'Otros',
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface TrabajadorItem {
  trabajador_nombre: string
  cantidad: number
}

export interface RegistroCargaMasiva {
  fecha: string
  parcela_id?: string
  tarea: string
  unidad_medida: UnidadMedida
  precio_unitario: number
  detalle?: string
  trabajadores: TrabajadorItem[]
}

export interface RegistroTrabajoCreate {
  fecha: string
  parcela_id?: string
  trabajador_nombre: string
  tarea: string
  cantidad: number
  unidad_medida: UnidadMedida
  precio_unitario: number
  detalle?: string
}

export interface RegistroTrabajoUpdate {
  fecha?: string
  parcela_id?: string
  trabajador_nombre?: string
  tarea?: string
  cantidad?: number
  unidad_medida?: UnidadMedida
  precio_unitario?: number
  detalle?: string
}

export interface RegistroTrabajoResponse {
  id: string
  fecha: string
  parcela_id: string | null
  trabajador_nombre: string
  clasificacion: string
  tarea: string
  cantidad: number
  unidad_medida: UnidadMedida
  precio_unitario: number
  monto_total: number
  detalle: string | null
  created_by: string
  created_at: string
}

export interface TrabajoFilter {
  fecha_desde?: string
  fecha_hasta?: string
  parcela_id?: string
  trabajador_nombre?: string
  tarea?: string
  clasificacion?: string
  skip?: number
  limit?: number
}

// ── API calls ────────────────────────────────────────────────────────────────

export async function getTrabajos(params: TrabajoFilter): Promise<RegistroTrabajoResponse[]> {
  const { data } = await api.get('/produccion/trabajo/', { params })
  return data
}

export async function createTrabajoMasivo(data: RegistroCargaMasiva): Promise<RegistroTrabajoResponse[]> {
  const { data: res } = await api.post('/produccion/trabajo/masivo', data)
  return res
}

export async function updateTrabajo(id: string, data: RegistroTrabajoUpdate): Promise<RegistroTrabajoResponse> {
  const { data: res } = await api.put(`/produccion/trabajo/${id}`, data)
  return res
}

export async function deleteTrabajo(id: string): Promise<void> {
  await api.delete(`/produccion/trabajo/${id}`)
}

// ── Parcelas (lightweight list for dropdowns) ─────────────────────────────────

export interface ParcelaItem {
  id: string
  nombre: string
  tipo: string
  variedad: string | null
  cabezal_riego: string | null
  superficie_ha: number | null
  is_active: boolean
}

export const VARIEDAD_LABELS: Record<string, string> = {
  flame: 'Flame', red_globe: 'Red Globe', fiesta: 'Fiesta', bonarda: 'Bonarda',
  sultanina: 'Sultanina', syrah: 'Syrah', aspirant: 'Aspirant', alfalfa: 'Alfalfa', otro: 'Otro',
}

export interface CicloCampanaItem {
  id: string
  parcela_id: string
  anio: number
  estado_fenologico: string
  fecha_estado: string
  rendimiento_kg_ha: number | null
  observaciones: string | null
}

export interface EstadoActualItem {
  id: string
  parcela_id: string
  parcela_nombre: string
  anio: number
  estado_fenologico: string
  fecha_estado: string
}

export interface ResumenTrabajadorItem {
  trabajador_nombre: string
  total_jornales: number
  monto_total: number
  tareas_realizadas: string[]
}

export interface ResumenTareaItem {
  tarea: string
  clasificacion: string
  total_registros: number
  cantidad_total: number
  monto_total: number
}

export async function getCiclosCampana(params?: { parcela_id?: string; anio?: number }): Promise<CicloCampanaItem[]> {
  const { data } = await api.get('/produccion/campana/', { params })
  return data
}

export async function getEstadoActual(): Promise<EstadoActualItem[]> {
  const { data } = await api.get('/produccion/campana/estado-actual/')
  return data
}

export async function getResumenPorTrabajador(params?: { fecha_desde?: string; fecha_hasta?: string; parcela_id?: string }): Promise<ResumenTrabajadorItem[]> {
  const { data } = await api.get('/produccion/trabajo/resumen/por-trabajador', { params })
  return data
}

export async function getResumenPorTarea(params?: { fecha_desde?: string; fecha_hasta?: string }): Promise<ResumenTareaItem[]> {
  const { data } = await api.get('/produccion/trabajo/resumen/por-tarea', { params })
  return data
}

export async function getParcelas(): Promise<ParcelaItem[]> {
  const { data } = await api.get('/parcelas/')
  return data
}

export async function getParcelasMapa(): Promise<ParcelaItem[]> {
  const { data } = await api.get('/parcelas/mapa')
  return data
}

export function formatParcelaLabel(nombre: string): string {
  return nombre
    .replace(/^Parral\s+/i, 'P. ')
    .replace(/^Potrero\s+/i, 'P. ')
}
