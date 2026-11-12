// Maquinaria API client and pure helpers for the Expo mobile app.
// Reduced mirror of frontend/lib/api/maquinaria.ts: only the endpoints and
// helpers used in the field. Backend Decimal fields arrive as strings in JSON
// and are converted to number here at the API boundary.

import api from './api'
import { newIdempotencyKey } from './idempotency'
import type { UserRole } from './types'

const num = (v: unknown): number => Number(v)

function toNumberOrNull(value: string | number | null | undefined): number | null {
  return value === null || value === undefined ? null : num(value)
}

// ─── Enums and Spanish UI labels (mirror backend/app/models/maquinaria.py) ────

export const TIPO_MAQUINA_VALUES = ['tractor', 'cosechadora', 'enfardadora', 'implemento'] as const
export type TipoMaquina = (typeof TIPO_MAQUINA_VALUES)[number]

export const TIPO_MAQUINA_LABELS: Record<TipoMaquina, string> = {
  tractor: 'Tractor',
  cosechadora: 'Cosechadora',
  enfardadora: 'Enfardadora',
  implemento: 'Implemento',
}

export const ESTADO_MAQUINA_VALUES = [
  'operativa',
  'operativa_con_observaciones',
  'parada',
  'en_taller',
] as const
export type EstadoMaquina = (typeof ESTADO_MAQUINA_VALUES)[number]

export const ESTADO_MAQUINA_LABELS: Record<EstadoMaquina, string> = {
  operativa: 'Operativa',
  operativa_con_observaciones: 'Con observaciones',
  parada: 'Parada',
  en_taller: 'En taller',
}

export type Semaforo = 'verde' | 'amarillo' | 'rojo' | 'azul'

export const ESTADO_MAQUINA_SEMAFORO: Record<EstadoMaquina, Semaforo> = {
  operativa: 'verde',
  operativa_con_observaciones: 'amarillo',
  parada: 'rojo',
  en_taller: 'azul',
}

export const GRAVEDAD_FALLA_VALUES = ['sigue_trabajando', 'parada'] as const
export type GravedadFalla = (typeof GRAVEDAD_FALLA_VALUES)[number]

export const GRAVEDAD_FALLA_LABELS: Record<GravedadFalla, string> = {
  sigue_trabajando: 'Sigue trabajando',
  parada: 'Parada',
}

export const ESTADO_ORDEN_VALUES = [
  'reportada',
  'diagnosticada',
  'presupuesto_pendiente',
  'presupuesto_aprobado',
  'enviada_taller',
  'en_reparacion',
  'lista_retirar',
  'pendiente_validacion',
  'cerrada',
  'cancelada',
] as const
export type EstadoOrden = (typeof ESTADO_ORDEN_VALUES)[number]

export const ESTADO_ORDEN_LABELS: Record<EstadoOrden, string> = {
  reportada: 'Reportada',
  diagnosticada: 'Diagnosticada',
  presupuesto_pendiente: 'Presupuesto pendiente',
  presupuesto_aprobado: 'Presupuesto aprobado',
  enviada_taller: 'Enviada al taller',
  en_reparacion: 'En reparación',
  lista_retirar: 'Lista para retirar',
  pendiente_validacion: 'Pendiente de validación',
  cerrada: 'Cerrada',
  cancelada: 'Cancelada',
}

export const ESTADO_PRESUPUESTO_VALUES = ['pendiente', 'aprobado', 'rechazado'] as const
export type EstadoPresupuesto = (typeof ESTADO_PRESUPUESTO_VALUES)[number]

export const ESTADO_PRESUPUESTO_LABELS: Record<EstadoPresupuesto, string> = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
}

export type FincaMaquinaria = 'los_mimbres' | 'media_agua' | 'caucete'

export const FINCA_LABELS: Record<FincaMaquinaria, string> = {
  los_mimbres: 'Los Mimbres',
  media_agua: 'Media Agua',
  caucete: 'Caucete',
}

// ─── Types (mirror backend/app/schemas/maquinaria.py) ─────────────────────────
// Decimal fields are converted to number; money fields are number | null
// because the backend nulls them out for roles below gerencial.

export interface MaquinaResponse {
  id: string
  tipo: TipoMaquina
  marca: string
  modelo: string
  anio: number | null
  patente_serie: string | null
  horas_motor: number | null
  finca: FincaMaquinaria
  tractor_id: string | null
  foto_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  // Derived from open orders, never stored.
  estado: EstadoMaquina
  semaforo: Semaforo
  ordenes_abiertas: number
}

export type Maquina = MaquinaResponse

export interface MaquinasFilter {
  finca?: FincaMaquinaria
  tipo?: TipoMaquina
  estado?: EstadoMaquina
  incluir_inactivas?: boolean
}

export interface MaquinaResumen {
  id: string
  tipo: TipoMaquina
  marca: string
  modelo: string
  patente_serie: string | null
  finca: FincaMaquinaria
}

