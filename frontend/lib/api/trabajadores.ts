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

export interface TrabajadorUpdate {
  nombre_completo?: string
  dni?: string
  rol?: RolTrabajador
  telefono?: string
  is_active?: boolean
}

export async function getTrabajadores(): Promise<TrabajadorResponse[]> {
  const { data } = await api.get('/trabajadores/', { params: { is_active: true } })
  return data
}

// Admin: trae activos e inactivos, para el maestro de trabajadores.
export async function listTrabajadoresAdmin(): Promise<TrabajadorResponse[]> {
  const { data } = await api.get('/trabajadores/')
  return data
}

export async function createTrabajador(nombre_completo: string): Promise<TrabajadorResponse> {
  const { data } = await api.post('/trabajadores/', { nombre_completo })
  return data
}

export async function createTrabajadorFull(data: {
  nombre_completo: string
  dni?: string
  rol?: RolTrabajador
  telefono?: string
}): Promise<TrabajadorResponse> {
  const { data: res } = await api.post('/trabajadores/', data)
  return res
}

export async function updateTrabajador(id: string, data: TrabajadorUpdate): Promise<TrabajadorResponse> {
  const { data: res } = await api.put(`/trabajadores/${id}`, data)
  return res
}

export async function deactivateTrabajador(id: string): Promise<void> {
  await api.delete(`/trabajadores/${id}`)
}

// Si el nombre tipeado no coincide con ningún trabajador existente (ni el
// usuario eligió una sugerencia), crea uno nuevo para que quede disponible
// la próxima vez, en vez de quedar como texto libre suelto. Mismo patrón
// usado en TareaForm.tsx desde el 2026-08-05.
export async function resolveTrabajadorId(
  nombre: string,
  currentId: string | undefined,
  trabajadoresDb: TrabajadorResponse[]
): Promise<string | undefined> {
  if (currentId) return currentId
  const trimmed = nombre.trim()
  if (!trimmed) return undefined
  const exact = trabajadoresDb.find(
    (t) => t.nombre_completo.trim().toLowerCase() === trimmed.toLowerCase()
  )
  if (exact) return exact.id
  try {
    const creado = await createTrabajador(trimmed)
    return creado.id
  } catch {
    return undefined
  }
}
