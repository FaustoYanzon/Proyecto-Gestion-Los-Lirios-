import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  StyleSheet,
  TextInput,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import api from '../lib/api'
import type { EstadoFenologico } from '../lib/types'
import { ESTADO_LABELS, ESTADO_COLORS } from '../lib/types'

const ESTADOS: EstadoFenologico[] = [
  'brotacion', 'floracion', 'cuaje', 'envero', 'madurez', 'cosecha', 'latencia',
]

interface EstadoActual {
  id: string
  parcela_id: string
  parcela_nombre: string
  anio: number
  estado_fenologico: EstadoFenologico
  fecha_estado: string
}

// ─── Update Modal ─────────────────────────────────────────────────────────────

function UpdateModal({
  visible,
  parcelaId,
  parcelaNombre,
  currentEstado,
  onClose,
  onUpdated,
}: {
  visible: boolean
  parcelaId: string
  parcelaNombre: string
  currentEstado: EstadoFenologico
  onClose: () => void
  onUpdated: () => void
}) {
  const [estado, setEstado] = useState<EstadoFenologico>(currentEstado)
  const [observaciones, setObservaciones] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (visible) {
      setEstado(currentEstado)
      setObservaciones('')
    }
  }, [visible, currentEstado])

  async function handleSave() {
    try {
      setLoading(true)
      const today = new Date().toISOString().split('T')[0]
      const anio = new Date().getMonth() >= 4
        ? new Date().getFullYear()
        : new Date().getFullYear() - 1
      await api.post('/produccion/campana/', {
        parcela_id: parcelaId,
        anio,
        fecha_estado: today,
        estado_fenologico: estado,
        observaciones: observaciones.trim() || null,
      })
      onUpdated()
      onClose()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', typeof detail === 'string' ? detail : 'No se pudo actualizar el estado.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{parcelaNombre}</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color="#374151" />
          </TouchableOpacity>
        </View>

        <Text style={styles.modalSubtitle}>Seleccioná el estado fenológico actual</Text>

        <ScrollView style={{ flex: 1 }}>
          {ESTADOS.map((e) => {
            const isSelected = estado === e
            return (
              <TouchableOpacity
                key={e}
                style={[
                  styles.estadoOption,
                  isSelected && { borderColor: ESTADO_COLORS[e], backgroundColor: `${ESTADO_COLORS[e]}12` },
                ]}
                onPress={() => setEstado(e)}
              >
                <View style={[styles.estadoDot, { backgroundColor: ESTADO_COLORS[e] }]} />
                <Text style={[styles.estadoLabel, isSelected && { color: ESTADO_COLORS[e], fontWeight: '700' }]}>
                  {ESTADO_LABELS[e]}
                </Text>
                {isSelected && <Ionicons name="checkmark" size={18} color={ESTADO_COLORS[e]} />}
              </TouchableOpacity>
            )
          })}

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>
            Observaciones (opcional)
          </Text>
          <TextInput
            style={styles.textArea}
            value={observaciones}
            onChangeText={setObservaciones}
            placeholder="Notas adicionales sobre el estado..."
            placeholderTextColor="#9ca3af"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </ScrollView>

        <View style={styles.modalActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveBtn, loading && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Guardar</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function EstadoCampanaScreen() {
  const [estados, setEstados] = useState<EstadoActual[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<EstadoActual | null>(null)

  const loadData = useCallback(async () => {
    try {
      const { data } = await api.get<EstadoActual[]>('/produccion/campana/estado-actual/')
      setEstados(data)
    } catch {
      /* offline or error */
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  function onRefresh() {
    setRefreshing(true)
    loadData()
  }

  // Group by estado for summary
  const summary = ESTADOS.reduce<Record<string, number>>((acc, e) => {
    acc[e] = estados.filter((est) => est.estado_fenologico === e).length
    return acc
  }, {})

  return (
    <>
      {selected && (
        <UpdateModal
          visible={!!selected}
          parcelaId={selected.parcela_id}
          parcelaNombre={selected.parcela_nombre}
          currentEstado={selected.estado_fenologico}
          onClose={() => setSelected(null)}
          onUpdated={loadData}
        />
      )}

      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
      >
        {/* Summary chips */}
        <View style={styles.summaryRow}>
          {ESTADOS.filter((e) => (summary[e] ?? 0) > 0).map((e) => (
            <View
              key={e}
              style={[styles.summaryChip, { backgroundColor: `${ESTADO_COLORS[e]}20`, borderColor: ESTADO_COLORS[e] }]}
            >
              <Text style={[styles.summaryChipText, { color: ESTADO_COLORS[e] }]}>
                {ESTADO_LABELS[e]}: {summary[e]}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>
          {estados.length} parrales activos
        </Text>

        {loading ? (
          <ActivityIndicator color="#16a34a" style={{ marginTop: 32 }} />
        ) : estados.length === 0 ? (
          <Text style={styles.emptyText}>No hay parrales en el sistema</Text>
        ) : (
          estados.map((item) => {
            const color = ESTADO_COLORS[item.estado_fenologico]
            const label = ESTADO_LABELS[item.estado_fenologico]

            return (
              <TouchableOpacity
                key={item.parcela_id}
                style={styles.parcelaCard}
                onPress={() => setSelected(item)}
                activeOpacity={0.8}
              >
                <View style={styles.cardLeft}>
                  <View style={[styles.estadoBadge, { backgroundColor: `${color}20` }]}>
                    <View style={[styles.badgeDot, { backgroundColor: color }]} />
                    <Text style={[styles.badgeText, { color }]}>{label}</Text>
                  </View>
                  <Text style={styles.parcelaNombre}>{item.parcela_nombre}</Text>
                  <Text style={styles.ultimaActualizacion}>
                    Actualizado: {item.fecha_estado}
                  </Text>
                </View>
                <Ionicons name="create-outline" size={20} color="#9ca3af" />
              </TouchableOpacity>
            )
          })
        )}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  summaryChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  summaryChipText: { fontSize: 12, fontWeight: '600' },
  parcelaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardLeft: { flex: 1 },
  estadoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  parcelaNombre: { fontSize: 16, fontWeight: '700', color: '#111827' },
  ultimaActualizacion: { fontSize: 11, color: '#9ca3af', marginTop: 4 },
  emptyText: { color: '#9ca3af', textAlign: 'center', paddingVertical: 32 },
  // Modal styles
  modalContainer: { flex: 1, backgroundColor: '#f9fafb', padding: 20 },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#111827' },
  modalSubtitle: { fontSize: 14, color: '#6b7280', marginBottom: 16 },
  estadoOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    marginBottom: 8,
  },
  estadoDot: { width: 14, height: 14, borderRadius: 7 },
  estadoLabel: { flex: 1, fontSize: 16, color: '#374151' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  textArea: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    padding: 12,
    fontSize: 15,
    color: '#111827',
    minHeight: 80,
    marginBottom: 16,
  },
  modalActions: { flexDirection: 'row', gap: 12, paddingTop: 8 },
  cancelBtn: {
    flex: 1,
    height: 50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: { color: '#374151', fontSize: 15, fontWeight: '600' },
  saveBtn: {
    flex: 2,
    height: 50,
    backgroundColor: '#16a34a',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
