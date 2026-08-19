import api from '@/lib/api'

export interface LoteImportacionTermografoResponse {
  id: string
  device_id: string
  nombre_archivo: string
  intervalo_seg: number
  rango_inicio: string
  rango_fin: string
  cantidad_filas: number
  cantidad_nuevas: number
  cantidad_duplicadas: number
  importado_por: string
  importado_at: string
}

export interface ImportarTermografoResponse {
  lote: LoteImportacionTermografoResponse
  nuevos: number
  duplicados: number
  errores: string[]
}

export interface LecturaTermografoResponse {
  fecha_hora: string
  temperatura: number
  humedad: number
}

export interface LecturaDiariaResponse {
  dia: string
  temp_min: number
  temp_max: number
  temp_avg: number
  humedad_avg: number
}

export interface LecturasTermografoResponse {
  granularidad: 'cruda' | 'diaria'
  puntos: LecturaTermografoResponse[] | LecturaDiariaResponse[]
}

export interface EventoHeladaResponse {
  inicio: string
  fin: string
  duracion_horas: number
  minima: number
}

export interface MetricasTermografoResponse {
  desde: string
  hasta: string
  cantidad_lecturas: number
  horas_bajo_cero: number
  horas_sobre_30: number
  horas_de_frio: number
  horas_riesgo_fungico: number
  gdd_acumulado: number
  gdd_acumulado_desde_brotacion: number | null
  amplitud_termica_promedio: number | null
  eventos_helada: EventoHeladaResponse[]
}

export async function importarTermografoCsv(file: File): Promise<ImportarTermografoResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post('/produccion/termografo/importar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function getLotesTermografo(limit = 20): Promise<LoteImportacionTermografoResponse[]> {
  const { data } = await api.get('/produccion/termografo/lotes', { params: { limit } })
  return data
}

export async function getLecturasTermografo(params: {
  desde: string
  hasta: string
  device_id?: string
}): Promise<LecturasTermografoResponse> {
  const { data } = await api.get('/produccion/termografo/lecturas', { params })
  return data
}

export async function getMetricasTermografo(params: {
  desde: string
  hasta: string
  device_id?: string
}): Promise<MetricasTermografoResponse> {
  const { data } = await api.get('/produccion/termografo/metricas', { params })
  return data
}
