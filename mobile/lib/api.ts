import axios from 'axios'
import * as SecureStore from 'expo-secure-store'

export const TOKEN_KEY = 'loslirios_token'
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

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // No response at all means the request never reached the server (dropped
    // connection, DNS hiccup, momentary wifi flake) — retry once before
    // surfacing it, since these are usually transient on mobile networks.
    if (!error.response && !error.config?._retried) {
      error.config._retried = true
      return api(error.config)
    }
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
