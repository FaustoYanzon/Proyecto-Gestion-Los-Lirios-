export type UserRole = 'super_admin' | 'gerencial' | 'encargado' | 'regador' | 'obrero'

export interface User {
  id: string
  email: string
  full_name: string
  role: UserRole
  is_active: boolean
}

export type TipoParcela = 'parral' | 'potrero' | 'pasero' | 'cabezal'
export type VariedadUva = 'flame' | 'red_globe' | 'fiesta' | 'bonarda' | 'sultanina' | 'syrah' | 'aspirant' | 'alfalfa' | 'otro'
export type UnidadMedida = 'dias' | 'plantas' | 'melgas' | 'metros' | 'vines' | 'cajas' | 'gamelas' | 'otros'
export type EstadoFenologico = 'brotacion' | 'floracion' | 'cuaje' | 'envero' | 'madurez' | 'cosecha' | 'latencia'

export interface Parcela {
  id: string
  nombre: string
  tipo: TipoParcela
  variedad: VariedadUva | null
  superficie_ha: number | null
  cabezal_riego: string | null
  coordenadas: [number, number][] | null
  is_active: boolean
}

export interface RegistroTrabajo {
  id: string
  fecha: string
  parcela_id: string | null
  trabajador_nombre: string
  tarea: string
  clasificacion: string
  cantidad: string
  unidad_medida: UnidadMedida
  precio_unitario: string
  monto_total: string
  detalle: string | null
  created_at: string
}

export interface TrabajadorItem {
  trabajador_nombre: string
  cantidad: number
}

export interface CargaMasivaPayload {
  fecha: string
  parcela_id: string | null
  tarea: string
  unidad_medida: UnidadMedida
  precio_unitario: number
  detalle?: string
  trabajadores: TrabajadorItem[]
}

export interface RegistroRiego {
  id: string
  fecha: string
  parcela_id: string
  cabezal: string
  valvula: string
  inicio: string
  fin: string
  duracion_horas: number
  mm_aplicados: number | null
  fertilizante_nombre: string | null
  fertilizante_dosis_lt_ha: number | null
  responsable: string
  created_at: string
}

export interface RiegoPayload {
  fecha: string
  parcela_id: string
  cabezal: string
  valvula: string
  inicio: string
  fin: string
  mm_aplicados?: number
  fertilizante_nombre?: string
  fertilizante_dosis_lt_ha?: number
  responsable: string
}

export interface CicloFenologico {
  id: string
  parcela_id: string
  fecha: string
  estado_fenologico: EstadoFenologico
  observaciones: string | null
}

export const CLASIFICACION_POR_TAREA: Record<string, string> = {
  'Cosecha': 'verano',
  'Tractor Cosecha': 'verano',
  'Pasero': 'verano',
  'Levantar Pasa': 'verano',
  'Control Cosecha': 'verano',
  'Amontonar Pasa': 'verano',
  'Poda': 'invierno',
  'Atada': 'invierno',
  'Tejido': 'invierno',
  'Verde': 'primavera',
  'Brote': 'primavera',
  'Raleo': 'primavera',
  'Polainas': 'primavera',
  'Descole': 'primavera',
  'Murones': 'otono',
  'Jornal Comun': 'general',
  'Tractor Comun': 'general',
  'Riego': 'general',
  'Mochila': 'general',
  'Limpieza Acequia': 'general',
  'Rastrillar Pasto': 'general',
  'Anchada': 'general',
  'Zanjeo': 'general',
}

export const TAREAS_POR_TEMPORADA = [
  { temporada: 'Verano', tareas: ['Cosecha', 'Tractor Cosecha', 'Pasero', 'Levantar Pasa', 'Control Cosecha', 'Amontonar Pasa'] },
  { temporada: 'Invierno', tareas: ['Poda', 'Atada', 'Tejido'] },
  { temporada: 'Primavera', tareas: ['Verde', 'Brote', 'Raleo', 'Polainas', 'Descole'] },
  { temporada: 'Otoño', tareas: ['Murones'] },
  { temporada: 'General', tareas: ['Jornal Comun', 'Tractor Comun', 'Riego', 'Mochila', 'Limpieza Acequia', 'Rastrillar Pasto', 'Anchada', 'Zanjeo'] },
] as const

export const UNIDAD_LABELS: Record<UnidadMedida, string> = {
  dias: 'Días',
  plantas: 'Plantas',
  melgas: 'Melgas',
  metros: 'Metros',
  vines: 'Vines',
  cajas: 'Cajas',
  gamelas: 'Gamelas',
  otros: 'Otros',
}

export const ESTADO_LABELS: Record<EstadoFenologico, string> = {
  brotacion: 'Brotación',
  floracion: 'Floración',
  cuaje: 'Cuaje',
  envero: 'Envero',
  madurez: 'Madurez',
  cosecha: 'Cosecha',
  latencia: 'Latencia',
}

export const ESTADO_COLORS: Record<EstadoFenologico, string> = {
  brotacion: '#eab308',
  floracion: '#ec4899',
  cuaje: '#f97316',
  envero: '#a855f7',
  madurez: '#22c55e',
  cosecha: '#ef4444',
  latencia: '#6b7280',
}

export const CABEZAL_VALVULAS: Record<string, { descripcion: string; valvulas: string[] }> = {
  '1': { descripcion: 'Parrales 2,4,5,9,Sult.', valvulas: ['1', '2', '3', '4'] },
  '2': { descripcion: 'Parrales 6,7,10,11', valvulas: ['1', '2', '3', '4'] },
  '3': { descripcion: 'Parrales 12,13,14,15,16,21', valvulas: ['1', '2', '3', '4'] },
  '4': { descripcion: 'Parrales 8,BV,BN,SYR-RG', valvulas: ['1', '2', '3'] },
}

export const VALVULAS_POR_PARCELA: Record<string, number> = {
  'Parral Sult.':       4,
  'Parral 9':           2,
  'Parral 4':           2,
  'Parral 5':           2,
  'Parral 2':           2,
  'Parral 10':          3,
  'Parral 6':           4,
  'Parral 11':          4,
  'Parral 7':           4,
  'Parral 16':          2,
  'Parral 13':          3,
  'Parral 15':          2,
  'Parral 14':          3,
  'Parral 21':          4,
  'Parral 12':          3,
  'Parral 8':           3,
  'Parral SYR-RG':      3,
  'Parral Bond. Viejo': 2,
  'Parral Bond. Nuevo': 2,
}

export function getValvulasForParcela(parcelaNombre: string): string[] {
  const max = VALVULAS_POR_PARCELA[parcelaNombre] ?? 4
  return Array.from({ length: max }, (_, i) => String(i + 1))
}

export const MM_POR_HORA = 1.6

export function calcMmRiego(inicioISO: string, finISO: string): number | null {
  const start = new Date(inicioISO)
  const end = new Date(finISO)
  const horas = (end.getTime() - start.getTime()) / 3600000
  if (horas <= 0) return null
  return Math.round(horas * MM_POR_HORA * 100) / 100
}
