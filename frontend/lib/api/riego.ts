import api from '@/lib/api'

// 16,000 L/ha/h → 1.6 mm/h
export const MM_POR_HORA = 1.6

// Válvulas disponibles por parcela (según planilla de cabezales)
export const VALVULAS_POR_PARCELA: Record<string, number> = {
  'Parral Sult.':       4,
  'Parral 9':           2,
  'Parral 4':           2,
  'Parral 5':           2,
  'Parral 2':           2,
  'Parral 10':          3,
  'Parral 6':           4,
  'Parral 11':          4,
  'Parral 7':           4,
  'Parral 16':          2,
  'Parral 13':          3,
  'Parral 15':          2,
  'Parral 14':          3,
  'Parral 21':          4,
  'Parral 12':          3,
  'Parral 8':           3,
  'Parral SYR-RG':      3,
  'Parral Bond. Viejo': 2,
  'Parral Bond. Nuevo': 2,
}

export function getValvulas(parcelaNombre: string): number[] {
  const max = VALVULAS_POR_PARCELA[parcelaNombre]
  if (!max) return [1, 2, 3, 4]
  return Array.from({ length: max }, (_, i) => i + 1)
}

export function calcMm(
  fechaInicio: string, horaInicio: string,
  fechaFin: string, horaFin: string
): { horas: number; mm: number } | null {
  if (!fechaInicio || !horaInicio || !fechaFin || !horaFin) return null
  const start = new Date(`${fechaInicio}T${horaInicio}:00`)
  const end = new Date(`${fechaFin}T${horaFin}:00`)
  const horas = (end.getTime() - start.getTime()) / 3600000
  if (horas <= 0) return null
  return { horas: Math.round(horas * 100) / 100, mm: Math.round(horas * MM_POR_HORA * 100) / 100 }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RiegoCreate {
  fecha: string
  parcela_id: string
  cabezal: string
  valvula: string
  inicio: string
  fin: string
  mm_aplicados?: number
  fertilizante_nombre?: string
  fertilizante_dosis_lt_ha?: number
  responsable: string
}

export interface RiegoUpdate {
  fecha?: string
  parcela_id?: string
  cabezal?: string
  valvula?: string
  inicio?: string
  fin?: string
  mm_aplicados?: number
  fertilizante_nombre?: string
  fertilizante_dosis_lt_ha?: number
  responsable?: string
}

export interface RiegoResponse {
  id: string
  fecha: string
  parcela_id: string
  cabezal: string
  valvula: string
  inicio: string
  fin: string
  duracion_horas: number
  mm_aplicados: number | null
  fertilizante_nombre: string | null
  fertilizante_dosis_lt_ha: number | null
  responsable: string
  created_by: string
  created_at: string
}

export interface RiegoFilter {
  fecha_desde?: string
  fecha_hasta?: string
  parcela_id?: string
  cabezal?: string
  responsable?: string
  skip?: number
  limit?: number
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function getRiegos(params: RiegoFilter): Promise<RiegoResponse[]> {
  const { data } = await api.get('/produccion/riego/', { params })
  return data
}

export async function createRiego(data: RiegoCreate): Promise<RiegoResponse> {
  const { data: res } = await api.post('/produccion/riego/', data)
  return res
}

export async function updateRiego(id: string, data: RiegoUpdate): Promise<RiegoResponse> {
  const { data: res } = await api.put(`/produccion/riego/${id}`, data)
  return res
}

export async function deleteRiego(id: string): Promise<void> {
  await api.delete(`/produccion/riego/${id}`)
}
