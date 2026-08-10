import NetInfo from '@react-native-community/netinfo'
import { AppState, type AppStateStatus } from 'react-native'
import api from './api'
import { getQueue, removeFromQueue, incrementRetry, markFailed, type OfflineQueueItem } from './offlineQueue'

let syncing = false

async function processItem(item: OfflineQueueItem): Promise<void> {
  try {
    await api.post(item.endpoint, item.payload)
    await removeFromQueue(item.id)
  } catch (e: unknown) {
    const err = e as { response?: { status?: number } }
    if (err.response) {
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
  if (syncing) return
  syncing = true
  try {
    const queue = await getQueue()
    const pending = queue.filter((item) => item.status === 'pending')
    // FIFO: uno a la vez, en el orden en que se encolaron.
    for (const item of pending) {
      await processItem(item)
    }
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
