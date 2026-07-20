import AsyncStorage from '@react-native-async-storage/async-storage'

const PREFIX = 'll_cache_'

interface CacheEntry<T> {
  data: T
  ts: number
}

export const CACHE_TTL = {
  parcelas: 60 * 60 * 1000,  // 1 hora
  estados: 15 * 60 * 1000,   // 15 min
  tareas: 15 * 60 * 1000,
  riegos: 15 * 60 * 1000,
  fitosanitarios: 15 * 60 * 1000,
  kpis: 15 * 60 * 1000,
  fenologia: 6 * 60 * 60 * 1000, // 6 horas: cambia una vez por día como mucho
}

export async function getCache<T>(key: string, ttlMs: number): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<T>
    if (Date.now() - entry.ts > ttlMs) return null
    return entry.data
  } catch {
    return null
  }
}

export async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() }))
  } catch { /* non-critical */ }
}

export async function getCacheAgeMin(key: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<unknown>
    return Math.floor((Date.now() - entry.ts) / 60000)
  } catch {
    return null
  }
}
