import api from '@/lib/api'

export const ROLE_VALUES = ['super_admin', 'gerencial', 'encargado', 'regador', 'obrero'] as const
export type UserRole = (typeof ROLE_VALUES)[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  gerencial: 'Gerencial',
  encargado: 'Encargado',
  regador: 'Regador',
  obrero: 'Obrero',
}

// Sin Caucete — misma finca vieja/de prueba que se sacó de los demás selectores.
export const USER_FINCA_VALUES = ['los_mimbres', 'media_agua'] as const
export type UserFinca = (typeof USER_FINCA_VALUES)[number]

export const USER_FINCA_LABELS: Record<UserFinca, string> = {
  los_mimbres: 'Los Mimbres',
  media_agua: 'Media Agua',
}

export interface UserResponse {
  id: string
  email: string
  username: string
  full_name: string
  role: UserRole
  finca: UserFinca
  is_active: boolean
  created_at: string
  avatar_url: string | null
  birth_day: number | null
  birth_month: number | null
  birth_year: number | null
}

export interface UserCreate {
  email: string
  username: string
  full_name: string
  role: UserRole
  finca: UserFinca
  password: string
}

export interface UserUpdate {
  email?: string
  username?: string
  full_name?: string
  role?: UserRole
  finca?: UserFinca
  is_active?: boolean
  password?: string
}

export async function listUsers(): Promise<UserResponse[]> {
  const { data } = await api.get('/users/')
  return data
}

export async function createUser(data: UserCreate): Promise<UserResponse> {
  const { data: res } = await api.post('/auth/register', data)
  return res
}

export async function updateUser(id: string, data: UserUpdate): Promise<UserResponse> {
  const { data: res } = await api.put(`/users/${id}`, data)
  return res
}

export async function deactivateUser(id: string): Promise<UserResponse> {
  const { data: res } = await api.delete(`/users/${id}`)
  return res
}

export async function uploadMyAvatar(file: File): Promise<UserResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const { data } = await api.post('/users/me/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

export async function updateMyBirthday(payload: {
  birth_day: number | null
  birth_month: number | null
  birth_year: number | null
}): Promise<UserResponse> {
  const { data } = await api.patch('/auth/me/cumpleanos', payload)
  return data
}
