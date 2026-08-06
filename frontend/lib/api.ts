import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
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
  const refreshToken = localStorage.getItem('refresh_token')
  if (!refreshToken) return null
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_URL}/auth/refresh`, { refresh_token: refreshToken })
      .then(({ data }) => {
        localStorage.setItem('access_token', data.access_token)
        return data.access_token as string
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

function logoutAndRedirect() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  document.cookie = 'auth_token=; Max-Age=0; path=/'
  window.location.href = '/login'
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // No response at all can mean the request never reached the server, or that
    // it did and only the response got lost on the way back — auto-retrying is
    // only safe for GET, or for a write that carries an idempotency_key (the
    // backend recognizes the key and returns the record it already created
    // instead of duplicating it). See mobile/lib/api.ts for the incident that
    // motivated this (2026-07-29 — a form showed a false "no se pudo guardar"
    // error on a write that had actually gone through).
    const method = error.config?.method?.toLowerCase()
    const retryable = method === 'get' || (method !== 'get' && hasIdempotencyKey(error.config))
    if (!error.response && !error.config?._retried && retryable) {
      error.config._retried = true
      return api(error.config)
    }
    if (error.response?.status === 401 && typeof window !== 'undefined') {
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
      logoutAndRedirect()
    }
    return Promise.reject(error)
  }
)

export default api
