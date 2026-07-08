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

export const VARIEDAD_LABELS: Record<string, string> = {
  flame: 'Flame', red_globe: 'Red Globe', fiesta: 'Fiesta', bonarda: 'Bonarda',
  sultanina: 'Sultanina', syrah: 'Syrah', aspirant: 'Aspirant', alfalfa: 'Alfalfa', otro: 'Otro',
}

// Fenología automática por variedad (GET /produccion/fenologia/estado-actual).
export interface FaseVariedad {
  variedad: string
  tipo_uso: string
  fase: string
  fase_label: string
  estado_fenologico: EstadoFenologico
  riesgo_oidio: string
  tareas_recomendadas: string[]
  proxima_fase: string | null
  proxima_fase_label: string | null
  proxima_fase_fecha: string | null
  parcelas: string[]
  fuente: 'automatico' | 'manual'
  fecha_confirmacion: string | null
}

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
  n_valvulas: number
  litros_aplicados: number
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

// Cada válvula riega 1 ha: 16.000 L/h => 1.6 mm/h sobre esa ha.
export const MM_POR_HORA = 1.6
export const LITROS_POR_HORA_VALVULA = 16_000
// Referencia agronómica para el suelo de Media Agua: 6.000.000 L/ha/año.
export const LITROS_OBJETIVO_ANUAL_POR_HA = 6_000_000

export function calcMmRiego(inicioISO: string, finISO: string): number | null {
  const start = new Date(inicioISO)
  const end = new Date(finISO)
  const horas = (end.getTime() - start.getTime()) / 3600000
  if (horas <= 0) return null
  return Math.round(horas * MM_POR_HORA * 100) / 100
}

export function calcRiegoTotales(
  inicioISO: string, finISO: string, nValvulas: number,
): { horas: number; mm: number; litros: number } | null {
  const start = new Date(inicioISO)
  const end = new Date(finISO)
  const horas = (end.getTime() - start.getTime()) / 3600000
  if (horas <= 0) return null
  const n = nValvulas > 0 ? nValvulas : 1
  return {
    horas: Math.round(horas * 100) / 100,
    mm: Math.round(horas * MM_POR_HORA * 100) / 100,
    litros: Math.round(horas * LITROS_POR_HORA_VALVULA * n),
  }
}

// ─── Cosecha ──────────────────────────────────────────────────────────────────

export type CultivoCosecha = 'vid' | 'chacra' | 'ind_pasa' | 'alfalfa' | 'otro'
export type DestinoCosecha = 'MI' | 'BODEGA' | 'EXPO' | 'PASAS' | 'RAMA_PASA' | 'SEMILLA' | 'DESC' | 'FARDO'
export type TipoEnvase = 'caja' | 'bin' | 'chasis' | 'ficha' | 'vin' | 'bolsa' | 'otro'

export interface RegistroCosecha {
  id: string
  temporada: number
  semana: number | null
  fecha: string
  parcela_id: string | null
  parcela_nombre: string | null
  cultivo: CultivoCosecha
  variedad: string | null
  n_remito: string | null
  n_ciu: string | null
  destino: DestinoCosecha
  comprador: string | null
  cuadrilla: string | null
  vehiculo_patente: string | null
  tipo_envase: TipoEnvase
  cantidad_envases: number | null
  peso_unitario_kg: number | null
  bruto_kg: number | null
  tara_kg: number | null
  kg_total: number
  observaciones: string | null
  created_at: string
}

export interface RegistroCosechaCreate {
  fecha: string
  parcela_id?: string | null
  cultivo?: CultivoCosecha
  variedad?: string | null
  n_remito?: string | null
  n_ciu?: string | null
  destino: DestinoCosecha
  comprador?: string | null
  cuadrilla?: string | null
  vehiculo_patente?: string | null
  tipo_envase?: TipoEnvase
  cantidad_envases?: number | null
  peso_unitario_kg?: number | null
  bruto_kg?: number | null
  tara_kg?: number | null
  kg_total: number
  observaciones?: string | null
}

export const DESTINO_LABELS: Record<DestinoCosecha, string> = {
  MI: 'Mercado Interno',
  BODEGA: 'Bodega',
  EXPO: 'Exportación',
  PASAS: 'Pasas',
  RAMA_PASA: 'Rama Pasa',
  SEMILLA: 'Semilla',
  DESC: 'Descarte',
  FARDO: 'Fardo',
}

export const CULTIVO_LABELS: Record<CultivoCosecha, string> = {
  vid: 'Vid',
  chacra: 'Chacra',
  ind_pasa: 'Ind. Pasa',
  alfalfa: 'Alfalfa',
  otro: 'Otro',
}

export const DESTINO_COLORS: Record<DestinoCosecha, string> = {
  MI: '#16a34a',
  BODEGA: '#2563eb',
  EXPO: '#7c3aed',
  PASAS: '#d97706',
  RAMA_PASA: '#b45309',
  SEMILLA: '#0891b2',
  DESC: '#dc2626',
  FARDO: '#4b5563',
}
