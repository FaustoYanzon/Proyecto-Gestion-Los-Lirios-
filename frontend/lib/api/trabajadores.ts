import api from '@/lib/api'

export type RolTrabajador = 'obrero' | 'tractorista' | 'encargado_cuadrilla' | 'otro'

export interface TrabajadorResponse {
  id: string
  nombre_completo: string
  dni: string | null
  rol: RolTrabajador
  telefono: string | null
  is_active: boolean
  created_at: string
}

export async function getTrabajadores(): Promise<TrabajadorResponse[]> {
  const { data } = await api.get('/trabajadores/', { params: { is_active: true } })
  return data
}

export async function createTrabajador(nombre_completo: string): Promise<TrabajadorResponse> {
  const { data } = await api.post('/trabajadores/', { nombre_completo })
  return data
}
