import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
  StyleSheet,
  SectionList,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import api from '../../lib/api'
import type { Parcela, RegistroTrabajo, TrabajadorItem, UnidadMedida } from '../../lib/types'
import { TAREAS_POR_TEMPORADA, UNIDAD_LABELS, CLASIFICACION_POR_TAREA } from '../../lib/types'

const UNIDADES: UnidadMedida[] = ['dias', 'plantas', 'melgas', 'metros', 'vines', 'cajas', 'gamelas', 'otros']

function isoToday() {
  return new Date().toISOString().split('T')[0]
}

function formatMonto(monto: string | number) {
  return Number(monto).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
}

// ─── Step 1: Seleccionar parcela ──────────────────────────────────────────────

function StepParcela({
  parcelas,
  onSelect,
}: {
  parcelas: Parcela[]
  onSelect: (p: Parcela) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = parcelas.filter((p) =>
    p.nombre.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Seleccioná una parcela</Text>
      <TextInput
        style={styles.searchInput}
        placeholder="Buscar parcela..."
        placeholderTextColor="#9ca3af"
        value={search}
        onChangeText={setSearch}
      />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        style={{ maxHeight: 400 }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.listItem} onPress={() => onSelect(item)} activeOpacity={0.7}>
            <View>
              <Text style={styles.listItemTitle}>{item.nombre}</Text>
              <Text style={styles.listItemSub}>
                {item.tipo}{item.variedad ? ` · ${item.variedad}` : ''}
                {item.superficie_ha ? ` · ${item.superficie_ha.toFixed(2)} ha` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={<Text style={styles.emptyText}>No se encontraron parcelas</Text>}
      />
      <TouchableOpacity style={styles.skipBtn} onPress={() => onSelect({ id: '', nombre: 'Sin parcela' } as Parcela)}>
        <Text style={styles.skipBtnText}>Continuar sin parcela</Text>
      </TouchableOpacity>
    </View>
  )
}

// ─── Step 2: Seleccionar tarea ────────────────────────────────────────────────

function StepTarea({ onSelect }: { onSelect: (tarea: string) => void }) {
  const sections = TAREAS_POR_TEMPORADA.map((t) => ({
    title: t.temporada,
    data: t.tareas as unknown as string[],
  }))

  return (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>Seleccioná la tarea</Text>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item}
        style={{ maxHeight: 440 }}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.listItem} onPress={() => onSelect(item)} activeOpacity={0.7}>
            <Text style={styles.listItemTitle}>{item}</Text>
            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  )
}

// ─── Step 3: Cargar trabajadores ──────────────────────────────────────────────

interface WorkerEntry {
  key: string
  nombre: string
  cantidad: string
}