export interface OrdenResponse {
  id: string
  maquina_id: string
  maquina: MaquinaResumen
  finca: FincaMaquinaria
  reportada_por: string
  descripcion: string
  gravedad: GravedadFalla
  estado: EstadoOrden
  taller: string | null
  fecha_estimada_entrega: string | null
  created_at: string
  updated_at: string
}

export type Orden = OrdenResponse

export interface FotoOrdenResponse {
  id: string
  url: string
  subida_por: string
  created_at: string
}

export type FotoOrden = FotoOrdenResponse

export interface PresupuestoResponse {
  id: string
  orden_id: string
  taller: string
  monto: number | null
  detalle: string | null
  adjunto_url: string | null
  estado: EstadoPresupuesto
  motivo_rechazo: string | null
  created_by: string
  resuelto_por: string | null
  resuelto_at: string | null
  created_at: string
}

export type Presupuesto = PresupuestoResponse

export interface PagoResponse {
  id: string
  orden_id: string
  monto_real: number | null
  factura_url: string | null
  fecha: string
  registrado_por: string
  egreso_id: string | null
  created_at: string
}

export type Pago = PagoResponse

export interface EventoResponse {
  id: string
  estado_desde: EstadoOrden | null
  estado_hasta: EstadoOrden
  usuario_id: string
  usuario_nombre: string | null
  nota: string | null
  created_at: string
}

export type EventoOrden = EventoResponse

export interface OrdenDetalleResponse extends OrdenResponse {
  fotos: FotoOrdenResponse[]
  presupuestos: PresupuestoResponse[]
  pago: PagoResponse | null
  eventos: EventoResponse[]
}

export type OrdenDetalle = OrdenDetalleResponse

export interface OrdenesFilter {
  estado?: EstadoOrden
  maquina_id?: string
  finca?: FincaMaquinaria
  abiertas?: boolean
  limit?: number
  offset?: number
}

export interface OrdenCreate {
  maquina_id: string
  descripcion: string
  gravedad: GravedadFalla
  // Max 36 chars; deduplicates retried/offline submissions on the backend.
  idempotency_key: string
}

export interface TransicionRequest {
  a_estado: EstadoOrden
  nota?: string
}

export interface PresupuestoResolver {
  aprobar: boolean
  motivo?: string
}

// ─── Wire shapes and normalizers ──────────────────────────────────────────────

type Wire<T, K extends keyof T> = Omit<T, K> & { [P in K]: string | null }
type MaquinaWire = Wire<MaquinaResponse, 'horas_motor'>
type PresupuestoWire = Wire<PresupuestoResponse, 'monto'>
type PagoWire = Wire<PagoResponse, 'monto_real'>
type OrdenDetalleWire = Omit<OrdenDetalleResponse, 'presupuestos' | 'pago'> & {
  presupuestos: PresupuestoWire[]
  pago: PagoWire | null
}

function normalizeMaquina(raw: MaquinaWire): MaquinaResponse {
  return { ...raw, horas_motor: toNumberOrNull(raw.horas_motor) }
}

function normalizePresupuesto(raw: PresupuestoWire): PresupuestoResponse {
  return { ...raw, monto: toNumberOrNull(raw.monto) }
}

function normalizePago(raw: PagoWire): PagoResponse {
  return { ...raw, monto_real: toNumberOrNull(raw.monto_real) }
}

function normalizeOrdenDetalle(raw: OrdenDetalleWire): OrdenDetalleResponse {
  return {
    ...raw,
    presupuestos: raw.presupuestos.map(normalizePresupuesto),
    pago: raw.pago ? normalizePago(raw.pago) : null,
  }
}

// ─── Error helper ─────────────────────────────────────────────────────────────

