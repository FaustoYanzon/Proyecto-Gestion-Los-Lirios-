import api from '@/lib/api'

export interface AlertaDescartada {
  alerta_id: string
  tipo: 'completada' | 'cancelada'
}

export async function getAlertasDescartadas(): Promise<AlertaDescartada[]> {
  const { data } = await api.get<AlertaDescartada[]>('/alertas/descartadas')
  return data
}

export async function descartarAlerta(
  alerta_id: string,
  tipo: 'completada' | 'cancelada',
): Promise<AlertaDescartada> {
  const { data } = await api.post<AlertaDescartada>('/alertas/descartar', { alerta_id, tipo })
  return data
}
