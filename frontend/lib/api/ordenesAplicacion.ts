import api from '@/lib/api'

export type OrigenOrdenAplicacion = 'plan' | 'extra'
export type EstadoOrdenAplicacion = 'pendiente' | 'en_curso' | 'completada'
export type EstadoOrdenAplicacionParcela = 'pendiente' | 'aplicada'

export type ResultadoValvula = 'completa' | 'no_aplicada'

export interface OrdenAplicacionValvula {
  id: string
  valvula_id: string
  valvula_nombre: string
  superficie_ha: string | null
  estado: EstadoOrdenAplicacionParcela
  resultado: ResultadoValvula | null
  responsable: string | null
  observaciones: string | null
  registro_fitosanitario_id: string | null
  confirmada_at: string | null
}

export interface OrdenAplicacionParcela {
  id: string
  parcela_id: string
  parcela_nombre: string
  estado: EstadoOrdenAplicacionParcela
  registro_fitosanitario_id: string | null
  // Vacía en parcelas sin válvulas y en órdenes anteriores a la confirmación
  // por válvula: esas se confirman por parcela entera.
  valvulas: OrdenAplicacionValvula[]
}

export interface OrdenAplicacion {
  id: string
  temporada: number
  origen: OrigenOrdenAplicacion
  plan_fitosanitario_id: string | null
  variedad: string
  insumo_id: string
  insumo_nombre: string
  insumo_unidad: 'kg' | 'lt'
  dosis_por_ha: number
  objetivo: string
  dias_carencia: number
  dias_reingreso: number
  fecha_planificada: string
  estado: EstadoOrdenAplicacion
  notas: string | null
  created_by: string
  created_at: string
  parcelas: OrdenAplicacionParcela[]
}

export interface OrdenAplicacionCreateDesdePlan {
  plan_fitosanitario_id: string
  dias_carencia: number
  dias_reingreso: number
  fecha_planificada: string
  parcela_ids?: string[] | null
  notas?: string | null
}

export interface OrdenAplicacionCreateExtra {
  temporada: number
  variedad: string
  insumo_id: string
  dosis_por_ha: number
  objetivo: string
  dias_carencia: number
  dias_reingreso: number
  fecha_planificada: string
  parcela_ids?: string[] | null
  // Orden de repaso: restringe la orden a estas válvulas puntuales.
  valvula_ids?: string[] | null
  notas?: string | null
}

export async function getOrdenesAplicacion(params: {
  temporada: number
  estado?: EstadoOrdenAplicacion
  variedad?: string
}): Promise<OrdenAplicacion[]> {
  const { data } = await api.get('/ordenes-aplicacion/', { params })
  return data
}

export async function getOrdenAplicacion(id: string): Promise<OrdenAplicacion> {
  const { data } = await api.get(`/ordenes-aplicacion/${id}`)
  return data
}

export async function crearOrdenDesdePlan(
  payload: OrdenAplicacionCreateDesdePlan,
): Promise<OrdenAplicacion> {
  const { data } = await api.post('/ordenes-aplicacion/desde-plan', payload)
  return data
}

export async function crearOrdenExtra(payload: OrdenAplicacionCreateExtra): Promise<OrdenAplicacion> {
  const { data } = await api.post('/ordenes-aplicacion/', payload)
  return data
}

// Solo órdenes extra (fuera de plan) y sin aplicaciones confirmadas -- el
// backend responde 409 en cualquier otro caso.
export type OrdenAplicacionUpdateExtra = Omit<OrdenAplicacionCreateExtra, 'temporada'>

export async function actualizarOrdenExtra(
  id: string,
  payload: OrdenAplicacionUpdateExtra,
): Promise<OrdenAplicacion> {
  const { data } = await api.put(`/ordenes-aplicacion/${id}`, payload)
  return data
}

export async function eliminarOrdenExtra(id: string): Promise<void> {
  await api.delete(`/ordenes-aplicacion/${id}`)
}

// Válvula confirmada que no se aplicó, o que se aplicó con observaciones, y
// que nadie revisó todavía (GET /ordenes-aplicacion/a-revisar).
export interface ValvulaARevisar {
  id: string
  orden_id: string
  parcela_id: string
  parcela_nombre: string
  valvula_id: string
  valvula_nombre: string
  variedad: string
  insumo_id: string
  insumo_nombre: string
  dosis_por_ha: number
  objetivo: string
  resultado: ResultadoValvula
  responsable: string | null
  observaciones: string | null
  confirmada_at: string | null
  fotos: string[]
}

export async function getValvulasARevisar(): Promise<ValvulaARevisar[]> {
  const { data } = await api.get('/ordenes-aplicacion/a-revisar')
  return data
}

export async function revisarValvula(ordenValvulaId: string): Promise<void> {
  await api.post(`/ordenes-aplicacion/valvulas/${ordenValvulaId}/revisar`)
}

// Reverts a confirmed válvula back to pendiente: the backend returns the
// stock and deletes the registro fitosanitario. 409 if not confirmed yet.
export async function deshacerValvula(ordenId: string, ordenValvulaId: string): Promise<void> {
  await api.post(`/ordenes-aplicacion/${ordenId}/valvulas/${ordenValvulaId}/deshacer`)
}
