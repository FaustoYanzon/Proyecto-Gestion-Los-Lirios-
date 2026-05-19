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
  id: string | null
  parcela_id: string
  parcela_nombre: string
  anio: number | null
  estado_fenologico: EstadoFenologico | null
  fecha_estado: string | null
}

// ─── Update Modal ─────────────────────────────────────────────────────────────

function UpdateModal({
  visible, parcelaId, parcelaNombre, currentEstado, onClose, onUpdated,
}: {
  visible: boolean; parcelaId: string; parcelaNombre: string
  currentEstado: EstadoFenologico; onClose: () => void; onUpdated: () => void
}) {
  const [estado, setEstado] = useState<EstadoFenologico>(currentEstado)
  const [observaciones, setObservaciones] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (visible) { setEstado(currentEstado); setObservaciones('') }
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
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle}>{parcelaNombre}</Text>
            <Text style={styles.modalSubtitle}>Seleccioná el estado fenológico actual</Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={18} color="#374151" />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          {ESTADOS.map((e) => {
            const isSelected = estado === e
            const color = ESTADO_COLORS[e]
            return (
              <TouchableOpacity
                key={e}
                style={[
                  styles.estadoOption,
                  isSelected && { borderColor: color, backgroundColor: `${color}10` },
                ]}
                onPress={() => setEstado(e)}
                activeOpacity={0.7}
              >
                <View style={[styles.estadoDot, { backgroundColor: color }]} />
                <Text style={[styles.estadoLabel, isSelected && { color, fontWeight: '700' }]}>
                  {ESTADO_LABELS[e]}
                </Text>
                {isSelected && (
                  <View style={[styles.checkCircle, { backgroundColor: color }]}>
                    <Ionicons name="checkmark" size={12} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            )
          })}

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Observaciones (opcional)</Text>
          <TextInput
            style={styles.textArea}
            value={observaciones}
            onChangeText={setObservaciones}
            placeholder="Notas adicionales..."
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
    } catch { /* offline */ }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  function onRefresh() { setRefreshing(true); loadData() }

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
          currentEstado={selected.estado_fenologico ?? 'brotacion'}
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
        {ESTADOS.some((e) => (summary[e] ?? 0) > 0) && (
          <View>
            <Text style={styles.sectionLabel}>RESUMEN CAMPAÑA</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              {ESTADOS.filter((e) => (summary[e] ?? 0) > 0).map((e) => {
                const color = ESTADO_COLORS[e]
                return (
                  <View
                    key={e}
                    style={[styles.summaryChip, { backgroundColor: `${color}15`, borderColor: `${color}50` }]}
                  >
                    <View style={[styles.chipDot, { backgroundColor: color }]} />
                    <Text style={[styles.summaryChipText, { color }]}>
                      {ESTADO_LABELS[e]} · {summary[e]}
                    </Text>
                  </View>
                )
              })}
            </ScrollView>
          </View>
        )}

        <View style={styles.headerRow}>
          <Text style={styles.sectionLabel}>PARRALES</Text>
          <Text style={styles.count}>{estados.length} activos</Text>
        </View>

        {loading ? (
          <ActivityIndicator color="#16a34a" style={{ marginTop: 32 }} />
        ) : estados.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="leaf-outline" size={40} color="#d1d5db" />
            <Text style={styles.emptyTitle}>Sin parrales activos</Text>
            <Text style={styles.emptySub}>No hay parrales activos en el sistema</Text>
          </View>
        ) : (
          estados.map((item) => {
            const hasEstado = item.estado_fenologico != null
            const color = hasEstado ? ESTADO_COLORS[item.estado_fenologico!] : '#d1d5db'
            const label = hasEstado ? ESTADO_LABELS[item.estado_fenologico!] : 'Sin estado'

            return (
              <TouchableOpacity
                key={item.parcela_id}
                style={styles.parcelaCard}
                onPress={() => setSelected(item)}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.cardTop}>
                    <Text style={styles.parcelaNombre}>{item.parcela_nombre}</Text>
                    <View style={[styles.estadoBadge, { backgroundColor: `${color}15` }]}>
                      <View style={[styles.badgeDot, { backgroundColor: color }]} />
                      <Text style={[styles.badgeText, { color }]}>{label}</Text>
                    </View>
                  </View>
                  <Text style={styles.fechaText}>
                    {item.fecha_estado
                      ? `Actualizado ${item.fecha_estado.split('-').reverse().join('/')}`
                      : 'Sin registros — tocá para cargar'}
                  </Text>
                </View>
                <View style={styles.editIcon}>
                  <Ionicons name="create-outline" size={16} color="#9ca3af" />
                </View>
              </TouchableOpacity>
            )
          })
        )}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  count: { fontSize: 13, color: '#6b7280', fontWeight: '600' },
  summaryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, marginRight: 8,
  },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  summaryChipText: { fontSize: 12, fontWeight: '700' },
  parcelaCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  estadoBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7,
  },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  parcelaNombre: { fontSize: 16, fontWeight: '700', color: '#111827', flex: 1, marginRight: 8 },
  fechaText: { fontSize: 11, color: '#9ca3af' },
  editIcon: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: '#f9fafb',
    justifyContent: 'center', alignItems: 'center',
  },
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#6b7280', marginTop: 14 },
  emptySub: { fontSize: 13, color: '#9ca3af', marginTop: 6, textAlign: 'center', paddingHorizontal: 24 },
  // Modal
  modalContainer: { flex: 1, backgroundColor: '#f4f6f8' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f2f5',
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 2 },
  modalSubtitle: { fontSize: 13, color: '#6b7280' },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#f3f4f6',
    justifyContent: 'center', alignItems: 'center',
  },
  estadoOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 12, borderWidth: 2,
    borderColor: '#e8eaed', backgroundColor: '#fff', marginBottom: 8,
  },
  estadoDot: { width: 14, height: 14, borderRadius: 7 },
  estadoLabel: { flex: 1, fontSize: 16, color: '#374151', fontWeight: '500' },
  checkCircle: {
    width: 22, height: 22, borderRadius: 11,
    justifyContent: 'center', alignItems: 'center',
  },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: '#6b7280',
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },
  textArea: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1,
    borderColor: '#e8eaed', padding: 12, fontSize: 15,
    color: '#111827', minHeight: 80, marginBottom: 16,
  },
  modalActions: { flexDirection: 'row', gap: 10, padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f0f2f5' },
  cancelBtn: {
    flex: 1, height: 50, borderRadius: 12, borderWidth: 1.5,
    borderColor: '#e5e7eb', backgroundColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
  },
  cancelBtnText: { color: '#374151', fontSize: 15, fontWeight: '600' },
  saveBtn: {
    flex: 2, height: 50, backgroundColor: '#16a34a', borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 3,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