function StepCarga({
  parcela,
  tarea,
  onSuccess,
  onBack,
}: {
  parcela: Parcela
  tarea: string
  onSuccess: () => void
  onBack: () => void
}) {
  const [fecha, setFecha] = useState(isoToday())
  const [unidad, setUnidad] = useState<UnidadMedida>('dias')
  const [precio, setPrecio] = useState('')
  const [detalle, setDetalle] = useState('')
  const [workers, setWorkers] = useState<WorkerEntry[]>([
    { key: '1', nombre: '', cantidad: '' },
  ])
  const [loading, setLoading] = useState(false)

  function addWorker() {
    setWorkers((prev) => [...prev, { key: String(Date.now()), nombre: '', cantidad: '' }])
  }

  function removeWorker(key: string) {
    setWorkers((prev) => prev.filter((w) => w.key !== key))
  }

  function updateWorker(key: string, field: 'nombre' | 'cantidad', value: string) {
    setWorkers((prev) => prev.map((w) => (w.key === key ? { ...w, [field]: value } : w)))
  }

  async function handleSubmit() {
    if (!fecha.trim()) { Alert.alert('Error', 'Ingresá la fecha.'); return }
    if (!precio.trim() || isNaN(Number(precio))) { Alert.alert('Error', 'Ingresá un precio válido.'); return }

    const validWorkers = workers.filter((w) => w.nombre.trim() && w.cantidad.trim())
    if (validWorkers.length === 0) {
      Alert.alert('Error', 'Agregá al menos un trabajador con nombre y cantidad.')
      return
    }

    const payload = {
      fecha,
      parcela_id: parcela.id || null,
      tarea,
      unidad_medida: unidad,
      precio_unitario: Number(precio),
      detalle: detalle.trim() || undefined,
      trabajadores: validWorkers.map((w) => ({
        trabajador_nombre: w.nombre.trim(),
        cantidad: Number(w.cantidad),
      })) as TrabajadorItem[],
    }

    try {
      setLoading(true)
      await api.post('/produccion/trabajo/masivo', payload)
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', typeof detail === 'string' ? detail : 'No se pudo guardar el registro.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView style={styles.stepContainer} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.stepTitle}>Cargar trabajadores</Text>

      {/* Summary */}
      <View style={styles.summaryBox}>
        <Text style={styles.summaryText}>
          <Text style={styles.summaryLabel}>Parcela: </Text>
          {parcela.nombre || 'Sin parcela'}
        </Text>
        <Text style={styles.summaryText}>
          <Text style={styles.summaryLabel}>Tarea: </Text>
          {tarea}
        </Text>
      </View>

      <Text style={styles.fieldLabel}>Fecha</Text>
      <TextInput
        style={styles.input}
        value={fecha}
        onChangeText={setFecha}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#9ca3af"
      />

      <Text style={styles.fieldLabel}>Unidad de medida</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        {UNIDADES.map((u) => (
          <TouchableOpacity
            key={u}
            style={[styles.chip, unidad === u && styles.chipActive]}
            onPress={() => setUnidad(u)}
          >
            <Text style={[styles.chipText, unidad === u && styles.chipTextActive]}>
              {UNIDAD_LABELS[u]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.fieldLabel}>Precio unitario (ARS)</Text>
      <TextInput
        style={styles.input}
        value={precio}
        onChangeText={setPrecio}
        placeholder="0"
        placeholderTextColor="#9ca3af"
        keyboardType="numeric"
      />

      <Text style={styles.fieldLabel}>Detalle (opcional)</Text>
      <TextInput
        style={styles.input}
        value={detalle}
        onChangeText={setDetalle}
        placeholder="Observaciones..."
        placeholderTextColor="#9ca3af"
      />

      <View style={styles.workersHeader}>
        <Text style={styles.fieldLabel}>Trabajadores</Text>
        <TouchableOpacity style={styles.addBtn} onPress={addWorker}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addBtnText}>Agregar</Text>
        </TouchableOpacity>
      </View>

      {workers.map((w, idx) => (
        <View key={w.key} style={styles.workerRow}>
          <TextInput
            style={[styles.input, { flex: 2, marginRight: 8 }]}
            value={w.nombre}
            onChangeText={(v) => updateWorker(w.key, 'nombre', v)}
            placeholder={`Trabajador ${idx + 1}`}
            placeholderTextColor="#9ca3af"
            autoCapitalize="words"
          />
          <TextInput
            style={[styles.input, { flex: 1, marginRight: 8 }]}
            value={w.cantidad}
            onChangeText={(v) => updateWorker(w.key, 'cantidad', v)}
            placeholder="Cant."
            placeholderTextColor="#9ca3af"
            keyboardType="numeric"
          />
          {workers.length > 1 && (
            <TouchableOpacity onPress={() => removeWorker(w.key)} style={styles.removeBtn}>
              <Ionicons name="trash-outline" size={18} color="#dc2626" />
            </TouchableOpacity>
          )}
        </View>
      ))}

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>Atrás</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.submitBtn, loading && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.submitBtnText}>Guardar</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

// ─── Recent registros list ────────────────────────────────────────────────────

function RecentList({
  registros,
  onRefresh,
  refreshing,
}: {
  registros: RegistroTrabajo[]
  onRefresh: () => void
  refreshing: boolean
}) {
  async function handleDelete(id: string, nombre: string) {
    Alert.alert(
      'Confirmar eliminación',
      `¿Eliminar el registro de ${nombre}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/produccion/trabajo/${id}`)
              onRefresh()
            } catch {
              Alert.alert('Error', 'No se pudo eliminar el registro.')
            }
          },
        },
      ]
    )
  }

  return (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.sectionTitle}>Registros recientes</Text>
      {registros.length === 0 ? (
        <Text style={styles.emptyText}>No hay registros recientes</Text>
      ) : (
        registros.map((r) => (
          <View key={r.id} style={styles.registroCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.registroNombre}>{r.trabajador_nombre}</Text>
              <Text style={styles.registroSub}>
                {r.tarea} · {r.fecha}
              </Text>
              <Text style={styles.registroMonto}>{formatMonto(r.monto_total)}</Text>
            </View>
            <TouchableOpacity
              onPress={() => handleDelete(r.id, r.trabajador_nombre)}
              style={styles.deleteBtn}
            >
              <Ionicons name="trash-outline" size={18} color="#dc2626" />
            </TouchableOpacity>
          </View>
        ))
      )}
    </View>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

