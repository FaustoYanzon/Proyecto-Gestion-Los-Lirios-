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
