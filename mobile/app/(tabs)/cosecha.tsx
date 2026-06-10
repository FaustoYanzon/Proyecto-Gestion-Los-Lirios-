import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Modal,
  FlatList,
  TextInput,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { getCosechas, createCosecha, deleteCosecha } from '../../lib/api'
import type { RegistroCosecha, RegistroCosechaCreate, DestinoCosecha, CultivoCosecha, TipoEnvase } from '../../lib/types'
import { DESTINO_LABELS, CULTIVO_LABELS, DESTINO_COLORS } from '../../lib/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const nowInit = new Date()
const TEMPORADA = nowInit.getMonth() >= 4 ? nowInit.getFullYear() : nowInit.getFullYear() - 1

const DESTINO_OPTIONS = Object.entries(DESTINO_LABELS) as [DestinoCosecha, string][]
const CULTIVO_OPTIONS = Object.entries(CULTIVO_LABELS) as [CultivoCosecha, string][]
const ENVASE_OPTIONS: [TipoEnvase, string][] = [
  ['caja', 'Caja'], ['bin', 'Bin'], ['chasis', 'Chasis'],
  ['ficha', 'Ficha'], ['vin', 'Vin'], ['bolsa', 'Bolsa'], ['otro', 'Otro'],
]

function emptyForm(): RegistroCosechaCreate {
  return {
    fecha: new Date().toISOString().split('T')[0],
    destino: 'MI',
    cultivo: 'vid',
    tipo_envase: 'caja',
    kg_total: 0,
  }
}

function fmtFecha(iso: string): string {
  return iso.split('-').reverse().join('/')
}

// ── Form change handler type ──────────────────────────────────────────────────

type FormValue = string | number | null | undefined

// ── Main screen ───────────────────────────────────────────────────────────────

