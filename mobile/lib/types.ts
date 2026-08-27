import type { FincaKey } from '../store/fincaStore'

export type UserRole = 'super_admin' | 'gerencial' | 'encargado' | 'regador' | 'obrero'

export interface User {
  id: string
  email: string
  username: string
  full_name: string
  role: UserRole
  finca: FincaKey
  is_active: boolean
  avatar_url: string | null
  birth_day: number | null
  birth_month: number | null
  birth_year: number | null
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
  trabajador_id: string | null
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
  trabajador_id?: string
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

// Trabajador (catálogo real, GET/POST /trabajadores/) — distinto de
// TrabajadorItem arriba, que es solo el par nombre+cantidad de una carga.
export type RolTrabajador = 'obrero' | 'tractorista' | 'encargado_cuadrilla' | 'otro'

export interface Trabajador {
  id: string
  nombre_completo: string
  dni: string | null
  rol: RolTrabajador
  telefono: string | null
  is_active: boolean
}

export interface RegistroFitosanitario {
  id: string
  fecha: string
  parcela_id: string
  producto_nombre: string
  dosis_lt_ha: number
  motivo: string
  dias_carencia: number
  dias_reingreso: number
  responsable: string
  responsable_id: string | null
  fecha_habilitacion_cosecha: string
  fecha_habilitacion_reingreso: string
  created_at: string
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
  responsable_id: string | null
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
  responsable_id?: string
}

// Riego "en curso": arrancó (inicio) pero todavía no se cerró (sin fin).
export interface RiegoIniciarPayload {
  parcela_id: string
  cabezal: string
  valvula: string
  responsable: string
  responsable_id?: string
  fertilizante_nombre?: string
  fertilizante_dosis_lt_ha?: number
  idempotency_key?: string
}

export interface RiegoEnCurso {
  id: string
  fecha: string
  parcela_id: string
  cabezal: string
  valvula: string
  inicio: string
  n_valvulas: number
  responsable: string
  responsable_id: string | null
  fertilizante_nombre: string | null
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
  'Arreglo Parral': 'general',
  'Arreglo Riego': 'general',
}

export const TAREAS_POR_TEMPORADA = [
  { temporada: 'Verano', tareas: ['Cosecha', 'Tractor Cosecha', 'Pasero', 'Levantar Pasa', 'Control Cosecha', 'Amontonar Pasa'] },
  { temporada: 'Invierno', tareas: ['Poda', 'Atada', 'Tejido'] },
  { temporada: 'Primavera', tareas: ['Verde', 'Brote', 'Raleo', 'Polainas', 'Descole'] },
  { temporada: 'Otoño', tareas: ['Murones'] },
  { temporada: 'General', tareas: ['Jornal Comun', 'Tractor Comun', 'Riego', 'Mochila', 'Limpieza Acequia', 'Rastrillar Pasto', 'Anchada', 'Zanjeo', 'Arreglo Parral', 'Arreglo Riego'] },
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

// Maestro de precios por tarea (Documentación > Precios en la web) -- ver
// backend/app/models/precio_tarea.py. parcela_id null = precio general,
// fallback cuando no hay una regla específica para el parral elegido.
export interface PrecioTarea {
  id: string
  temporada: number
  tarea: string
  parcela_id: string | null
  parcela_nombre: string | null
  unidad_medida: UnidadMedida
  precio_unitario: number
}

// "2026-08-25" -> 2026 (año de inicio de campaña, mayo->abril -- mismo
// criterio que ya usa RegistroCosecha en el backend).
export function temporadaDeFecha(fechaISO: string): number {
  const [anioStr, mesStr] = fechaISO.split('-')
  const anio = Number(anioStr)
  const mes = Number(mesStr)
  return mes >= 5 ? anio : anio - 1
}

export function buscarPrecio(
  precios: PrecioTarea[],
  { tarea, parcelaId, unidadMedida }: { tarea: string; parcelaId: string | null; unidadMedida: UnidadMedida }
): PrecioTarea | null {
  if (parcelaId) {
    const especifico = precios.find(
      (p) => p.tarea === tarea && p.parcela_id === parcelaId && p.unidad_medida === unidadMedida
    )
    if (especifico) return especifico
  }
  const general = precios.find(
    (p) => p.tarea === tarea && p.parcela_id == null && p.unidad_medida === unidadMedida
  )
  return general ?? null
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

// ── Ciclo de Campaña (calendario único, GET /produccion/estado-campana/*) ──
// Sistema aparte de EstadoFenologico de arriba, que sigue alimentando
// "Tareas recomendadas" de Inicio sin cambios. Acá el estado es el mismo
// para todas las variedades (calendario fijo), con override manual por
// variedad entera.
export type EstadoCampana =
  | 'brotacion' | 'floracion' | 'cuaje' | 'cierre_racimo'
  | 'envero' | 'cosecha' | 'post_cosecha'

export const ESTADO_CAMPANA_LABELS: Record<EstadoCampana, string> = {
  brotacion: 'Brotación',
  floracion: 'Floración',
  cuaje: 'Cuaje',
  cierre_racimo: 'Cierre de Racimo',
  envero: 'Envero',
  cosecha: 'Cosecha',
  post_cosecha: 'Post-Cosecha',
}

export const ESTADO_CAMPANA_COLORES: Record<EstadoCampana, string> = {
  brotacion: '#eab308',
  floracion: '#ec4899',
  cuaje: '#f97316',
  cierre_racimo: '#0ea5e9',
  envero: '#a855f7',
  cosecha: '#ef4444',
  post_cosecha: '#6b7280',
}

export interface EstadoActualVariedad {
  variedad: VariedadUva
  estado_campana: EstadoCampana
  estado_campana_label: string
  fecha_inicio: string
  riegos_esperados: number
  fuente: 'automatico' | 'manual'
  fecha_confirmacion: string | null
  observaciones: string | null
  proxima_estado_campana: EstadoCampana
  proxima_fecha: string
  parcelas: string[]
}

export interface CumplimientoRiegoParcela {
  parcela_id: string
  parcela_nombre: string
  variedad: VariedadUva | null
  estado_campana: EstadoCampana
  estado_campana_label: string
  riegos_esperados: number
  mm_aplicados: number
  riegos_equivalentes: number
  cumplimiento_pct: number
}

export interface EstadoVariedadCampanaPayload {
  variedad: VariedadUva
  anio: number
  estado_campana: EstadoCampana
  fecha_confirmacion: string
  observaciones?: string | null
}

// Catálogo real de válvulas, poblado en el backend desde Valvulas.geojson
// (ver backend/app/models/valvula.py, scripts/seed_valvulas.py). El cabezal
// es un atributo de la válvula, no de la parcela — una misma parcela puede
// tener válvulas alimentadas por cabezales distintos (caso real: Parral 2).
export interface ValvulaReal {
  id: string
  nombre: string
  parcela_id: string
  cabezal: number
  orden: number | null
  lat: number
  lon: number
}

// Cada válvula riega 1 ha: 16.000 L/h => 1.6 mm/h sobre esa ha.
export const MM_POR_HORA = 1.6
export const LITROS_POR_HORA_VALVULA = 16_000
// Referencia agronómica para el suelo de Media Agua: 6.000.000 L/ha/año.
export const LITROS_OBJETIVO_ANUAL_POR_HA = 6_000_000
// 1mm sobre 1ha = 10.000 L — el objetivo en mm no depende de la superficie
// de la parcela (a diferencia del objetivo en litros, que sí escala con ha).
export const MM_OBJETIVO_ANUAL_POR_HA = LITROS_OBJETIVO_ANUAL_POR_HA / 10_000

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
  idempotency_key?: string
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
