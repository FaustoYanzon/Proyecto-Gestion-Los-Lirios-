import api from '@/lib/api'

// ─── Enums (mirror backend/app/models/maquinaria.py and services/maquinaria.py) ──

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

export type EstadoPresupuesto = 'pendiente' | 'aprobado' | 'rechazado'

// Same values as the finanzas module (OrigenPago / FormaPago).
export type OrigenPago = 'oficial' | 'no_oficial'
export type FormaPago = 'efectivo' | 'transferencia' | 'cheque' | 'echeque' | 'credito'
export type FincaMaquinaria = 'los_mimbres' | 'media_agua' | 'caucete'

export const FINCA_LABELS: Record<FincaMaquinaria, string> = {
  los_mimbres: 'Los Mimbres',
  media_agua: 'Media Agua',
  caucete: 'Caucete',
}

// ─── Types ────────────────────────────────────────────────────────────────────
// Decimal fields arrive as strings; the functions below convert them with
// Number() so consumers only ever see numbers. Money fields are null for
// roles below gerencial.

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
  // Derived from the open orders, never stored.
  estado: EstadoMaquina
  semaforo: Semaforo
  ordenes_abiertas: number
}

export interface MaquinaCreate {
  tipo: TipoMaquina
  marca: string
  modelo: string
  anio?: number | null
  patente_serie?: string | null
  horas_motor?: number | null
  finca: FincaMaquinaria
  tractor_id?: string | null
  foto_url?: string | null
}

// PATCH uses exclude_unset: send only the changed fields (null clears the nullable ones).
export interface MaquinaUpdate extends Partial<MaquinaCreate> {
  is_active?: boolean
}

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

export interface FotoOrdenResponse {
  id: string
  url: string
  subida_por: string
  created_at: string
}

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

export interface EventoResponse {
  id: string
  estado_desde: EstadoOrden | null
  estado_hasta: EstadoOrden
  usuario_id: string
  nota: string | null
  created_at: string
}

export interface OrdenDetalleResponse extends OrdenResponse {
  fotos: FotoOrdenResponse[]
  presupuestos: PresupuestoResponse[]
  pago: PagoResponse | null
  eventos: EventoResponse[]
}

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
  // Same key on retries so the backend returns the already-created order.
  idempotency_key?: string
}

export interface OrdenUpdate {
  taller?: string | null
  fecha_estimada_entrega?: string | null
  descripcion?: string
  gravedad?: GravedadFalla
}

export interface TransicionRequest {
  a_estado: EstadoOrden
  nota?: string
}

export interface PresupuestoCreate {
  taller?: string
  monto: number
  detalle?: string
  // Must start with https://
  adjunto_url?: string
}

export interface PresupuestoResolver {
  aprobar: boolean
  motivo?: string
}

export interface PagoCreate {
  monto_real: number
  // Must start with https://
  factura_url?: string
  fecha?: string
  origen?: OrigenPago
  forma_pago?: FormaPago
}

export interface HistorialOrden {
  id: string
  estado: EstadoOrden
  gravedad: GravedadFalla
  descripcion: string
  taller: string | null
  created_at: string
  costo: number | null
  dias_fuera_servicio: number
}

export interface HistorialMaquinaResponse {
  maquina_id: string
  costo_total: number | null
  dias_fuera_servicio_total: number
  ordenes: HistorialOrden[]
}

// ─── Decimal normalizers (string -> number, null preserved) ────────────────────

function toNumberOrNull(value: string | number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value)
}

