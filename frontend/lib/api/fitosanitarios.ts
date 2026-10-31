import api from '@/lib/api'

export interface FitosanitarioCreate {
  fecha: string
  parcela_id: string
  insumo_id: string
  dosis_por_ha: number
  motivo: string
  dias_carencia: number
  dias_reingreso: number
  responsable: string
  responsable_id?: string
  idempotency_key?: string
}

export interface FitosanitarioUpdate {
  fecha?: string
  parcela_id?: string
  insumo_id?: string
  dosis_por_ha?: number
  motivo?: string
  dias_carencia?: number
  dias_reingreso?: number
  responsable?: string
  responsable_id?: string
}

export interface FitosanitarioResponse {
  id: string
  fecha: string
  parcela_id: string
  producto_nombre: string
  insumo_id: string | null
  dosis_por_ha: number
  unidad: 'kg' | 'lt' | null
  cantidad_total: number | null
  motivo: string
  dias_carencia: number
  dias_reingreso: number
  fecha_habilitacion_cosecha: string
  fecha_habilitacion_reingreso: string
  responsable: string
  responsable_id: string | null
  // Order this record came from; null for manually created records.
  orden_id: string | null
  // Valve row of that order (one per product of the same valve confirmation).
  orden_valvula_id: string | null
  created_by: string
  created_at: string
}

export interface FitosanitarioFilter {
  fecha_desde?: string
  fecha_hasta?: string
  parcela_id?: string
  producto_nombre?: string
  limit?: number
  skip?: number
}

export async function getFitosanitarios(params: FitosanitarioFilter): Promise<FitosanitarioResponse[]> {
  const { data } = await api.get('/produccion/fitosanitarios/', { params })
  return data
}

const LOTE_MAX = 1000 // backend cap per request

// Every record matching the filters. The backend defaults to 100 rows, which
// with several products per valve would cut an order in half when grouping.
export async function getFitosanitariosTodos(
  params: Omit<FitosanitarioFilter, 'limit' | 'skip'>,
): Promise<FitosanitarioResponse[]> {
  const todos: FitosanitarioResponse[] = []
  for (let skip = 0; ; skip += LOTE_MAX) {
    const lote = await getFitosanitarios({ ...params, limit: LOTE_MAX, skip })
    todos.push(...lote)
    if (lote.length < LOTE_MAX) return todos
  }
}

export async function getAlertasCarencia(): Promise<FitosanitarioResponse[]> {
  const { data } = await api.get('/produccion/fitosanitarios/alertas/carencia')
  return data
}

export async function createFitosanitario(data: FitosanitarioCreate): Promise<FitosanitarioResponse> {
  const { data: res } = await api.post('/produccion/fitosanitarios/', data)
  return res
}

export async function updateFitosanitario(id: string, data: FitosanitarioUpdate): Promise<FitosanitarioResponse> {
  const { data: res } = await api.put(`/produccion/fitosanitarios/${id}`, data)
  return res
}

export async function deleteFitosanitario(id: string): Promise<void> {
  await api.delete(`/produccion/fitosanitarios/${id}`)
}

// Deletes the record, returns stock and puts the parcela/valve back to pending in its order.
export async function reactivarFitosanitario(id: string): Promise<void> {
  await api.post(`/produccion/fitosanitarios/${id}/reactivar`)
}