type Step = 'list' | 'parcela' | 'tarea' | 'carga' | 'success'

export default function TareasScreen() {
  const [step, setStep] = useState<Step>('list')
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [selectedParcela, setSelectedParcela] = useState<Parcela | null>(null)
  const [selectedTarea, setSelectedTarea] = useState<string>('')
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [loadingParcelas, setLoadingParcelas] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadParcelas = useCallback(async () => {
    try {
      const { data } = await api.get<Parcela[]>('/parcelas/mapa')
      setParcelas(data.filter((p) => p.is_active))
    } catch {
      /* offline */
    } finally {
      setLoadingParcelas(false)
    }
  }, [])

  const loadRegistros = useCallback(async () => {
    try {
      const { data } = await api.get<RegistroTrabajo[]>('/produccion/trabajo/?limit=20')
      setRegistros(data)
    } catch {
      /* offline */
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadParcelas()
    loadRegistros()
  }, [loadParcelas, loadRegistros])

  function onRefresh() {
    setRefreshing(true)
    loadRegistros()
  }

  if (step === 'parcela') {
    return (
      <StepParcela
        parcelas={parcelas}
        onSelect={(p) => {
          setSelectedParcela(p)
          setStep('tarea')
        }}
      />
    )
  }

  if (step === 'tarea') {
    return (
      <StepTarea
        onSelect={(t) => {
          setSelectedTarea(t)
          setStep('carga')
        }}
      />
    )
  }

  if (step === 'carga' && selectedParcela) {
    return (
      <StepCarga
        parcela={selectedParcela}
        tarea={selectedTarea}
        onSuccess={() => {
          setStep('success')
          loadRegistros()
        }}
        onBack={() => setStep('tarea')}
      />
    )
  }

  if (step === 'success') {
    return (
      <View style={styles.successContainer}>
        <Ionicons name="checkmark-circle" size={72} color="#16a34a" />
        <Text style={styles.successTitle}>Guardado correctamente</Text>
        <Text style={styles.successSub}>Los registros se cargaron al sistema</Text>
        <TouchableOpacity
          style={styles.submitBtn}
          onPress={() => {
            setSelectedParcela(null)
            setSelectedTarea('')
            setStep('list')
          }}
        >
          <Text style={styles.submitBtnText}>Nueva carga</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // Step: list (main)
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
    >
      <TouchableOpacity
        style={styles.newBtn}
        onPress={() => setStep('parcela')}
        activeOpacity={0.85}
      >
        <Ionicons name="add-circle-outline" size={22} color="#fff" />
        <Text style={styles.newBtnText}>Nueva carga de tareas</Text>
      </TouchableOpacity>

      {loadingParcelas ? (
        <ActivityIndicator color="#16a34a" style={{ marginTop: 24 }} />
      ) : (
        <RecentList registros={registros} onRefresh={onRefresh} refreshing={refreshing} />
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  stepContainer: { flex: 1, backgroundColor: '#f9fafb', padding: 16 },
  stepTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
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
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    backgroundColor: '#fff',
    paddingLeft: 12,
  },
  listItemTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
  listItemSub: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  separator: { height: 1, backgroundColor: '#f3f4f6', marginLeft: 12 },
  emptyText: { color: '#9ca3af', textAlign: 'center', paddingVertical: 24 },
  skipBtn: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  skipBtnText: { color: '#6b7280', fontSize: 14 },
  sectionHeader: { backgroundColor: '#f3f4f6', paddingVertical: 6, paddingHorizontal: 12 },
  sectionHeaderText: { fontSize: 12, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryBox: {
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  summaryText: { fontSize: 14, color: '#166534', marginBottom: 2 },
  summaryLabel: { fontWeight: '700' },
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
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    marginRight: 8,
  },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  workersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#16a34a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  workerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  removeBtn: { padding: 8 },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  backBtn: {
    flex: 1,
    height: 50,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  backBtnText: { color: '#374151', fontSize: 15, fontWeight: '600' },
  submitBtn: {
    flex: 2,
    height: 50,
    backgroundColor: '#16a34a',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 20,
    justifyContent: 'center',
  },
  newBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  registroCard: {
    flexDirection: 'row',
    alignItems: 'center',
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
  registroNombre: { fontSize: 15, fontWeight: '600', color: '#111827' },
  registroSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  registroMonto: { fontSize: 14, fontWeight: '700', color: '#16a34a', marginTop: 4 },
  deleteBtn: { padding: 8 },
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
})
