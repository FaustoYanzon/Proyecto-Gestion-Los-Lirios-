import AsyncStorage from '@react-native-async-storage/async-storage'
import { newIdempotencyKey } from './idempotency'

const STORAGE_KEY = 'll_offline_queue'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 días sin poder sincronizar -> failed

export interface OfflineQueueItem {
  id: string
  endpoint: string
  payload: object
  createdAt: string
  retryCount: number
  lastError?: string
  status: 'pending' | 'failed'
}

async function readQueue(): Promise<OfflineQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as OfflineQueueItem[]) : []
  } catch {
    return []
  }
}

async function writeQueue(queue: OfflineQueueItem[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
}

export async function enqueue(endpoint: string, payload: object): Promise<OfflineQueueItem> {
  const item: OfflineQueueItem = {
    id: newIdempotencyKey(),
    endpoint,
    payload,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: 'pending',
  }
  const queue = await readQueue()
  queue.push(item)
  await writeQueue(queue)
  return item
}

export async function getQueue(): Promise<OfflineQueueItem[]> {
  return readQueue()
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await readQueue()
  await writeQueue(queue.filter((item) => item.id !== id))
}

// Sin respuesta del servidor de nuevo: si ya pasaron 7 días desde que se
// encoló, se marca failed en vez de seguir reintentando para siempre (un
// item corrupto o un endpoint roto no debe reintentar indefinidamente sin
// que nadie lo note).
export async function incrementRetry(id: string, error: string): Promise<void> {
  const queue = await readQueue()
  const idx = queue.findIndex((item) => item.id === id)
  if (idx === -1) return
  const item = queue[idx]
  const ageMs = Date.now() - new Date(item.createdAt).getTime()
  queue[idx] = {
    ...item,
    retryCount: item.retryCount + 1,
    lastError: error,
    status: ageMs > MAX_AGE_MS ? 'failed' : 'pending',
  }
  await writeQueue(queue)
}

export async function markFailed(id: string, error: string): Promise<void> {
  const queue = await readQueue()
  const idx = queue.findIndex((item) => item.id === id)
  if (idx === -1) return
  queue[idx] = { ...queue[idx], status: 'failed', lastError: error }
  await writeQueue(queue)
}

export async function getPendingCount(): Promise<number> {
  const queue = await readQueue()
  return queue.filter((item) => item.status === 'pending').length
}

export async function getFailedCount(): Promise<number> {
  const queue = await readQueue()
  return queue.filter((item) => item.status === 'failed').length
}
