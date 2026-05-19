import api from '@/lib/api'

export const TIPO_PARCELA_VALUES = ['parral', 'potrero', 'pasero', 'cabezal'] as const
export type TipoParcela = (typeof TIPO_PARCELA_VALUES)[number]

export const VARIEDAD_VALUES = [
  'flame', 'red_globe', 'fiesta', 'bonarda', 'sultanina', 'syrah', 'aspirant', 'alfalfa', 'otro',
] as const
export type VariedadUva = (typeof VARIEDAD_VALUES)[number]

export const TIPO_LABELS: Record<TipoParcela, string> = {
  parral: 'Parral', potrero: 'Potrero', pasero: 'Pasero', cabezal: 'Cabezal',
}

export const TIPO_BADGE: Record<TipoParcela, string> = {
  parral: 'bg-green-50 text-green-700',
  potrero: 'bg-amber-50 text-amber-700',
  pasero: 'bg-orange-50 text-orange-700',
  cabezal: 'bg-blue-50 text-blue-700',
}

export const VARIEDAD_LABELS: Record<VariedadUva, string> = {
  flame: 'Flame', red_globe: 'Red Globe', fiesta: 'Fiesta', bonarda: 'Bonarda',
  sultanina: 'Sultanina', syrah: 'Syrah', aspirant: 'Aspirant', alfalfa: 'Alfalfa', otro: 'Otro',
}

export interface ParcelaAdminResponse {
  id: string
  nombre: string
  tipo: TipoParcela
  variedad: VariedadUva | null
  superficie_ha: number | null
  cabezal_riego: string | null
  is_active: boolean
  created_at: string
}

export interface ParcelaCreate {
  nombre: string
  tipo: TipoParcela
  variedad?: VariedadUva
  superficie_ha?: number
  cabezal_riego?: string
}

export interface ParcelaUpdate {
  nombre?: string
  tipo?: TipoParcela
  variedad?: VariedadUva | null
  superficie_ha?: number | null
  cabezal_riego?: string | null
}

export async function listParcelasAdmin(): Promise<ParcelaAdminResponse[]> {
  const { data } = await api.get('/parcelas/')
  return data
}

export async function createParcela(data: ParcelaCreate): Promise<ParcelaAdminResponse> {
  const { data: res } = await api.post('/parcelas/', data)
  return res
}

export async function updateParcela(id: string, data: ParcelaUpdate): Promise<ParcelaAdminResponse> {
  const { data: res } = await api.put(`/parcelas/${id}`, data)
  return res
}

export async function deactivateParcela(id: string): Promise<ParcelaAdminResponse> {
  const { data: res } = await api.delete(`/parcelas/${id}`)
  return res
}
