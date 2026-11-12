// UI-side helpers for the Maquinaria screens: semaforo colors, formatting,
// cache-first fleet/orders loading and the "needs my action" counter.
// Kept apart from lib/maquinaria.ts (API client mirror) on purpose.

import { colors } from './theme'
import { getCache, setCache, CACHE_TTL } from './cache'
import {
  listMaquinas,
  listOrdenes,
  esGerencialUp,
  type EstadoOrden,
  type FincaMaquinaria,
  type MaquinaResponse,
  type OrdenResponse,
  type Semaforo,
} from './maquinaria'

export const SEMAFORO_COLORS: Record<Semaforo, string> = {
  verde: colors.verdeCampo,
  amarillo: colors.oro,
  rojo: colors.sangre,
  azul: colors.cielo,
}

// Banner / call-to-action color for "Reportar falla": distinct from burdeos.
export const COLOR_REPORTAR = '#c96a1f'

// Pale orders-state tint used by the state chip.
export function colorEstadoOrden(estado: EstadoOrden): string {
  switch (estado) {
    case 'cerrada':
      return colors.verdeCampo
    case 'cancelada':
      return colors.niebla
    case 'pendiente_validacion':
    case 'presupuesto_pendiente':
      return colors.oro
    case 'lista_retirar':
    case 'en_reparacion':
    case 'enviada_taller':
      return colors.cielo
    default:
      return colors.ink60
  }
}

export function fmtFechaHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function nombreMaquina(m: { marca: string; modelo: string }): string {
  return `${m.marca} ${m.modelo}`.trim()
}

// ─── Cache-first loading ──────────────────────────────────────────────────────

export const flotaCacheKey = (finca: FincaMaquinaria) => `maquinas_${finca}`
export const ordenesCacheKey = (finca: FincaMaquinaria) => `maquinaria_ordenes_abiertas_${finca}`

export function readFlotaCache(
  finca: FincaMaquinaria,
  ttlMs: number = CACHE_TTL.maquinas,
): Promise<MaquinaResponse[] | null> {
  return getCache<MaquinaResponse[]>(flotaCacheKey(finca), ttlMs)
}

export async function fetchFlota(finca: FincaMaquinaria): Promise<MaquinaResponse[]> {
  const data = await listMaquinas({ finca })
  await setCache(flotaCacheKey(finca), data)
  return data
}

export function readOrdenesCache(finca: FincaMaquinaria): Promise<OrdenResponse[] | null> {
  return getCache<OrdenResponse[]>(ordenesCacheKey(finca), CACHE_TTL.maquinas)
}

export async function fetchOrdenesAbiertas(finca: FincaMaquinaria): Promise<OrdenResponse[]> {
  const data = await listOrdenes({ abiertas: true, finca })
  await setCache(ordenesCacheKey(finca), data)
  return data
}

// Open orders waiting on this user: gerencial+ approves budgets, encargado
// validates the repair. Other roles have no module access (returns 0).
export async function contarOrdenesPendientesDeAccion(
  role: string | null | undefined,
  finca: FincaMaquinaria,
): Promise<number> {
  if (esGerencialUp(role)) {
    return (await listOrdenes({ estado: 'presupuesto_pendiente', finca })).length
  }
  if (role === 'encargado') {
    return (await listOrdenes({ estado: 'pendiente_validacion', finca })).length
  }
  return 0
}

// An order is open (editable, accepts photos) until closed or cancelled.
export function ordenAbierta(estado: EstadoOrden): boolean {
  return estado !== 'cerrada' && estado !== 'cancelada'
}
