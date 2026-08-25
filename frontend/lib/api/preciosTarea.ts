import api from '@/lib/api'
import type { UnidadMedida } from '@/lib/api/produccion'

export interface PrecioTareaCreate {
  temporada: number
  tarea: string
  parcela_id?: string | null
  unidad_medida: UnidadMedida
  precio_unitario: number
}

export interface PrecioTareaUpdate {
  precio_unitario: number
}

export interface PrecioTareaResponse extends PrecioTareaCreate {
  id: string
  parcela_nombre: string | null
  created_by: string
  created_at: string
}

export interface PreciosTareaFilter {
  temporada?: number
  tarea?: string
  parcela_id?: string
}

export async function getPreciosTarea(params?: PreciosTareaFilter): Promise<PrecioTareaResponse[]> {
  const { data } = await api.get('/precios-tarea/', { params })
  return data
}

export async function createPrecioTarea(data: PrecioTareaCreate): Promise<PrecioTareaResponse> {
  const { data: res } = await api.post('/precios-tarea/', data)
  return res
}

export async function updatePrecioTarea(id: string, data: PrecioTareaUpdate): Promise<PrecioTareaResponse> {
  const { data: res } = await api.put(`/precios-tarea/${id}`, data)
  return res
}

export async function deletePrecioTarea(id: string): Promise<void> {
  await api.delete(`/precios-tarea/${id}`)
}

// "2026/2027" -> 2026, y a partir de una fecha "YYYY-MM-DD" (mismo criterio
// mayo->abril que ya usa RegistroCosecha en el backend para derivar su propia
// `temporada`) -- para que el autocompletado de precio use la campaña real de
// la fecha que se está cargando, no la de "hoy".
export function temporadaDeFecha(fechaISO: string): number {
  const [anioStr, mesStr] = fechaISO.split('-')
  const anio = Number(anioStr)
  const mes = Number(mesStr)
  return mes >= 5 ? anio : anio - 1
}

// Busca el precio aplicable: primero una regla específica de la parcela
// elegida, si no hay cae a la regla general (parcela_id null). Devuelve null
// si no hay ninguna regla para esa tarea/unidad en la temporada -- el campo
// de precio se queda vacío, como hoy.
export function buscarPrecio(
  precios: PrecioTareaResponse[],
  { tarea, parcelaId, unidadMedida }: { tarea: string; parcelaId: string | null | undefined; unidadMedida: UnidadMedida }
): PrecioTareaResponse | null {
  if (parcelaId) {
    const especifico = precios.find(
      (p) => p.tarea === tarea && p.parcela_id === parcelaId && p.unidad_medida === unidadMedida
    )
    if (especifico) return especifico
  }
  const general = precios.find(
    (p) => p.tarea === tarea && p.parcela_id == null && p.unidad_medida === unidadMedida
  )
  return general ?? null
}