// Extracts a readable Spanish message from an Axios error response.
export function errorDetail(e: unknown, fallback = 'No se pudo completar la operación'): string {
  const err = e as { response?: { data?: { detail?: unknown } } }
  if (!err?.response) {
    return 'Sin conexión con el servidor. Reintentá cuando tengas señal.'
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

// ─── Role, action, and fleet summary helpers ──────────────────────────────────

// Same rule as backend require_encargado_estricto: regador/obrero have no access.
export function puedeVerMaquinaria(role: UserRole | string | null | undefined): boolean {
  return role === 'encargado' || role === 'gerencial' || role === 'super_admin'
}

export function esGerencialUp(role: UserRole | string | null | undefined): boolean {
  return role === 'gerencial' || role === 'super_admin'
}

// Actions exposed by the mobile app. The backend state machine
// (backend/app/services/maquinaria.py TRANSICIONES) is the source of truth.
export type AccionMobile =
  | 'aprobar_rechazar_presupuesto'
  | 'confirmar_recepcion'
  | 'reabrir'

export function accionesMobile(
  role: UserRole | string | null | undefined,
  estado: EstadoOrden,
): AccionMobile[] {
  if (estado === 'presupuesto_pendiente' && esGerencialUp(role)) {
    return ['aprobar_rechazar_presupuesto']
  }
  if (estado === 'pendiente_validacion' && puedeVerMaquinaria(role)) {
    return ['confirmar_recepcion', 'reabrir']
  }
  return []
}

export interface MaquinaAveriada {
  id: string
  tipo: TipoMaquina
  marca: string
  modelo: string
  estado: 'parada' | 'en_taller'
  semaforo: Semaforo
  finca: FincaMaquinaria
}

export interface ResumenFlota {
  total: number
  operativa: number
  operativa_con_observaciones: number
  parada: number
  en_taller: number
  por_estado: Record<EstadoMaquina, number>
  averiadas: MaquinaAveriada[]
}

export function resumenFlota(maquinas: readonly MaquinaResponse[]): ResumenFlota {
  const por_estado: Record<EstadoMaquina, number> = {
    operativa: 0,
    operativa_con_observaciones: 0,
    parada: 0,
    en_taller: 0,
  }
  const averiadas: MaquinaAveriada[] = []

  for (const m of maquinas) {
    por_estado[m.estado] += 1
    if (m.estado === 'parada' || m.estado === 'en_taller') {
      averiadas.push({
        id: m.id,
        tipo: m.tipo,
        marca: m.marca,
        modelo: m.modelo,
        estado: m.estado,
        semaforo: m.semaforo,
        finca: m.finca,
      })
    }
  }

  return {
    total: maquinas.length,
    operativa: por_estado.operativa,
    operativa_con_observaciones: por_estado.operativa_con_observaciones,
    parada: por_estado.parada,
    en_taller: por_estado.en_taller,
    por_estado,
    averiadas,
  }
}

// ─── API functions ────────────────────────────────────────────────────────────

export async function listMaquinas(params: MaquinasFilter = {}): Promise<MaquinaResponse[]> {
  const { data } = await api.get<MaquinaWire[]>('/maquinaria/maquinas', { params })
  return data.map(normalizeMaquina)
}

export async function getMaquina(id: string): Promise<MaquinaResponse> {
  const { data } = await api.get<MaquinaWire>(`/maquinaria/maquinas/${id}`)
  return normalizeMaquina(data)
}

export async function listOrdenes(params: OrdenesFilter = {}): Promise<OrdenResponse[]> {
  const { data } = await api.get<OrdenResponse[]>('/maquinaria/ordenes', { params })
  return data
}

export async function getOrden(id: string): Promise<OrdenDetalleResponse> {
  const { data } = await api.get<OrdenDetalleWire>(`/maquinaria/ordenes/${id}`)
  return normalizeOrdenDetalle(data)
}

export interface ReporteFallaInput {
  maquina_id: string
  descripcion: string
  gravedad: GravedadFalla
  idempotency_key?: string
}

export interface OfflineReporteItem {
  endpoint: '/maquinaria/ordenes'
  payload: OrdenCreate
}

// Builds the `{ endpoint, payload }` envelope ready for `offlineQueue.enqueue(endpoint, payload)`
// or direct submission via `crearOrden(payload)`. The key is generated once here so a
// retried or replayed submission is deduplicated by the backend.
export function buildReportePayload(input: ReporteFallaInput): OfflineReporteItem {
  const key = (input.idempotency_key ?? newIdempotencyKey()).slice(0, 36)
  return {
    endpoint: '/maquinaria/ordenes',
    payload: {
      maquina_id: input.maquina_id,
      descripcion: input.descripcion,
      gravedad: input.gravedad,
      idempotency_key: key,
    },
  }
}

export async function crearOrden(payload: OrdenCreate): Promise<OrdenDetalleResponse> {
  const { data } = await api.post<OrdenDetalleWire>('/maquinaria/ordenes', payload)
  return normalizeOrdenDetalle(data)
}

export async function transicionarOrden(
  id: string,
  aEstado: EstadoOrden,
  nota?: string,
): Promise<OrdenDetalleResponse> {
  const body: TransicionRequest = { a_estado: aEstado, nota }
  const { data } = await api.post<OrdenDetalleWire>(`/maquinaria/ordenes/${id}/transicion`, body)
  return normalizeOrdenDetalle(data)
}

export async function resolverPresupuesto(
  presupuestoId: string,
  aprobar: boolean,
  motivo?: string,
): Promise<PresupuestoResponse> {
  const body: PresupuestoResolver = { aprobar, motivo }
  const { data } = await api.post<PresupuestoWire>(
    `/maquinaria/presupuestos/${presupuestoId}/resolver`,
    body,
  )
  return normalizePresupuesto(data)
}

export async function subirFotoOrden(ordenId: string, uri: string): Promise<FotoOrdenResponse> {
  const formData = new FormData()
  // Same React Native FormData file shape as subirFotoValvula in ./api (not a DOM File).
  formData.append('file', {
    uri,
    name: 'orden.jpg',
    type: 'image/jpeg',
  } as any)
  const { data } = await api.post<FotoOrdenResponse>(
    `/maquinaria/ordenes/${ordenId}/fotos`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data
}

export async function borrarFotoOrden(ordenId: string, fotoId: string): Promise<void> {
  await api.delete(`/maquinaria/ordenes/${ordenId}/fotos/${fotoId}`)
}
