import api from '@/lib/api'

// El backend persiste inicio/fin en UTC (columnas timestamptz). El campo
// `valvula` fija la referencia horaria del negocio en Argentina, así que
// cualquier fecha/hora que se muestre al usuario debe convertirse
// explícitamente a este huso — nunca "recortar" el string ISO crudo, porque
// esos dígitos están en UTC, no en hora local.
export const TZ_ARGENTINA = 'America/Argentina/San_Juan'

// Devuelve "YYYY-MM-DD" en hora de Argentina a partir de un ISO datetime UTC.
export function formatFechaLocal(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ_ARGENTINA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso))
}

// Devuelve "HH:mm" en hora de Argentina a partir de un ISO datetime UTC.
export function formatHoraLocal(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ_ARGENTINA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso))
}

// "Hoy" en fecha de Argentina (evita que toISOString(), que es UTC, muestre
// el día siguiente/anterior según la hora del día en que se abre el form).
export function hoyArgentina(): string {
  return formatFechaLocal(new Date().toISOString())
}

// Cada válvula riega 1 ha: 16,000 L/h → 1.6 mm/h sobre esa ha.
export const MM_POR_HORA = 1.6
export const LITROS_POR_HORA_VALVULA = 16_000
// Referencia agronómica para el suelo de Media Agua: 6.000.000 L/ha/año.
export const LITROS_OBJETIVO_ANUAL_POR_HA = 6_000_000

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
  fechaFin: string, horaFin: string,
  nValvulas: number = 1,
): { horas: number; mm: number; litros: number } | null {
  if (!fechaInicio || !horaInicio || !fechaFin || !horaFin) return null
  const start = new Date(`${fechaInicio}T${horaInicio}:00`)
  const end = new Date(`${fechaFin}T${horaFin}:00`)
  const horas = (end.getTime() - start.getTime()) / 3600000
  if (horas <= 0) return null
  const n = nValvulas > 0 ? nValvulas : 1
  return {
    horas: Math.round(horas * 100) / 100,
    // mm es la lámina aplicada por válvula (uniforme, no escala con la cantidad de válvulas)
    mm: Math.round(horas * MM_POR_HORA * 100) / 100,
    // litros totales sí escalan: cada válvula riega su propia hectárea
    litros: Math.round(horas * LITROS_POR_HORA_VALVULA * n),
  }
}

// Litros/duración acumulados hasta ahora para un riego en curso (sin fin
// todavía) — mismo cálculo que calcMm pero contra el reloj, se llama en cada
// tick del cronómetro en pantalla, no contra el servidor.
export function calcEnCurso(
  inicioISO: string, nValvulas: number,
): { horas: number; mm: number; litros: number } {
  const horas = Math.max(0, (Date.now() - new Date(inicioISO).getTime()) / 3600000)
  const n = nValvulas > 0 ? nValvulas : 1
  return {
    horas: Math.round(horas * 100) / 100,
    mm: Math.round(horas * MM_POR_HORA * 100) / 100,
    litros: Math.round(horas * LITROS_POR_HORA_VALVULA * n),
  }
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
  n_valvulas: number
  litros_aplicados: number
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

// Riego "en curso": arrancó (inicio) pero todavía no se cerró (sin fin).
export interface RiegoIniciarInput {
  parcela_id: string
  cabezal: string
  valvula: string
  responsable: string
  fertilizante_nombre?: string
  fertilizante_dosis_lt_ha?: number
}

export interface RiegoEnCurso {
  id: string
  fecha: string
  parcela_id: string
  cabezal: string
  valvula: string
  inicio: string
  n_valvulas: number
  responsable: string
  fertilizante_nombre: string | null
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

export async function getRiegosEnCurso(): Promise<RiegoEnCurso[]> {
  const { data } = await api.get('/produccion/riego/en-curso')
  return data
}

export async function iniciarRiego(data: RiegoIniciarInput): Promise<RiegoEnCurso> {
  const { data: res } = await api.post('/produccion/riego/iniciar', data)
  return res
}

export async function terminarRiego(id: string, fin?: string): Promise<RiegoResponse> {
  const { data: res } = await api.post(`/produccion/riego/${id}/terminar`, fin ? { fin } : {})
  return res
}
