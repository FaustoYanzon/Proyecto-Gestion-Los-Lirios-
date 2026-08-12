import api from '@/lib/api'

export interface EnviarNotificacionInput {
  titulo: string
  cuerpo: string
  user_ids?: string[]
}

export interface EnviarNotificacionResponse {
  enviados: number
  expo_status: number
}

export async function enviarNotificacion(data: EnviarNotificacionInput): Promise<EnviarNotificacionResponse> {
  const { data: res } = await api.post('/notificaciones/enviar', data)
  return res
}
