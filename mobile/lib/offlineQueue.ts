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

// Every mutation is a read-modify-write of the whole array; without
// serialization, a manual retry/discard racing the sync loop can write back a
// stale snapshot and resurrect an already-processed item (duplicate POST).
let chain: Promise<unknown> = Promise.resolve()
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
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

export function enqueue(endpoint: string, payload: object): Promise<OfflineQueueItem> {
  return withLock(async () => {
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
  })
}

export async function getQueue(): Promise<OfflineQueueItem[]> {
  return readQueue()
}

export function removeFromQueue(id: string): Promise<void> {
  return withLock(async () => {
    const queue = await readQueue()
    await writeQueue(queue.filter((item) => item.id !== id))
  })
}

// Sin respuesta del servidor de nuevo: si ya pasaron 7 días desde que se
// encoló, se marca failed en vez de seguir reintentando para siempre (un
// item corrupto o un endpoint roto no debe reintentar indefinidamente sin
// que nadie lo note).
export function incrementRetry(id: string, error: string): Promise<void> {
  return withLock(async () => {
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
  })
}

export function markFailed(id: string, error: string): Promise<void> {
  return withLock(async () => {
    const queue = await readQueue()
    const idx = queue.findIndex((item) => item.id === id)
    if (idx === -1) return
    queue[idx] = { ...queue[idx], status: 'failed', lastError: error }
    await writeQueue(queue)
  })
}

export async function getPendingCount(): Promise<number> {
  const queue = await readQueue()
  return queue.filter((item) => item.status === 'pending').length
}

export async function getFailedCount(): Promise<number> {
  const queue = await readQueue()
  return queue.filter((item) => item.status === 'failed').length
}

export async function getFailedItems(): Promise<OfflineQueueItem[]> {
  const queue = await readQueue()
  return queue.filter((item) => item.status === 'failed')
}

// Manual retry of an item the server rejected or that aged out. Only acts on
// failed items so it can never resurrect one that was already processed.
export function retryFailed(id: string): Promise<void> {
  return withLock(async () => {
    const queue = await readQueue()
    const idx = queue.findIndex((item) => item.id === id && item.status === 'failed')
    if (idx === -1) return
    const { lastError: _lastError, ...rest } = queue[idx]
    // createdAt resets too, otherwise an item that aged out would fail again at once
    queue[idx] = { ...rest, status: 'pending', retryCount: 0, createdAt: new Date().toISOString() }
    await writeQueue(queue)
  })
}

// Drops an item the user chose not to resend; no-op if it no longer exists.
export async function discard(id: string): Promise<void> {
  await removeFromQueue(id)
}
