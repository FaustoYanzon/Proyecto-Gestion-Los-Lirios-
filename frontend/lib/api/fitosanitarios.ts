import api from '@/lib/api'

export interface FitosanitarioCreate {
  fecha: string
  parcela_id: string
  producto_nombre: string
  dosis_lt_ha: number
  motivo: string
  dias_carencia: number
  dias_reingreso: number
  responsable: string
}

export interface FitosanitarioUpdate {
  fecha?: string
  parcela_id?: string
  producto_nombre?: string
  dosis_lt_ha?: number
  motivo?: string
  dias_carencia?: number
  dias_reingreso?: number
  responsable?: string
}

export interface FitosanitarioResponse {
  id: string
  fecha: string
  parcela_id: string
  producto_nombre: string
  dosis_lt_ha: number
  motivo: string
  dias_carencia: number
  dias_reingreso: number
  fecha_habilitacion_cosecha: string
  fecha_habilitacion_reingreso: string
  responsable: string
  created_by: string
  created_at: string
}

export interface FitosanitarioFilter {
  fecha_desde?: string
  fecha_hasta?: string
  parcela_id?: string
  producto_nombre?: string
}

export async function getFitosanitarios(params: FitosanitarioFilter): Promise<FitosanitarioResponse[]> {
  const { data } = await api.get('/produccion/fitosanitarios/', { params })
  return data
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
