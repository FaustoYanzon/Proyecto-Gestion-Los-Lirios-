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
      localStorage.removeItem('access_token')
      document.cookie = 'auth_token=; Max-Age=0; path=/'
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
