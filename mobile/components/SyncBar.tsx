import { useEffect, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, type ViewStyle } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { getPendingCount, getFailedCount } from '../lib/offlineQueue'
import { processQueue } from '../lib/offlineSync'
import { ICONS, ICON_STROKE } from '../lib/icons'

type SyncState = 'ok' | 'offline' | 'syncing' | 'error' | null

const VARIANTS: Record<Exclude<SyncState, null>, { bg: string; fg: string }> = {
  ok:      { bg: '#eef2ed', fg: '#3f5c3a' },
  offline: { bg: '#f7edd8', fg: '#8a6a1f' },
  syncing: { bg: '#eaf0f4', fg: '#3d6b86' },
  error:   { bg: '#fbeced', fg: '#a3293a' },
}

// Barra de 32px, visible SÓLO cuando hay algo que decir — un indicador
// permanente en verde deja de leerse a los dos días y ocupa altura donde
// cada píxel cuenta. Se apoya en lo que lib/offlineQueue.ts ya expone
// (conteos de pendientes/fallidos) y en processQueue de lib/offlineSync.ts
// (ya exportado) para "Reintentar" — no toca la lógica de la cola en sí.
// No existe hoy una forma de reintentar un ítem "failed" puntual (son los
// que ya agotaron 7 días de reintentos y piden revisión manual a propósito,
// ver offlineSync.ts) — "Reintentar" vuelve a procesar los pendientes.
export function SyncBar({ style }: { style?: ViewStyle }) {
  const [state, setState] = useState<SyncState>(null)
  const [pending, setPending] = useState(0)
  const wasPendingOrOffline = useRef(false)
  const okTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let mounted = true

    async function check() {
      const [p, f] = await Promise.all([getPendingCount(), getFailedCount()])
      const net = await NetInfo.fetch()
      if (!mounted) return
      setPending(p)

      if (f > 0) {
        setState('error')
        wasPendingOrOffline.current = true
        return
      }
      if (!net.isConnected) {
        setState('offline')
        wasPendingOrOffline.current = true
        return
      }
      if (p > 0) {
        setState('syncing')
        wasPendingOrOffline.current = true
        return
      }
      if (wasPendingOrOffline.current) {
        setState('ok')
        wasPendingOrOffline.current = false
        if (okTimeout.current) clearTimeout(okTimeout.current)
        okTimeout.current = setTimeout(() => setState(null), 3000)
      } else {
        setState(null)
      }
    }

    check()
    const interval = setInterval(check, 5000)
    const unsubscribe = NetInfo.addEventListener(check)
    return () => {
      mounted = false
      clearInterval(interval)
      unsubscribe()
      if (okTimeout.current) clearTimeout(okTimeout.current)
    }
  }, [])

  if (!state) return null
  const v = VARIANTS[state]

  return (
    <View style={[styles.bar, { backgroundColor: v.bg }, style]}>
      {state === 'syncing' && <ICONS.refrescar size={14} color={v.fg} strokeWidth={ICON_STROKE} />}
      {state === 'offline' && <ICONS.desconectado size={14} color={v.fg} strokeWidth={ICON_STROKE} />}
      {state === 'error' && <ICONS.aviso size={14} color={v.fg} strokeWidth={ICON_STROKE} />}
      {state === 'ok' && <ICONS.completado size={14} color={v.fg} strokeWidth={ICON_STROKE} />}
      <Text style={[styles.text, { color: v.fg }]} numberOfLines={1}>
        {state === 'ok' && 'Todo sincronizado'}
        {state === 'offline' && `Sin conexión${pending > 0 ? ` · ${pending} en cola` : ''}`}
        {state === 'syncing' && `Sincronizando ${pending} registro${pending === 1 ? '' : 's'}...`}
        {state === 'error' && 'No se pudo sincronizar'}
      </Text>
      {state === 'error' && (
        <TouchableOpacity onPress={() => processQueue()} hitSlop={8}>
          <Text style={[styles.retry, { color: v.fg }]}>Reintentar</Text>
        </TouchableOpacity>
      )}
      {state === 'syncing' && <View style={[styles.progress, { backgroundColor: v.fg }]} />}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    height: 32, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14,
  },
  text: { fontSize: 12, fontWeight: '600', flex: 1 },
  retry: { fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
  progress: {
    position: 'absolute', left: 0, bottom: 0, height: 2, width: '40%', opacity: 0.5,
  },
})
