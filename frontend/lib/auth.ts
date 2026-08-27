import api from './api'

export type UserRole = 'super_admin' | 'gerencial' | 'encargado' | 'regador' | 'obrero'

export interface User {
  id: string
  email: string
  username: string
  full_name: string
  role: UserRole
  is_active: boolean
  created_at: string
  avatar_url: string | null
  birth_day: number | null
  birth_month: number | null
  birth_year: number | null
}

export interface AuthResponse {
  access_token: string
  token_type: string
  refresh_token: string
}

const TOKEN_KEY = 'access_token'
const REFRESH_TOKEN_KEY = 'refresh_token'
const COOKIE_NAME = 'auth_token'
// "Recordarme" solo prellena el usuario tipeado la próxima vez — nunca la
// contraseña. No tiene relación con la duración de la sesión (eso lo maneja
// el refresh token).
const REMEMBERED_USERNAME_KEY = 'remembered_username'
// Debe seguir de cerca a REFRESH_TOKEN_EXPIRE_DAYS del backend — esta cookie
// solo le dice al proxy si hay sesión, el refresh silencioso (lib/api.ts) es
// lo que de verdad mantiene la sesión viva mientras el refresh token no venza.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export async function login(username: string, password: string): Promise<User> {
  const params = new URLSearchParams()
  params.append('username', username)
  params.append('password', password)

  const { data } = await api.post<AuthResponse>('/auth/login', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  localStorage.setItem(TOKEN_KEY, data.access_token)
  localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token)
  document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${COOKIE_MAX_AGE}`

  return getMe()
}

export function getRememberedUsername(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(REMEMBERED_USERNAME_KEY)
}

export function setRememberedUsername(username: string | null): void {
  if (username) {
    localStorage.setItem(REMEMBERED_USERNAME_KEY, username)
  } else {
    localStorage.removeItem(REMEMBERED_USERNAME_KEY)
  }
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>('/auth/me')
  return data
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; path=/`
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function isAuthenticated(): boolean {
  return !!getToken()
}
