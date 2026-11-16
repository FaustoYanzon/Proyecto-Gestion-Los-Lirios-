import NetInfo from '@react-native-community/netinfo'
import { AppState, type AppStateStatus } from 'react-native'
import api from './api'
import { getQueue, removeFromQueue, incrementRetry, markFailed, type OfflineQueueItem } from './offlineQueue'

let syncing = false
// A call made while a sync is running (e.g. manual retry) must not be dropped:
// the in-flight loop works on an older snapshot of the queue.
let rerun = false

const TRANSIENT_STATUS = new Set([408, 429, 502, 503, 504])

async function processItem(item: OfflineQueueItem): Promise<void> {
  try {
    await api.post(item.endpoint, item.payload)
    await removeFromQueue(item.id)
  } catch (e: unknown) {
    const err = e as { response?: { status?: number } }
    const status = err.response?.status
    // Maquinaria reports carry an idempotency_key, so retrying after a transient
    // gateway error (e.g. Railway restart) cannot duplicate the order. Other
    // endpoints may not be idempotent: they keep the strict behavior below.
    const transient = status !== undefined && TRANSIENT_STATUS.has(status)
    if (err.response && transient && item.endpoint.startsWith('/maquinaria/')) {
      await incrementRetry(item.id, `HTTP ${status}`)
    } else if (err.response) {
      // El servidor respondió con un error real (ej. la parcela referenciada
      // ya no existe) — reintentar no lo va a arreglar solo, necesita
      // revisión manual.
      await markFailed(item.id, `HTTP ${err.response.status ?? '?'}`)
    } else {
      await incrementRetry(item.id, 'sin respuesta del servidor')
    }
  }
}

export async function processQueue(): Promise<void> {
  if (syncing) {
    rerun = true
    return
  }
  syncing = true
  try {
    do {
      rerun = false
      const queue = await getQueue()
      const pending = queue.filter((item) => item.status === 'pending')
      // FIFO: uno a la vez, en el orden en que se encolaron.
      for (const item of pending) {
        await processItem(item)
      }
    } while (rerun)
  } finally {
    syncing = false
  }
}

// Se inicializa una sola vez desde app/_layout.tsx. Dos disparadores
// independientes porque ninguno solo alcanza de forma confiable: NetInfo
// avisa cuando vuelve la señal, pero si la app estaba en background cuando
// volvió, conviene reintentar también al volver a foreground.
export function initOfflineSync(): () => void {
  const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    if (state.isConnected) processQueue()
  })

  const onAppStateChange = (status: AppStateStatus) => {
    if (status === 'active') processQueue()
  }
  const appStateSub = AppState.addEventListener('change', onAppStateChange)

  processQueue()

  return () => {
    unsubscribeNetInfo()
    appStateSub.remove()
  }
}
