import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Modal,
  FlatList,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import api from '../../lib/api'
import { useAuthStore } from '../../store/authStore'
import type { Parcela, RegistroRiego, RiegoPayload } from '../../lib/types'
import { CABEZAL_VALVULAS } from '../../lib/types'

function isoToday() {
  return new Date().toISOString().split('T')[0]
}

function localDatetime(offsetHours = 0) {
  const d = new Date(Date.now() + offsetHours * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const mo = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const h = pad(d.getHours())
  const min = pad(d.getMinutes())
  return `${y}-${mo}-${day}T${h}:${min}`
}

function formatDatetime(dt: string) {
  try {
    return new Date(dt).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return dt
  }
}

// ─── Parcela picker modal ─────────────────────────────────────────────────────

function ParcelaPicker({
  visible,
  parcelas,
  onSelect,
  onClose,
}: {
  visible: boolean
  parcelas: Parcela[]
  onSelect: (p: Parcela) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const filtered = parcelas.filter((p) =>
    p.nombre.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Seleccionar parcela</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color="#374151" />
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar parral..."
          placeholderTextColor="#9ca3af"
          value={search}
          onChangeText={setSearch}
        />
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.modalItem}
              onPress={() => { onSelect(item); onClose() }}
            >
              <Text style={styles.modalItemText}>{item.nombre}</Text>
              {item.superficie_ha && (
                <Text style={styles.modalItemSub}>{item.superficie_ha.toFixed(2)} ha</Text>
              )}
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </View>
    </Modal>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function RiegoScreen() {
  const user = useAuthStore((s) => s.user)
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [riegos, setRiegos] = useState<RegistroRiego[]>([])
  const [pickerVisible, setPickerVisible] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Form state
  const [parcela, setParcela] = useState<Parcela | null>(null)
  const [cabezal, setCabezal] = useState<string>('1')
  const [valvula, setValvula] = useState<string>('1')
  const [inicio, setInicio] = useState(localDatetime())
  const [fin, setFin] = useState(localDatetime(4))
  const [mmAplicados, setMmAplicados] = useState('')
  const [fertNombre, setFertNombre] = useState('')
  const [fertDosis, setFertDosis] = useState('')
  const [responsable, setResponsable] = useState(user?.full_name ?? '')

  const valvulas = CABEZAL_VALVULAS[cabezal]?.valvulas ?? []

  const loadData = useCallback(async () => {
    try {
      const [parcelasRes, riegosRes] = await Promise.all([
        api.get<Parcela[]>('/parcelas/mapa'),
        api.get<RegistroRiego[]>('/produccion/riego/?limit=10'),
      ])
      const parrales = parcelasRes.data.filter((p) => p.is_active && p.tipo === 'parral')
      setParcelas(parrales)
      setRiegos(riegosRes.data)
    } catch {
      /* offline */
    } finally {
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

  // Reset valvula when cabezal changes
  useEffect(() => {
    const available = CABEZAL_VALVULAS[cabezal]?.valvulas ?? []
    if (!available.includes(valvula)) {
      setValvula(available[0] ?? '1')
    }
  }, [cabezal])

  async function handleSubmit() {
    if (!parcela) { Alert.alert('Error', 'Seleccioná una parcela.'); return }
    if (!inicio || !fin) { Alert.alert('Error', 'Ingresá hora de inicio y fin.'); return }
    if (!responsable.trim()) { Alert.alert('Error', 'Ingresá el responsable.'); return }

    const iniDate = new Date(inicio)
    const finDate = new Date(fin)
    if (finDate <= iniDate) { Alert.alert('Error', 'El fin debe ser posterior al inicio.'); return }

    const payload: RiegoPayload = {
      fecha: isoToday(),
      parcela_id: parcela.id,
      cabezal,
      valvula,
      inicio: iniDate.toISOString(),
      fin: finDate.toISOString(),
      responsable: responsable.trim(),
    }
    if (mmAplicados) payload.mm_aplicados = Number(mmAplicados)
    if (fertNombre.trim()) payload.fertilizante_nombre = fertNombre.trim()
    if (fertDosis) payload.fertilizante_dosis_lt_ha = Number(fertDosis)

    try {
      setLoading(true)
      await api.post('/produccion/riego/', payload)
      setSubmitted(true)
      loadData()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', typeof detail === 'string' ? detail : 'No se pudo guardar el riego.')
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setParcela(null)
    setCabezal('1')
    setValvula('1')
    setInicio(localDatetime())
    setFin(localDatetime(4))
    setMmAplicados('')
    setFertNombre('')
    setFertDosis('')
    setResponsable(user?.full_name ?? '')
    setSubmitted(false)
  }

  if (submitted) {
    return (
      <View style={styles.successContainer}>
        <Ionicons name="checkmark-circle" size={72} color="#16a34a" />
        <Text style={styles.successTitle}>Riego registrado</Text>
        <Text style={styles.successSub}>Se guardó el registro correctamente</Text>
        <TouchableOpacity style={styles.submitBtn} onPress={resetForm}>
          <Text style={styles.submitBtnText}>Nuevo riego</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <>
      <ParcelaPicker
        visible={pickerVisible}
        parcelas={parcelas}
        onSelect={setParcela}
        onClose={() => setPickerVisible(false)}
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
      >
        <Text style={styles.sectionTitle}>Registrar riego</Text>

        {/* Parcela */}
        <Text style={styles.fieldLabel}>Parcela (parral)</Text>
        <TouchableOpacity style={styles.pickerBtn} onPress={() => setPickerVisible(true)}>
          <Text style={parcela ? styles.pickerValue : styles.pickerPlaceholder}>
            {parcela ? parcela.nombre : 'Seleccionar parral...'}
          </Text>
          <Ionicons name="chevron-down" size={18} color="#9ca3af" />
        </TouchableOpacity>

        {/* Cabezal */}
        <Text style={styles.fieldLabel}>Cabezal de riego</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          {Object.entries(CABEZAL_VALVULAS).map(([c, info]) => (
            <TouchableOpacity
              key={c}
              style={[styles.chip, cabezal === c && styles.chipActive]}
              onPress={() => setCabezal(c)}
            >
              <Text style={[styles.chipText, cabezal === c && styles.chipTextActive]}>
                Cab. {c}
              </Text>
              <Text style={[styles.chipSub, cabezal === c && { color: '#bbf7d0' }]}>
                {info.descripcion}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Valvula */}
        <Text style={styles.fieldLabel}>Válvula</Text>
        <View style={styles.chipRow}>
          {valvulas.map((v) => (
            <TouchableOpacity
              key={v}
              style={[styles.chip, valvula === v && styles.chipActive]}
              onPress={() => setValvula(v)}
            >
              <Text style={[styles.chipText, valvula === v && styles.chipTextActive]}>
                Válvula {v}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Datetimes */}
        <Text style={styles.fieldLabel}>Inicio (YYYY-MM-DDTHH:MM)</Text>
        <TextInput
          style={styles.input}
          value={inicio}
          onChangeText={setInicio}
          placeholder="2026-05-18T08:00"
          placeholderTextColor="#9ca3af"
        />

        <Text style={styles.fieldLabel}>Fin (YYYY-MM-DDTHH:MM)</Text>
        <TextInput
          style={styles.input}
          value={fin}
          onChangeText={setFin}
          placeholder="2026-05-18T12:00"
          placeholderTextColor="#9ca3af"
        />

        {/* Optional fields */}
        <Text style={styles.fieldLabel}>mm aplicados (opcional)</Text>
        <TextInput
          style={styles.input}
          value={mmAplicados}
          onChangeText={setMmAplicados}
          placeholder="Auto-calculado si se deja vacío"
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
        />

        <Text style={styles.fieldLabel}>Fertilizante (opcional)</Text>
        <TextInput
          style={styles.input}
          value={fertNombre}
          onChangeText={setFertNombre}
          placeholder="Nombre del fertilizante"
          placeholderTextColor="#9ca3af"
        />

        <Text style={styles.fieldLabel}>Dosis fertilizante lt/ha (opcional)</Text>
        <TextInput
          style={styles.input}
          value={fertDosis}
          onChangeText={setFertDosis}
          placeholder="0.0"
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
        />

        <Text style={styles.fieldLabel}>Responsable</Text>
        <TextInput
          style={styles.input}
          value={responsable}
          onChangeText={setResponsable}
          placeholder="Nombre del responsable"
          placeholderTextColor="#9ca3af"
          autoCapitalize="words"
        />

        <TouchableOpacity
          style={[styles.submitBtn, loading && { opacity: 0.6 }, { flex: 0, marginTop: 8 }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>Guardar riego</Text>
          )}
        </TouchableOpacity>

        {/* Recent riegos */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Riegos recientes</Text>
        {riegos.length === 0 ? (
          <Text style={styles.emptyText}>No hay riegos registrados</Text>
        ) : (
          riegos.map((r) => (
            <View key={r.id} style={styles.riegoCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={styles.riegoTitle}>Cab. {r.cabezal} · Válv. {r.valvula}</Text>
                <Text style={styles.riegoDate}>{r.fecha}</Text>
              </View>
              <Text style={styles.riegoSub}>
                {formatDatetime(r.inicio)} → {formatDatetime(r.fin)}
              </Text>
              <Text style={styles.riegoSub}>
                {r.duracion_horas.toFixed(1)} h
                {r.mm_aplicados != null ? ` · ${r.mm_aplicados} mm` : ''}
                {r.fertilizante_nombre ? ` · ${r.fertilizante_nombre}` : ''}
              </Text>
              <Text style={styles.riegoResp}>{r.responsable}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: {
    height: 44,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#111827',
    marginBottom: 12,
  },
  pickerBtn: {
    height: 44,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  pickerValue: { fontSize: 15, color: '#111827' },
  pickerPlaceholder: { fontSize: 15, color: '#9ca3af' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    marginRight: 8,
  },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  chipSub: { fontSize: 10, color: '#9ca3af', marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  submitBtn: {
    height: 50,
    backgroundColor: '#16a34a',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
  },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  riegoCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  riegoTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  riegoDate: { fontSize: 13, color: '#6b7280' },
  riegoSub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  riegoResp: { fontSize: 12, color: '#16a34a', marginTop: 4, fontWeight: '600' },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    padding: 32,
    gap: 12,
  },
  successTitle: { fontSize: 22, fontWeight: '800', color: '#111827' },
  successSub: { fontSize: 15, color: '#6b7280', marginBottom: 16 },
  modalContainer: { flex: 1, backgroundColor: '#f9fafb', padding: 16 },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  searchInput: {
    height: 44,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#111827',
    marginBottom: 12,
  },
  modalItem: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  modalItemText: { fontSize: 15, fontWeight: '600', color: '#111827' },
  modalItemSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  separator: { height: 1, backgroundColor: '#f3f4f6' },
  emptyText: { color: '#9ca3af', textAlign: 'center', paddingVertical: 24 },
})