export default function CosechaScreen() {
  const [registros, setRegistros] = useState<RegistroCosecha[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<RegistroCosechaCreate>(emptyForm())

  // ── Data ────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const data = await getCosechas({ temporada: TEMPORADA, limit: 10 })
      setRegistros(data)
    } catch {
      Alert.alert('Error', 'No se pudieron cargar los registros')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function onRefresh() {
    setRefreshing(true)
    fetchData()
  }

  // ── Form ────────────────────────────────────────────────────────────────────

  function handleFormChange(field: keyof RegistroCosechaCreate, value: FormValue) {
    setForm((prev) => {
      const next = { ...prev, [field]: value } as RegistroCosechaCreate
      if (
        (field === 'cantidad_envases' || field === 'peso_unitario_kg') &&
        next.cantidad_envases && next.peso_unitario_kg
      ) {
        next.kg_total = Math.round(Number(next.cantidad_envases) * Number(next.peso_unitario_kg) * 100) / 100
      }
      if (
        (field === 'bruto_kg' || field === 'tara_kg') &&
        next.bruto_kg && next.tara_kg &&
        Number(next.bruto_kg) > Number(next.tara_kg)
      ) {
        next.kg_total = Math.round((Number(next.bruto_kg) - Number(next.tara_kg)) * 100) / 100
      }
      return next
    })
  }

  function numInput(field: keyof RegistroCosechaCreate) {
    return (text: string) => {
      const cleaned = text.replace(',', '.')
      const n = cleaned === '' ? null : parseFloat(cleaned)
      handleFormChange(field, n != null && !isNaN(n) ? n : null)
    }
  }

  function numValue(val: number | null | undefined): string {
    return val != null ? String(val) : ''
  }

  function openModal() {
    setForm(emptyForm())
    setModalVisible(true)
  }

  function closeModal() {
    setModalVisible(false)
  }

  async function handleSave() {
    if (!form.destino || !form.fecha || form.kg_total <= 0) {
      Alert.alert('Campos requeridos', 'Completá destino, fecha y kg total')
      return
    }
    try {
      setSaving(true)
      await createCosecha(form)
      closeModal()
      await fetchData()
    } catch {
      Alert.alert('Error', 'No se pudo guardar el registro')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCosecha(id)
      setRegistros((prev) => prev.filter((r) => r.id !== id))
    } catch {
      Alert.alert('Error', 'No se pudo eliminar el registro')
    }
  }

  // ── Render item ─────────────────────────────────────────────────────────────

  function renderItem({ item }: { item: RegistroCosecha }) {
    const color = DESTINO_COLORS[item.destino] ?? '#4b5563'
    return (
      <TouchableOpacity
        style={styles.card}
        onLongPress={() => {
          Alert.alert('Opciones', `Registro del ${fmtFecha(item.fecha)}`, [
            { text: 'Eliminar', style: 'destructive', onPress: () => handleDelete(item.id) },
            { text: 'Cancelar', style: 'cancel' },
          ])
        }}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.dateText}>{fmtFecha(item.fecha)}</Text>
          <View style={[styles.badge, { backgroundColor: color + '22' }]}>
            <Text style={[styles.badgeText, { color }]}>{DESTINO_LABELS[item.destino]}</Text>
          </View>
        </View>
        <Text style={styles.parcelaText}>
          {item.parcela_nombre ?? 'Sin parcela'}
          {item.variedad ? ` · ${item.variedad}` : ''}
        </Text>
        <View style={styles.cardFooter}>
          <Text style={styles.kgText}>{item.kg_total.toLocaleString('es-AR')} kg</Text>
          {item.n_remito != null && (
            <Text style={styles.remitoText}>Remito #{item.n_remito}</Text>
          )}
        </View>
      </TouchableOpacity>
    )
  }

  // ── List header ─────────────────────────────────────────────────────────────

  const totalKg = registros.reduce((s, r) => s + r.kg_total, 0)

  const ListHeader = (
    <View style={styles.listHeader}>
      <Text style={styles.screenTitle}>Cosecha</Text>
      {registros.length > 0 && (
        <View style={styles.summaryStrip}>
          <Text style={styles.summaryText}>
            {totalKg.toLocaleString('es-AR')} kg · {registros.length} remitos · Campaña {TEMPORADA}/{TEMPORADA + 1}
          </Text>
        </View>
      )}
    </View>
  )

  // ── Empty state ──────────────────────────────────────────────────────────────

  const EmptyState = (
    <View style={styles.emptyState}>
      {loading ? (
        <ActivityIndicator size="large" color="#16a34a" />
      ) : (
        <>
          <Ionicons name="basket-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyTitle}>Sin registros</Text>
          <Text style={styles.emptySubtitle}>Campaña {TEMPORADA}/{TEMPORADA + 1}</Text>
        </>
      )}
    </View>
  )

  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      <FlatList
        data={registros}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={EmptyState}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />
        }
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={openModal}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Create modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>

          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nuevo Remito</Text>
            <TouchableOpacity onPress={closeModal} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#374151" />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">

            {/* ── Datos principales ── */}
            <Text style={styles.sectionLabel}>DATOS PRINCIPALES</Text>

            <Text style={styles.fieldLabel}>FECHA</Text>
            <TextInput
              style={styles.input}
              value={form.fecha}
              onChangeText={(t) => handleFormChange('fecha', t)}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
            />

            <Text style={styles.fieldLabel}>DESTINO</Text>
            <View style={styles.chipGroup}>
              {DESTINO_OPTIONS.map(([key, label]) => {
                const active = form.destino === key
                const color = DESTINO_COLORS[key]
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.chip, active && { backgroundColor: color, borderColor: color }]}
                    onPress={() => handleFormChange('destino', key)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.fieldLabel}>CULTIVO</Text>
            <View style={styles.chipGroup}>
              {CULTIVO_OPTIONS.map(([key, label]) => {
                const active = form.cultivo === key
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.chip, active && styles.chipActiveGreen]}
                    onPress={() => handleFormChange('cultivo', key)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            {/* ── Cantidad ── */}
            <Text style={[styles.sectionLabel, { marginTop: 12 }]}>CANTIDAD</Text>

            <Text style={styles.fieldLabel}>TIPO ENVASE</Text>
            <View style={styles.chipGroup}>
              {ENVASE_OPTIONS.map(([key, label]) => {
                const active = form.tipo_envase === key
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.chip, active && styles.chipActiveGreen]}
                    onPress={() => handleFormChange('tipo_envase', key)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.fieldLabel}>CANTIDAD ENVASES</Text>
            <TextInput
              style={styles.input}
              value={numValue(form.cantidad_envases)}
              onChangeText={numInput('cantidad_envases')}
              placeholder="0"
              placeholderTextColor="#9ca3af"
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>PESO UNITARIO KG</Text>
            <TextInput
              style={styles.input}
              value={numValue(form.peso_unitario_kg)}
              onChangeText={numInput('peso_unitario_kg')}
              placeholder="Para cajas"
              placeholderTextColor="#9ca3af"
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>BRUTO KG</Text>
            <TextInput
              style={styles.input}
              value={numValue(form.bruto_kg)}
              onChangeText={numInput('bruto_kg')}
              placeholder="Para camiones/bins"
              placeholderTextColor="#9ca3af"
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>TARA KG</Text>
            <TextInput
              style={styles.input}
              value={numValue(form.tara_kg)}
              onChangeText={numInput('tara_kg')}
              placeholder="0"
              placeholderTextColor="#9ca3af"
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>KG TOTAL *</Text>
            <TextInput
              style={[styles.input, styles.inputHighlight]}
              value={form.kg_total > 0 ? String(form.kg_total) : ''}
              onChangeText={(t) => {
                const n = parseFloat(t.replace(',', '.'))
                handleFormChange('kg_total', isNaN(n) ? 0 : n)
              }}
              placeholder="Se auto-calcula"
              placeholderTextColor="#86efac"
              keyboardType="decimal-pad"
            />

            {/* ── Identificación ── */}
            <Text style={[styles.sectionLabel, { marginTop: 12 }]}>IDENTIFICACIÓN</Text>

            <Text style={styles.fieldLabel}>N° REMITO</Text>
            <TextInput
              style={styles.input}
              value={form.n_remito ?? ''}
              onChangeText={(t) => handleFormChange('n_remito', t || null)}
              placeholder="Número de remito"
              placeholderTextColor="#9ca3af"
            />

            <Text style={styles.fieldLabel}>N° CIU / GUÍA ÚNICA</Text>
            <TextInput
              style={styles.input}
              value={form.n_ciu ?? ''}
              onChangeText={(t) => handleFormChange('n_ciu', t || null)}
              placeholder="Número CIU"
              placeholderTextColor="#9ca3af"
            />

            <Text style={styles.fieldLabel}>COMPRADOR / DESTINATARIO</Text>
            <TextInput
              style={styles.input}
              value={form.comprador ?? ''}
              onChangeText={(t) => handleFormChange('comprador', t || null)}
              placeholder="Nombre del comprador"
              placeholderTextColor="#9ca3af"
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>CUADRILLA</Text>
            <TextInput
              style={styles.input}
              value={form.cuadrilla ?? ''}
              onChangeText={(t) => handleFormChange('cuadrilla', t || null)}
              placeholder="Nombre de cuadrilla"
              placeholderTextColor="#9ca3af"
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>PATENTE VEHÍCULO</Text>
            <TextInput
              style={styles.input}
              value={form.vehiculo_patente ?? ''}
              onChangeText={(t) => handleFormChange('vehiculo_patente', t || null)}
              placeholder="AAA123BB"
              placeholderTextColor="#9ca3af"
              autoCapitalize="characters"
            />

            {/* ── Opciones ── */}
            <Text style={[styles.sectionLabel, { marginTop: 12 }]}>OPCIONES</Text>

            <Text style={styles.fieldLabel}>VARIEDAD</Text>
            <TextInput
              style={styles.input}
              value={form.variedad ?? ''}
              onChangeText={(t) => handleFormChange('variedad', t || null)}
              placeholder="Ej: Flame, Red Globe"
              placeholderTextColor="#9ca3af"
            />

            <Text style={styles.fieldLabel}>OBSERVACIONES</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={form.observaciones ?? ''}
              onChangeText={(t) => handleFormChange('observaciones', t || null)}
              placeholder="Observaciones opcionales..."
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.saveBtnText}>Guardar</Text>
              }
            </TouchableOpacity>
          </View>

        </View>
      </Modal>

    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },

  listContent: { paddingBottom: 100 },

  listHeader: { paddingTop: 4 },

  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },

  summaryStrip: {
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  summaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#166534',
    textAlign: 'center',
  },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  dateText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  parcelaText: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kgText: { fontSize: 20, fontWeight: '800', color: '#111827' },
  remitoText: { fontSize: 12, color: '#9ca3af' },

  // Empty / Loading
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#9ca3af', marginTop: 12 },
  emptySubtitle: { fontSize: 13, color: '#d1d5db', marginTop: 4 },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#16a34a',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },

  // Modal
  modalContainer: { flex: 1, backgroundColor: '#f4f6f8', paddingTop: 16 },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f2f5',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalScroll: { padding: 16, paddingBottom: 24 },

  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f0f2f5',
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  saveBtn: {
    flex: 2,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#16a34a',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Form
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  input: {
    height: 48,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8eaed',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#111827',
    marginBottom: 14,
  },
  inputHighlight: {
    borderColor: '#16a34a',
    borderWidth: 2,
    backgroundColor: '#f0fdf4',
    color: '#166534',
    fontWeight: '700',
  },
  inputMultiline: {
    height: 80,
    paddingTop: 12,
  },

  // Chips
  chipGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  chipActiveGreen: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  chipText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  chipTextActive: { color: '#fff' },
})
