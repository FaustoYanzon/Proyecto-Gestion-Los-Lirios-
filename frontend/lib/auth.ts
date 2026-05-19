import api from './api'

export type UserRole = 'super_admin' | 'gerencial' | 'encargado' | 'regador' | 'obrero'

export interface User {
  id: string
  email: string
  full_name: string
  role: UserRole
  is_active: boolean
  created_at: string
}

export interface AuthResponse {
  access_token: string
  token_type: string
}

const TOKEN_KEY = 'access_token'
const COOKIE_NAME = 'auth_token'

export async function login(email: string, password: string): Promise<User> {
  const params = new URLSearchParams()
  params.append('username', email)
  params.append('password', password)

  const { data } = await api.post<AuthResponse>('/auth/login', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  localStorage.setItem(TOKEN_KEY, data.access_token)
  document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${60 * 60 * 24 * 7}`

  return getMe()
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>('/auth/me')
  return data
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY)
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; path=/`
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function isAuthenticated(): boolean {
  return !!getToken()
}
