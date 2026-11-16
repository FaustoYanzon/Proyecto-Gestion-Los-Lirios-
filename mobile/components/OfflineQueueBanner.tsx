import { useCallback, useState } from 'react'
import { View, Text, StyleSheet, Pressable } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { ICONS, ICON_STROKE } from '../lib/icons'
import { getPendingCount, getFailedCount } from '../lib/offlineQueue'
import { colors } from '../lib/theme'
import { FailedQueueSheet } from './FailedQueueSheet'

// Shows how many records are saved locally (offline when confirmed) and how
// many exhausted their retries; tapping the failed row opens a sheet to retry
// or discard them (no editing: a wrong record is discarded and re-entered).
export function OfflineQueueBanner() {
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)

  const refresh = useCallback(() => {
    getPendingCount().then(setPending)
    getFailedCount().then(setFailed)
  }, [])

  useFocusEffect(
    useCallback(() => {
      refresh()
      const interval = setInterval(refresh, 10000)
      return () => clearInterval(interval)
    }, [refresh])
  )

  if (pending === 0 && failed === 0) return null

  return (
    <View style={styles.container}>
      {pending > 0 && (
        <View style={styles.row}>
          <ICONS.subir size={16} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />
          <Text style={styles.text}>
            {pending} {pending === 1 ? 'registro pendiente' : 'registros pendientes'} de sincronizar
          </Text>
        </View>
      )}
      {failed > 0 && (
        <Pressable style={styles.row} onPress={() => setSheetOpen(true)} accessibilityRole="button">
          <ICONS.aviso size={16} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />
          <Text style={styles.text}>
            {failed} {failed === 1 ? 'registro necesita' : 'registros necesitan'} atención
          </Text>
        </Pressable>
      )}
      <FailedQueueSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} onChanged={refresh} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.crema,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.burdeos[200],
    padding: 10,
    marginBottom: 12,
    gap: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { fontSize: 13, fontWeight: '600', color: colors.burdeos[600] },
})
