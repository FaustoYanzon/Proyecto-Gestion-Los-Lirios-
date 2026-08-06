import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import api, { TOKEN_KEY, REFRESH_TOKEN_KEY } from './api'
import type { User } from './types'

// "Recordar usuario" solo prellena el campo la próxima vez — nunca la
// contraseña. No es sensible, por eso AsyncStorage alcanza (no SecureStore).
const REMEMBERED_USERNAME_KEY = 'll_remembered_username'

export async function login(username: string, password: string): Promise<User> {
  const form = new FormData()
  form.append('username', username)
  form.append('password', password)

  const { data } = await api.post('/auth/login', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })

  await SecureStore.setItemAsync(TOKEN_KEY, data.access_token)
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refresh_token)

  const { data: user } = await api.get<User>('/auth/me')
  return user
}

export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY)
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)
}

export async function getRememberedUsername(): Promise<string | null> {
  return AsyncStorage.getItem(REMEMBERED_USERNAME_KEY)
}

export async function setRememberedUsername(username: string | null): Promise<void> {
  if (username) {
    await AsyncStorage.setItem(REMEMBERED_USERNAME_KEY, username)
  } else {
    await AsyncStorage.removeItem(REMEMBERED_USERNAME_KEY)
  }
}

export async function hasStoredSession(): Promise<boolean> {
  return (await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)) !== null
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
