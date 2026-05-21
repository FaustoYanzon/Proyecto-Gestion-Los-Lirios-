import api from '@/lib/api'

export const TIPO_EGRESO_VALUES = [
  'sueldos_personal',
  'produccion',
  'inversion',
  'insumos_varios',
  'impuestos_servicios',
  'financiero',
  'materia_prima',
] as const

export type TipoEgreso = (typeof TIPO_EGRESO_VALUES)[number]

export const CLASIFICACION_VALUES = [
  'gerenciales', 'encargados', 'obreros', 'contador', 'abogado', 'administrador', 'sueldos_otros',
  'fertilizantes', 'agroquimicos', 'produccion_otros',
  'inversion_movilidad', 'inversion_infraestructura', 'inversion_riego', 'inversion_otros',
  'rep_repuestos_vehiculos', 'rep_repuestos_infraestructura', 'combustibles', 'insumos_otros',
  'vep', 'energia_electrica', 'hidraulica', 'rentas', 'gas', 'internet', 'servicios_otros',
  'creditos_bancarios', 'seguros', 'intereses', 'financiero_otros',
  'compra_uva_fresca', 'compra_pasa', 'materia_prima_otros',
] as const

export type ClasificacionEgreso = (typeof CLASIFICACION_VALUES)[number]

export interface EgresoCreate {
  fecha: string
  tipo: TipoEgreso
  clasificacion: ClasificacionEgreso
  descripcion?: string
  monto: number
  moneda: 'ars' | 'usd'
  tipo_cambio?: number
  origen: 'oficial' | 'no_oficial'
  finca: 'los_mimbres' | 'media_agua' | 'caucete'
  forma_pago: 'efectivo' | 'transferencia' | 'cheque' | 'credito'
  parcela_id?: string
  fuente?: string
}

export interface EgresoResponse extends EgresoCreate {
  id: string
  created_by: string
  created_at: string
}

export interface EgresosFilter {
  fecha_desde?: string
  fecha_hasta?: string
  tipo?: string
  clasificacion?: string
  origen?: string
  finca?: string
  moneda?: string
  skip?: number
  limit?: number
}

export interface ResumenTipo {
  tipo: TipoEgreso
  total_ars: number
  total_usd: number
  count: number
}

export const TIPO_EGRESO_LABELS: Record<TipoEgreso, string> = {
  sueldos_personal: 'Sueldos Personal',
  produccion: 'Producción',
  inversion: 'Inversión',
  insumos_varios: 'Insumos Varios',
  impuestos_servicios: 'Impuestos y Servicios',
  financiero: 'Financiero',
  materia_prima: 'Materia Prima',
}

export const CLASIFICACIONES_POR_TIPO: Record<TipoEgreso, { value: ClasificacionEgreso; label: string }[]> = {
  sueldos_personal: [
    { value: 'gerenciales', label: 'Gerenciales' },
    { value: 'encargados', label: 'Encargados' },
    { value: 'obreros', label: 'Obreros' },
    { value: 'contador', label: 'Contador' },
    { value: 'abogado', label: 'Abogado' },
    { value: 'administrador', label: 'Administrador' },
    { value: 'sueldos_otros', label: 'Otros' },
  ],
  produccion: [
    { value: 'fertilizantes', label: 'Fertilizantes' },
    { value: 'agroquimicos', label: 'Agroquímicos' },
    { value: 'produccion_otros', label: 'Otros' },
  ],
  inversion: [
    { value: 'inversion_movilidad', label: 'Movilidad' },
    { value: 'inversion_infraestructura', label: 'Infraestructura' },
    { value: 'inversion_riego', label: 'Riego' },
    { value: 'inversion_otros', label: 'Otros' },
  ],
  insumos_varios: [
    { value: 'rep_repuestos_vehiculos', label: 'Repuestos Vehículos' },
    { value: 'rep_repuestos_infraestructura', label: 'Repuestos Infraestructura' },
    { value: 'combustibles', label: 'Combustibles' },
    { value: 'insumos_otros', label: 'Otros' },
  ],
  impuestos_servicios: [
    { value: 'vep', label: 'VEP' },
    { value: 'energia_electrica', label: 'Energía Eléctrica' },
    { value: 'hidraulica', label: 'Hidráulica' },
    { value: 'rentas', label: 'Rentas' },
    { value: 'gas', label: 'Gas' },
    { value: 'internet', label: 'Internet' },
    { value: 'servicios_otros', label: 'Otros' },
  ],
  financiero: [
    { value: 'creditos_bancarios', label: 'Créditos Bancarios' },
    { value: 'seguros', label: 'Seguros' },
    { value: 'intereses', label: 'Intereses' },
    { value: 'financiero_otros', label: 'Otros' },
  ],
  materia_prima: [
    { value: 'compra_uva_fresca', label: 'Compra Uva Fresca' },
    { value: 'compra_pasa', label: 'Compra Pasa' },
    { value: 'materia_prima_otros', label: 'Otros' },
  ],
}

export const CLASIFICACION_LABELS: Record<string, string> = Object.values(CLASIFICACIONES_POR_TIPO)
  .flat()
  .reduce<Record<string, string>>((acc, { value, label }) => ({ ...acc, [value]: label }), {})

export async function getEgresos(params: EgresosFilter): Promise<EgresoResponse[]> {
  const { data } = await api.get('/finanzas/egresos/', { params })
  return data
}

export async function createEgreso(data: EgresoCreate): Promise<EgresoResponse> {
  const { data: res } = await api.post('/finanzas/egresos/', data)
  return res
}

export async function updateEgreso(id: string, data: Partial<EgresoCreate>): Promise<EgresoResponse> {
  const { data: res } = await api.put(`/finanzas/egresos/${id}`, data)
  return res
}

export async function deleteEgreso(id: string): Promise<void> {
  await api.delete(`/finanzas/egresos/${id}`)
}

export async function getResumenPorTipo(params: EgresosFilter): Promise<ResumenTipo[]> {
  const { data } = await api.get('/finanzas/egresos/resumen/por-tipo', { params })
  return data
}

export interface EgresosMesItem {
  mes: string
  mes_key: string
  tipo: string
  total: number
}

export interface EgresosPorMesResponse {
  campana: string
  items: EgresosMesItem[]
  tipos_presentes: string[]
}

export async function getEgresosPorMes(anioInicio: number): Promise<EgresosPorMesResponse> {
  const { data } = await api.get<EgresosPorMesResponse>('/finanzas/dashboard/egresos-por-mes', {
    params: { anio_inicio: anioInicio, anio_fin: anioInicio + 1, moneda: 'ars' },
  })
  return data
}
