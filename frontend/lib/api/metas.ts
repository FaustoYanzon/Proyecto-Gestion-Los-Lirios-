import api from '@/lib/api'

export interface MetaProduccion {
  id: string
  temporada: number
  parcela_id: string
  parcela_nombre: string | null
  kg_plan: number
  notas: string | null
  created_by: string
  created_at: string
}

export interface MetaProduccionCreate {
  temporada: number
  parcela_id: string
  kg_plan: number
  notas?: string | null
}

export async function getMetas(temporada?: number): Promise<MetaProduccion[]> {
  const { data } = await api.get('/presupuestos/metas/', {
    params: temporada != null ? { temporada } : {},
  })
  return data
}

export async function createMeta(payload: MetaProduccionCreate): Promise<MetaProduccion> {
  const { data } = await api.post('/presupuestos/metas/', payload)
  return data
}

export async function updateMeta(id: string, payload: { kg_plan?: number; notas?: string | null }): Promise<MetaProduccion> {
  const { data } = await api.put(`/presupuestos/metas/${id}`, payload)
  return data
}

export async function deleteMeta(id: string): Promise<void> {
  await api.delete(`/presupuestos/metas/${id}`)
}
