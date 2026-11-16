import { useCallback, useEffect, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'
import { discard, getFailedItems, retryFailed, type OfflineQueueItem } from '../lib/offlineQueue'
import { processQueue } from '../lib/offlineSync'

interface Props {
  visible: boolean
  onClose: () => void
  onChanged: () => void
}

function etiqueta(endpoint: string): string {
  if (endpoint.startsWith('/maquinaria/')) return 'Reporte de falla'
  if (endpoint.includes('riego')) return 'Registro de riego'
  if (endpoint.includes('tarea')) return 'Registro de tarea'
  return 'Registro'
}

export function FailedQueueSheet({ visible, onClose, onChanged }: Props) {
  const [items, setItems] = useState<OfflineQueueItem[]>([])

  const load = useCallback(async () => {
    setItems(await getFailedItems())
  }, [])

  useEffect(() => {
    if (visible) load()
  }, [visible, load])

  async function reintentar(id: string) {
    await retryFailed(id)
    await load()
    onChanged()
    // Fire and forget: the queue shows the result on its next refresh.
    processQueue().finally(onChanged)
  }

  function descartar(id: string) {
    Alert.alert(
      'Descartar registro',
      'Este registro no se va a enviar al servidor y se pierde. ¿Descartarlo?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Descartar',
          style: 'destructive',
          onPress: async () => {
            await discard(id)
            await load()
            onChanged()
          },
        },
      ],
    )
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title}>Registros que necesitan atención</Text>
        <ScrollView style={styles.list}>
          {items.length === 0 && <Text style={styles.empty}>No quedan registros con error.</Text>}
          {items.map((item) => (
            <View key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>{etiqueta(item.endpoint)}</Text>
              <Text style={styles.meta}>
                {new Date(item.createdAt).toLocaleString('es-AR')}
                {item.lastError ? ` · ${item.lastError}` : ''}
              </Text>
              <View style={styles.actions}>
                <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => reintentar(item.id)}>
                  <Text style={styles.btnPrimaryText}>Reintentar</Text>
                </Pressable>
                <Pressable style={styles.btn} onPress={() => descartar(item.id)}>
                  <Text style={styles.btnText}>Descartar</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
        <Pressable style={styles.close} onPress={onClose}>
          <Text style={styles.btnText}>Cerrar</Text>
        </Pressable>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.hueso,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    maxHeight: '70%',
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  list: { flexGrow: 0 },
  empty: { color: colors.ink60, paddingVertical: 12 },
  card: {
    backgroundColor: colors.blanco,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borde,
    padding: 12,
    marginBottom: 8,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 12, color: colors.ink60, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borde,
  },
  btnPrimary: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  btnPrimaryText: { color: colors.blanco, fontWeight: '600', fontSize: 13 },
  btnText: { color: colors.ink, fontWeight: '600', fontSize: 13 },
  close: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
})
