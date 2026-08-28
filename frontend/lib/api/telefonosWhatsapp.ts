import api from '@/lib/api'

export interface TelefonoUsuarioWhatsappResponse {
  id: string
  telefono: string
  user_id: string
  created_by: string
  created_at: string
}

export async function listTelefonosWhatsapp(): Promise<TelefonoUsuarioWhatsappResponse[]> {
  const { data } = await api.get('/admin/telefonos-whatsapp/')
  return data
}

export async function vincularTelefonoWhatsapp(data: {
  telefono: string
  user_id: string
}): Promise<TelefonoUsuarioWhatsappResponse> {
  const { data: res } = await api.post('/admin/telefonos-whatsapp/', data)
  return res
}

export async function desvincularTelefonoWhatsapp(id: string): Promise<void> {
  await api.delete(`/admin/telefonos-whatsapp/${id}`)
}