// Raw wire shapes: same as the public types but with Decimal fields as strings.
type Wire<T, K extends keyof T> = Omit<T, K> & { [P in K]: string | null }
type MaquinaWire = Wire<MaquinaResponse, 'horas_motor'>
type PresupuestoWire = Wire<PresupuestoResponse, 'monto'>
type PagoWire = Wire<PagoResponse, 'monto_real'>
type OrdenDetalleWire = Omit<OrdenDetalleResponse, 'presupuestos' | 'pago'> & {
  presupuestos: PresupuestoWire[]
  pago: PagoWire | null
}
type HistorialOrdenWire = Omit<HistorialOrden, 'costo' | 'dias_fuera_servicio'> & {
  costo: string | null
  dias_fuera_servicio: string
}
type HistorialWire = Omit<HistorialMaquinaResponse, 'costo_total' | 'dias_fuera_servicio_total' | 'ordenes'> & {
  costo_total: string | null
  dias_fuera_servicio_total: string
  ordenes: HistorialOrdenWire[]
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

function normalizeHistorial(raw: HistorialWire): HistorialMaquinaResponse {
  return {
    ...raw,
    costo_total: toNumberOrNull(raw.costo_total),
    dias_fuera_servicio_total: Number(raw.dias_fuera_servicio_total),
    ordenes: raw.ordenes.map((o) => ({
      ...o,
      costo: toNumberOrNull(o.costo),
      dias_fuera_servicio: Number(o.dias_fuera_servicio),
    })),
  }
}

// ─── Máquinas ─────────────────────────────────────────────────────────────────

export async function getMaquinas(filter: MaquinasFilter = {}): Promise<MaquinaResponse[]> {
  const { data } = await api.get<MaquinaWire[]>('/maquinaria/maquinas', { params: filter })
  return data.map(normalizeMaquina)
}

export async function getMaquina(id: string): Promise<MaquinaResponse> {
  const { data } = await api.get<MaquinaWire>(`/maquinaria/maquinas/${id}`)
  return normalizeMaquina(data)
}

export async function createMaquina(payload: MaquinaCreate): Promise<MaquinaResponse> {
  const { data } = await api.post<MaquinaWire>('/maquinaria/maquinas', payload)
  return normalizeMaquina(data)
}

export async function updateMaquina(id: string, payload: MaquinaUpdate): Promise<MaquinaResponse> {
  const { data } = await api.patch<MaquinaWire>(`/maquinaria/maquinas/${id}`, payload)
  return normalizeMaquina(data)
}

export async function getHistorialMaquina(id: string): Promise<HistorialMaquinaResponse> {
  const { data } = await api.get<HistorialWire>(`/maquinaria/maquinas/${id}/historial`)
  return normalizeHistorial(data)
}

// ─── Órdenes ──────────────────────────────────────────────────────────────────

export async function getOrdenes(filter: OrdenesFilter = {}): Promise<OrdenResponse[]> {
  const { data } = await api.get<OrdenResponse[]>('/maquinaria/ordenes', { params: filter })
  return data
}

export async function getOrden(id: string): Promise<OrdenDetalleResponse> {
  const { data } = await api.get<OrdenDetalleWire>(`/maquinaria/ordenes/${id}`)
  return normalizeOrdenDetalle(data)
}

export async function createOrden(payload: OrdenCreate): Promise<OrdenDetalleResponse> {
  const { data } = await api.post<OrdenDetalleWire>('/maquinaria/ordenes', payload)
  return normalizeOrdenDetalle(data)
}

export async function updateOrden(id: string, payload: OrdenUpdate): Promise<OrdenDetalleResponse> {
  const { data } = await api.patch<OrdenDetalleWire>(`/maquinaria/ordenes/${id}`, payload)
  return normalizeOrdenDetalle(data)
}

export async function transicionarOrden(
  id: string,
  payload: TransicionRequest
): Promise<OrdenDetalleResponse> {
  const { data } = await api.post<OrdenDetalleWire>(`/maquinaria/ordenes/${id}/transicion`, payload)
  return normalizeOrdenDetalle(data)
}

// ─── Presupuestos y pago (gerencial+) ─────────────────────────────────────────

export async function createPresupuesto(
  ordenId: string,
  payload: PresupuestoCreate
): Promise<OrdenDetalleResponse> {
  const { data } = await api.post<OrdenDetalleWire>(`/maquinaria/ordenes/${ordenId}/presupuestos`, payload)
  return normalizeOrdenDetalle(data)
}

export async function resolverPresupuesto(
  presupuestoId: string,
  payload: PresupuestoResolver
): Promise<PresupuestoResponse> {
  const { data } = await api.post<PresupuestoWire>(`/maquinaria/presupuestos/${presupuestoId}/resolver`, payload)
  return normalizePresupuesto(data)
}

export async function registrarPago(ordenId: string, payload: PagoCreate): Promise<PagoResponse> {
  const { data } = await api.post<PagoWire>(`/maquinaria/ordenes/${ordenId}/pago`, payload)
  return normalizePago(data)
}

export async function anularPago(ordenId: string): Promise<void> {
  await api.delete(`/maquinaria/ordenes/${ordenId}/pago`)
}

// ─── Fotos ────────────────────────────────────────────────────────────────────

export async function uploadFotoOrden(ordenId: string, file: File): Promise<FotoOrdenResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post<FotoOrdenResponse>(`/maquinaria/ordenes/${ordenId}/fotos`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function deleteFotoOrden(ordenId: string, fotoId: string): Promise<void> {
  await api.delete(`/maquinaria/ordenes/${ordenId}/fotos/${fotoId}`)
}

// ─── Errors ───────────────────────────────────────────────────────────────────

// Extracts the backend `detail` message (409/400/404 carry readable Spanish text).
export function getMaquinariaErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}
