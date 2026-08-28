import { useCallback, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { ICONS, ICON_STROKE } from '../lib/icons'
import { getPendingCount, getFailedCount } from '../lib/offlineQueue'
import { colors } from '../lib/theme'

// Solo lectura: muestra cuántos registros quedaron guardados localmente
// (sin conexión al confirmar) y cuántos ya agotaron los reintentos. No
// permite editar/borrar desde acá — decisión tomada para mantener esto simple.
export function OfflineQueueBanner() {
  const [pending, setPending] = useState(0)
  const [failed, setFailed] = useState(0)

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
        <View style={styles.row}>
          <ICONS.aviso size={16} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />
          <Text style={styles.text}>
            {failed} {failed === 1 ? 'registro necesita' : 'registros necesitan'} atención
          </Text>
        </View>
      )}
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
