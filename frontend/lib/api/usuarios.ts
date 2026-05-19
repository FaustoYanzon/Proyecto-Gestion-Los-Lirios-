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

export interface UserResponse {
  id: string
  email: string
  full_name: string
  role: UserRole
  is_active: boolean
  created_at: string
}

export interface UserCreate {
  email: string
  full_name: string
  role: UserRole
  password: string
}

export interface UserUpdate {
  full_name?: string
  role?: UserRole
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
