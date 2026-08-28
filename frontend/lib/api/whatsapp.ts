import api from '@/lib/api'
import type { EgresoResponse } from '@/lib/api/egresos'

export type EstadoMensajeWhatsapp = 'pendiente' | 'clasificado' | 'descartado'

export interface MensajeWhatsappResponse {
  id: string
  telefono: string
  user_id: string
  texto_original: string
  monto: number
  descripcion: string
  pagado: boolean
  foto_url: string | null
  estado: EstadoMensajeWhatsapp
  egreso_id: string | null
  clasificado_por: string | null
  clasificado_at: string | null
  recibido_at: string
  created_at: string
}

export interface ClasificarEgresoWhatsappRequest {
  tipo: string
  clasificacion: string
  finca: 'los_mimbres' | 'media_agua' | 'caucete'
  forma_pago: 'efectivo' | 'transferencia' | 'cheque' | 'echeque' | 'credito'
  parcela_id?: string
  descripcion?: string
}

export async function getPendientesWhatsapp(
  estado: EstadoMensajeWhatsapp = 'pendiente'
): Promise<MensajeWhatsappResponse[]> {
  const { data } = await api.get('/finanzas/whatsapp/pendientes', { params: { estado } })
  return data
}

export async function clasificarComoEgreso(
  mensajeId: string,
  data: ClasificarEgresoWhatsappRequest
): Promise<EgresoResponse> {
  const { data: res } = await api.post(`/finanzas/whatsapp/${mensajeId}/clasificar-egreso`, data)
  return res
}

export async function descartarMensajeWhatsapp(mensajeId: string): Promise<void> {
  await api.post(`/finanzas/whatsapp/${mensajeId}/descartar`)
}

export async function restaurarMensajeWhatsapp(mensajeId: string): Promise<MensajeWhatsappResponse> {
  const { data } = await api.post(`/finanzas/whatsapp/${mensajeId}/restaurar`)
  return data
}

export async function eliminarMensajeWhatsapp(mensajeId: string): Promise<void> {
  await api.delete(`/finanzas/whatsapp/${mensajeId}`)
}
