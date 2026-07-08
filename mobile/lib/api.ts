import axios from 'axios'
import * as SecureStore from 'expo-secure-store'

export const TOKEN_KEY = 'loslirios_token'
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.100.216:8000'

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
})

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await SecureStore.deleteItemAsync(TOKEN_KEY)
      // Navigation handled by auth store watcher
    }
    return Promise.reject(error)
  }
)

export default api

// ─── Cosecha ──────────────────────────────────────────────────────────────────

import type { RegistroCosecha, RegistroCosechaCreate } from './types'

export async function getCosechas(params?: {
  temporada?: number
  limit?: number
}): Promise<RegistroCosecha[]> {
  const { data } = await api.get<RegistroCosecha[]>('/produccion/cosecha/', { params })
  return data
}

export async function createCosecha(payload: RegistroCosechaCreate): Promise<RegistroCosecha> {
  const { data } = await api.post<RegistroCosecha>('/produccion/cosecha/', payload)
  return data
}

export async function deleteCosecha(id: string): Promise<void> {
  await api.delete(`/produccion/cosecha/${id}`)
}
