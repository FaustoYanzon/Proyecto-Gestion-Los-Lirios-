import axios from 'axios'
import * as SecureStore from 'expo-secure-store'

export const TOKEN_KEY = 'loslirios_token'
export const REFRESH_TOKEN_KEY = 'loslirios_refresh_token'
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://192.168.0.111:8000'

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
})

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

function hasIdempotencyKey(config: import('axios').InternalAxiosRequestConfig | undefined): boolean {
  if (!config?.data) return false
  try {
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data
    return typeof body?.idempotency_key === 'string' && body.idempotency_key.length > 0
  } catch {
    return false
  }
}

// Single-flight: concurrent 401s while the access token is expired share one
// POST /auth/refresh instead of each firing its own. Bare axios (not `api`)
// on purpose — avoids recursing back through these same interceptors.
let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
  if (!refreshToken) return null
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_BASE}/auth/refresh`, { refresh_token: refreshToken })
      .then(async ({ data }) => {
        await SecureStore.setItemAsync(TOKEN_KEY, data.access_token)
        return data.access_token as string
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // No response at all can mean the request never reached the server (dropped
    // connection, DNS hiccup, momentary wifi flake) — but it can also mean a
    // timeout where the request DID reach the server and was processed, and only
    // the response got lost on the way back. Auto-retrying is only safe for
    // idempotent methods (GET) — retrying a plain POST here could silently
    // create a duplicate if the original write already succeeded. A write that
    // carries an idempotency_key is also safe to retry: the backend recognizes
    // the key and returns the record it already created instead of duplicating
    // it (2026-07-29, confirmed against a real "response lost, save actually
    // succeeded" case — the form was showing a false error on a write that had
    // gone through fine).
    const method = error.config?.method?.toLowerCase()
    const retryable = method === 'get' || (method !== 'get' && hasIdempotencyKey(error.config))
    if (!error.response && !error.config?._retried && retryable) {
      error.config._retried = true
      return api(error.config)
    }
    if (error.response?.status === 401) {
      const url = error.config?.url
      const isAuthEndpoint = url === '/auth/login' || url === '/auth/refresh'
      if (!isAuthEndpoint && !error.config?._refreshed) {
        error.config._refreshed = true
        const newToken = await refreshAccessToken()
        if (newToken) {
          error.config.headers.Authorization = `Bearer ${newToken}`
          return api(error.config)
        }
      }
      await SecureStore.deleteItemAsync(TOKEN_KEY)
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)
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

// ─── Riego en curso ───────────────────────────────────────────────────────────

import type { RiegoEnCurso, RiegoIniciarPayload } from './types'

export async function getRiegosEnCurso(): Promise<RiegoEnCurso[]> {
  const { data } = await api.get<RiegoEnCurso[]>('/produccion/riego/en-curso')
  return data
}

export async function iniciarRiego(payload: RiegoIniciarPayload): Promise<RiegoEnCurso> {
  const { data } = await api.post<RiegoEnCurso>('/produccion/riego/iniciar', payload)
  return data
}

export async function terminarRiego(id: string): Promise<void> {
  await api.post(`/produccion/riego/${id}/terminar`, {})
}

// ─── Estado de Campaña (calendario único) ─────────────────────────────────────

import type {
  CumplimientoRiegoParcela, EstadoActualVariedad, EstadoVariedadCampanaPayload,
} from './types'

export async function getEstadoCampanaActual(): Promise<EstadoActualVariedad[]> {
  const { data } = await api.get<EstadoActualVariedad[]>('/produccion/estado-campana/actual')
  return data
}

export async function getCumplimientoRiego(): Promise<CumplimientoRiegoParcela[]> {
  const { data } = await api.get<CumplimientoRiegoParcela[]>(
    '/produccion/estado-campana/cumplimiento-riego',
  )
  return data
}

export async function postEstadoVariedadCampana(
  payload: EstadoVariedadCampanaPayload,
): Promise<void> {
  await api.post('/produccion/estado-campana/', payload)
}
