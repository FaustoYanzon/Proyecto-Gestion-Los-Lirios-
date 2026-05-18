import * as SecureStore from 'expo-secure-store'
import api, { TOKEN_KEY } from './api'
import type { User } from './types'

export async function login(email: string, password: string): Promise<User> {
  const form = new FormData()
  form.append('username', email)
  form.append('password', password)

  const { data } = await api.post('/auth/login', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

  await SecureStore.setItemAsync(TOKEN_KEY, data.access_token)

  const { data: user } = await api.get<User>('/auth/me')
  return user
}

export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}

export async function fetchCurrentUser(): Promise<User | null> {
  try {
    const token = await SecureStore.getItemAsync(TOKEN_KEY)
    if (!token) return null
    const { data } = await api.get<User>('/auth/me')
    return data
  } catch {
    return null
  }
}
