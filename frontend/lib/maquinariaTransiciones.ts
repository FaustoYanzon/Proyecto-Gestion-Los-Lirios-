import type { OrdenDetalleResponse, EstadoOrden } from '@/lib/api/maquinaria'

// Mirror of TRANSICIONES / PRECONDICIONES in backend/app/services/maquinaria.py.
// The backend is the source of truth: this table only decides which buttons to
// show. Every transition is re-validated server-side, so drift here can hide a
// valid action or show one the API rejects (409/403), never corrupt data.

export type NivelRol = 'encargado' | 'gerencial'

export type PrecondicionKey =
  | 'taller_definido'
  | 'presupuesto_pendiente'
  | 'presupuesto_aprobado'
  | 'presupuesto_rechazado'
  | 'pago_registrado'

export interface TransicionDef {
  desde: EstadoOrden
  hacia: EstadoOrden
  nivel: NivelRol
  precondicion?: PrecondicionKey
  requiereNota?: boolean
}

// Cancellable up to "enviada_taller" (decision 7).
export const ESTADOS_CANCELABLES: readonly EstadoOrden[] = [
  'reportada',
  'diagnosticada',
  'presupuesto_pendiente',
  'presupuesto_aprobado',
  'enviada_taller',
]

export const ESTADOS_ABIERTOS: readonly EstadoOrden[] = [
  'reportada',
  'diagnosticada',
  'presupuesto_pendiente',
  'presupuesto_aprobado',
  'enviada_taller',
  'en_reparacion',
  'lista_retirar',
  'pendiente_validacion',
]

export const TRANSICIONES: readonly TransicionDef[] = [
  { desde: 'reportada', hacia: 'diagnosticada', nivel: 'gerencial', precondicion: 'taller_definido' },
  { desde: 'diagnosticada', hacia: 'presupuesto_pendiente', nivel: 'gerencial', precondicion: 'presupuesto_pendiente' },
  { desde: 'presupuesto_pendiente', hacia: 'presupuesto_aprobado', nivel: 'gerencial', precondicion: 'presupuesto_aprobado' },
  { desde: 'presupuesto_pendiente', hacia: 'diagnosticada', nivel: 'gerencial', precondicion: 'presupuesto_rechazado' },
  { desde: 'presupuesto_aprobado', hacia: 'enviada_taller', nivel: 'gerencial' },
  { desde: 'enviada_taller', hacia: 'en_reparacion', nivel: 'gerencial' },
  { desde: 'en_reparacion', hacia: 'lista_retirar', nivel: 'gerencial' },
  { desde: 'lista_retirar', hacia: 'pendiente_validacion', nivel: 'gerencial', precondicion: 'pago_registrado' },
  { desde: 'pendiente_validacion', hacia: 'cerrada', nivel: 'encargado' },
  { desde: 'pendiente_validacion', hacia: 'en_reparacion', nivel: 'encargado', requiereNota: true },
  ...ESTADOS_CANCELABLES.map(
    (desde): TransicionDef => ({ desde, hacia: 'cancelada', nivel: 'gerencial', requiereNota: true })
  ),
]

// Transitions executed by their own endpoint instead of POST /transicion:
// the budget endpoints move the order themselves.
export const TRANSICIONES_VIA_PRESUPUESTO: readonly string[] = [
  'diagnosticada>presupuesto_pendiente',
  'presupuesto_pendiente>presupuesto_aprobado',
  'presupuesto_pendiente>diagnosticada',
]

export function esGerencialUp(role: string | undefined): boolean {
  return role === 'gerencial' || role === 'super_admin'
}

function rolCumple(role: string | undefined, nivel: NivelRol): boolean {
  if (nivel === 'gerencial') return esGerencialUp(role)
  return role === 'encargado' || esGerencialUp(role)
}

export function transicionesDisponibles(estado: EstadoOrden, role: string | undefined): TransicionDef[] {
  return TRANSICIONES.filter((t) => t.desde === estado && rolCumple(role, t.nivel))
}

export function viaPresupuesto(t: TransicionDef): boolean {
  return TRANSICIONES_VIA_PRESUPUESTO.includes(`${t.desde}>${t.hacia}`)
}

// Returns a Spanish hint when the precondition is not met, null otherwise.
// Only the preconditions that apply to direct transitions are evaluated here.
export function precondicionPendiente(t: TransicionDef, orden: OrdenDetalleResponse): string | null {
  switch (t.precondicion) {
    case 'taller_definido':
      return (orden.taller ?? '').trim() ? null : 'Elegí el taller antes de diagnosticar la orden.'
    case 'pago_registrado':
      return orden.pago ? null : 'Registrá el pago antes de pasar la orden a validación.'
    default:
      return null
  }
}
