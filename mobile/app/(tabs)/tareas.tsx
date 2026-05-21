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
  Modal,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import api from '../../lib/api'
import { getCache, setCache, CACHE_TTL } from '../../lib/cache'
import type { Parcela, RegistroTrabajo, TrabajadorItem, UnidadMedida } from '../../lib/types'
import { TAREAS_POR_TEMPORADA, UNIDAD_LABELS } from '../../lib/types'

const UNIDADES: UnidadMedida[] = ['dias', 'plantas', 'melgas', 'metros', 'vines', 'cajas', 'gamelas', 'otros']

function isoToday() {
  return new Date().toISOString().split('T')[0]
}

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DAY_NAMES = ['Lu','Ma','Mi','Ju','Vi','Sa','Do']

function buildCalendarDays(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1).getDay()
  const offset = firstDay === 0 ? 6 : firstDay - 1
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = Array(offset).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(month + 1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    cells.push(`${year}-${mm}-${dd}`)
  }
  return cells
}

function DatePicker({
  visible, value, onConfirm, onClose,
}: {
  visible: boolean; value: string; onConfirm: (date: string) => void; onClose: () => void
}) {
  const todayISO = new Date().toISOString().split('T')[0]
  const [selDate, setSelDate] = useState(value)
  const [calYear, setCalYear] = useState(() => parseInt(value.split('-')[0]))
  const [calMonth, setCalMonth] = useState(() => parseInt(value.split('-')[1]) - 1)

  useEffect(() => {
    if (visible) {
      setSelDate(value)
      setCalYear(parseInt(value.split('-')[0]))
      setCalMonth(parseInt(value.split('-')[1]) - 1)
    }
  }, [visible, value])

  const calDays = buildCalendarDays(calYear, calMonth)

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1) } else setCalMonth(calMonth - 1)
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1) } else setCalMonth(calMonth + 1)
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: '#f4f6f8' }}>
        <View style={dpStyles.header}>
          <Text style={dpStyles.title}>Seleccionar fecha</Text>
          <TouchableOpacity onPress={onClose} style={dpStyles.closeBtn}>
            <Ionicons name="close" size={20} color="#374151" />
          </TouchableOpacity>
        </View>

        <View style={{ padding: 16 }}>
          <View style={dpStyles.navRow}>
            <TouchableOpacity onPress={prevMonth} style={dpStyles.navBtn}>
              <Ionicons name="chevron-back" size={18} color="#374151" />
            </TouchableOpacity>
            <Text style={dpStyles.monthLabel}>{MONTH_NAMES[calMonth]} {calYear}</Text>
            <TouchableOpacity onPress={nextMonth} style={dpStyles.navBtn}>
              <Ionicons name="chevron-forward" size={18} color="#374151" />
            </TouchableOpacity>
          </View>

          <View style={dpStyles.dayNamesRow}>
            {DAY_NAMES.map((d) => (
              <Text key={d} style={dpStyles.dayName}>{d}</Text>
            ))}
          </View>

          <View style={dpStyles.grid}>
            {calDays.map((isoDate, idx) => {
              if (!isoDate) return <View key={`e-${idx}`} style={dpStyles.cell} />
              const isSelected = isoDate === selDate
              const isToday = isoDate === todayISO
              return (
                <TouchableOpacity
                  key={isoDate}
                  style={[dpStyles.cell, isSelected && dpStyles.cellSelected, !isSelected && isToday && dpStyles.cellToday]}
                  onPress={() => setSelDate(isoDate)}
                >
                  <Text style={[dpStyles.cellText, isSelected && dpStyles.cellTextSelected, !isSelected && isToday && dpStyles.cellTextToday]}>
                    {parseInt(isoDate.split('-')[2])}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        <View style={{ padding: 16 }}>
          <TouchableOpacity
            style={dpStyles.confirmBtn}
            onPress={() => { onConfirm(selDate); onClose() }}
          >
            <Text style={dpStyles.confirmBtnText}>Confirmar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const dpStyles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f2f5' },
  title: { fontSize: 18, fontWeight: '800', color: '#111827' },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  monthLabel: { fontSize: 16, fontWeight: '700', color: '#111827' },
  dayNamesRow: { flexDirection: 'row', marginBottom: 4 },
  dayName: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, justifyContent: 'center', alignItems: 'center', padding: 2 },
  cellSelected: { backgroundColor: '#16a34a', borderRadius: 8 },
  cellToday: { backgroundColor: '#f0fdf4', borderRadius: 8 },
  cellText: { fontSize: 15, fontWeight: '500', color: '#374151' },
  cellTextSelected: { color: '#fff', fontWeight: '700' },
  cellTextToday: { color: '#16a34a', fontWeight: '700' },
  confirmBtn: { height: 52, backgroundColor: '#16a34a', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})

function formatDateDisplay(dateISO: string): string {
  const [y, mo, d] = dateISO.split('-')
  return `${d}/${mo}/${y}`
}

function formatMonto(monto: string | number) {
  return Number(monto).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ['Parcela', 'Tarea', 'Carga']

function StepIndicator({ current }: { current: 0 | 1 | 2 }) {
  return (
    <View style={si.row}>
      {STEP_LABELS.map((label, idx) => {
        const done = idx < current
        const active = idx === current
        return (
          <View key={label} style={si.item}>
            <View style={[si.dot, done && si.dotDone, active && si.dotActive]}>
              {done ? (
                <Ionicons name="checkmark" size={11} color="#fff" />
              ) : (
                <Text style={[si.dotText, active && { color: '#fff' }]}>{idx + 1}</Text>
              )}
            </View>
            <Text style={[si.label, active && si.labelActive, done && si.labelDone]}>{label}</Text>
            {idx < STEP_LABELS.length - 1 && (
              <View style={[si.line, done && si.lineDone]} />
            )}
          </View>
        )
      })}
    </View>
  )
}

const si = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f2f5' },
  item: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  dot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#e5e7eb', justifyContent: 'center', alignItems: 'center' },
  dotActive: { backgroundColor: '#16a34a' },
  dotDone: { backgroundColor: '#16a34a' },
  dotText: { fontSize: 11, fontWeight: '700', color: '#9ca3af' },
  label: { fontSize: 11, color: '#9ca3af', marginLeft: 6, fontWeight: '500' },
  labelActive: { color: '#111827', fontWeight: '700' },
  labelDone: { color: '#16a34a', fontWeight: '600' },
  line: { flex: 1, height: 1, backgroundColor: '#e5e7eb', marginHorizontal: 4 },
  lineDone: { backgroundColor: '#16a34a' },
})

// ─── Step 1: Seleccionar parcela ──────────────────────────────────────────────

function StepParcela({ parcelas, onSelect }: { parcelas: Parcela[]; onSelect: (p: Parcela) => void }) {
  const [search, setSearch] = useState('')
  const filtered = parcelas.filter((p) => p.nombre.toLowerCase().includes(search.toLowerCase()))

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={0} />
      <View style={{ padding: 16, flex: 1 }}>
        <Text style={styles.stepTitle}>¿En qué parcela?</Text>
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
          style={{ flex: 1 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.listItem} onPress={() => onSelect(item)} activeOpacity={0.7}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listItemTitle}>{item.nombre}</Text>
                <Text style={styles.listItemSub}>
                  {item.tipo}{item.variedad ? ` · ${item.variedad}` : ''}
                  {item.superficie_ha ? ` · ${item.superficie_ha.toFixed(2)} ha` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={<Text style={styles.emptyText}>No se encontraron parcelas</Text>}
        />
        <TouchableOpacity
          style={styles.ghostBtn}
          onPress={() => onSelect({ id: '', nombre: 'Sin parcela' } as Parcela)}
        >
          <Text style={styles.ghostBtnText}>Continuar sin parcela</Text>
        </TouchableOpacity>
      </View>
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
      <StepIndicator current={1} />
      <View style={{ padding: 16, flex: 1 }}>
        <Text style={styles.stepTitle}>¿Qué tarea?</Text>
        <SectionList
          sections={sections}
          keyExtractor={(item) => item}
          style={{ flex: 1 }}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.listItem} onPress={() => onSelect(item)} activeOpacity={0.7}>
              <Text style={styles.listItemTitle}>{item}</Text>
              <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </View>
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
  parcela, tarea, onSuccess, onBack,
}: {
  parcela: Parcela; tarea: string; onSuccess: () => void; onBack: () => void
}) {
  const [fecha, setFecha] = useState(isoToday())
  const [datePickerVisible, setDatePickerVisible] = useState(false)
  const [unidad, setUnidad] = useState<UnidadMedida>('dias')
  const [precio, setPrecio] = useState('')
  const [detalle, setDetalle] = useState('')
  const [workers, setWorkers] = useState<WorkerEntry[]>([{ key: '1', nombre: '', cantidad: '' }])
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
    <View style={styles.stepContainer}>
      <StepIndicator current={2} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Detalle de carga</Text>

        <View style={styles.summaryBox}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Parcela</Text>
            <Text style={styles.summaryValue}>{parcela.nombre || 'Sin parcela'}</Text>
          </View>
          <View style={[styles.summaryRow, { borderTopWidth: 1, borderTopColor: '#d1fae5', paddingTop: 8, marginTop: 8 }]}>
            <Text style={styles.summaryLabel}>Tarea</Text>
            <Text style={styles.summaryValue}>{tarea}</Text>
          </View>
        </View>

        <DatePicker
          visible={datePickerVisible}
          value={fecha}
          onConfirm={(d) => setFecha(d)}
          onClose={() => setDatePickerVisible(false)}
        />

        <Text style={styles.fieldLabel}>Fecha</Text>
        <TouchableOpacity
          style={styles.dateBtn}
          onPress={() => setDatePickerVisible(true)}
        >
          <Ionicons name="calendar-outline" size={16} color="#6b7280" />
          <Text style={styles.dateBtnText}>{formatDateDisplay(fecha)}</Text>
          <Ionicons name="chevron-down" size={14} color="#9ca3af" />
        </TouchableOpacity>

        <Text style={styles.fieldLabel}>Unidad de medida</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
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
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addBtnText}>Agregar</Text>
          </TouchableOpacity>
        </View>

        {workers.map((w, idx) => (
          <View key={w.key} style={styles.workerRow}>
            <TextInput
              style={[styles.input, { flex: 2, marginRight: 8, marginBottom: 0 }]}
              value={w.nombre}
              onChangeText={(v) => updateWorker(w.key, 'nombre', v)}
              placeholder={`Trabajador ${idx + 1}`}
              placeholderTextColor="#9ca3af"
              autoCapitalize="words"
            />
            <TextInput
              style={[styles.input, { flex: 1, marginRight: workers.length > 1 ? 8 : 0, marginBottom: 0 }]}
              value={w.cantidad}
              onChangeText={(v) => updateWorker(w.key, 'cantidad', v)}
              placeholder="Cant."
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
            />
            {workers.length > 1 && (
              <TouchableOpacity onPress={() => removeWorker(w.key)} style={styles.removeBtn}>
                <Ionicons name="trash-outline" size={17} color="#ef4444" />
              </TouchableOpacity>
            )}
          </View>
        ))}

        <View style={[styles.actionRow, { marginTop: 20 }]}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
            <Text style={styles.secondaryBtnText}>Atrás</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtn, { flex: 2 }, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>Guardar</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

// ─── Recent registros list ────────────────────────────────────────────────────

function RecentList({ registros, onRefresh }: {
  registros: RegistroTrabajo[]; onRefresh: () => void
}) {
  async function handleDelete(id: string, nombre: string) {
    Alert.alert('Confirmar', `¿Eliminar el registro de ${nombre}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/produccion/trabajo/${id}`)
            onRefresh()
          } catch {
            Alert.alert('Error', 'No se pudo eliminar el registro.')
          }
        },
      },
    ])
  }

  if (registros.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="clipboard-outline" size={36} color="#d1d5db" />
        <Text style={styles.emptyStateTitle}>Sin registros recientes</Text>
        <Text style={styles.emptyStateSub}>Los registros de hoy aparecerán aquí</Text>
      </View>
    )
  }

  return (
    <View>
      <Text style={styles.sectionLabel}>REGISTROS RECIENTES</Text>
      {registros.map((r) => (
        <View key={r.id} style={styles.registroCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.registroNombre}>{r.trabajador_nombre}</Text>
            <Text style={styles.registroSub}>{r.tarea} · {r.fecha}</Text>
            <Text style={styles.registroMonto}>{formatMonto(r.monto_total)}</Text>
          </View>
          <TouchableOpacity onPress={() => handleDelete(r.id, r.trabajador_nombre)} style={styles.deleteBtn}>
            <Ionicons name="trash-outline" size={17} color="#ef4444" />
          </TouchableOpacity>
        </View>
      ))}
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
    const cached = await getCache<Parcela[]>('parcelas', CACHE_TTL.parcelas)
    if (cached) { setParcelas(cached); setLoadingParcelas(false) }
    try {
      const { data } = await api.get<Parcela[]>('/parcelas/mapa')
      const active = data.filter((p) => p.is_active)
      setParcelas(active)
      await setCache('parcelas', active)
    } catch { /* offline — use cache */ }
    finally { setLoadingParcelas(false) }
  }, [])

  const loadRegistros = useCallback(async () => {
    try {
      const { data } = await api.get<RegistroTrabajo[]>('/produccion/trabajo/?limit=20')
      setRegistros(data)
    } catch { /* offline */ }
    finally { setRefreshing(false) }
  }, [])

  useEffect(() => { loadParcelas(); loadRegistros() }, [loadParcelas, loadRegistros])

  function onRefresh() { setRefreshing(true); loadRegistros() }

  if (step === 'parcela') {
    return (
      <StepParcela
        parcelas={parcelas}
        onSelect={(p) => { setSelectedParcela(p); setStep('tarea') }}
      />
    )
  }

  if (step === 'tarea') {
    return (
      <StepTarea
        onSelect={(t) => { setSelectedTarea(t); setStep('carga') }}
      />
    )
  }

  if (step === 'carga' && selectedParcela) {
    return (
      <StepCarga
        parcela={selectedParcela}
        tarea={selectedTarea}
        onSuccess={() => { setStep('success'); loadRegistros() }}
        onBack={() => setStep('tarea')}
      />
    )
  }

  if (step === 'success') {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={40} color="#fff" />
        </View>
        <Text style={styles.successTitle}>Guardado</Text>
        <Text style={styles.successSub}>Los registros se cargaron al sistema</Text>
        <TouchableOpacity
          style={styles.successBtn}
          onPress={() => { setSelectedParcela(null); setSelectedTarea(''); setStep('list') }}
        >
          <Text style={styles.primaryBtnText}>Nueva carga</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
    >
      <TouchableOpacity style={styles.newBtn} onPress={() => setStep('parcela')} activeOpacity={0.85}>
        <Ionicons name="add-circle-outline" size={20} color="#fff" />
        <Text style={styles.newBtnText}>Nueva carga de tareas</Text>
      </TouchableOpacity>

      {loadingParcelas ? (
        <ActivityIndicator color="#16a34a" style={{ marginTop: 24 }} />
      ) : (
        <RecentList registros={registros} onRefresh={onRefresh} />
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  stepContainer: { flex: 1, backgroundColor: '#f4f6f8' },
  stepTitle: { fontSize: 20, fontWeight: '800', color: '#111827', marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  searchInput: {
    height: 48,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8eaed',
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
    paddingHorizontal: 14,
    backgroundColor: '#fff',
  },
  listItemTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
  listItemSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  separator: { height: 1, backgroundColor: '#f4f6f8' },
  emptyText: { color: '#9ca3af', textAlign: 'center', paddingVertical: 24 },
  ghostBtn: {
    marginTop: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  ghostBtnText: { color: '#6b7280', fontSize: 14, fontWeight: '500' },
  sectionHeader: { backgroundColor: '#f4f6f8', paddingVertical: 8, paddingHorizontal: 14 },
  sectionHeaderText: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8 },
  summaryBox: {
    backgroundColor: '#f0fdf4',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 12, color: '#166534', fontWeight: '600' },
  summaryValue: { fontSize: 14, color: '#166534', fontWeight: '700', flex: 1, textAlign: 'right' },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  dateBtn: {
    height: 48, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1,
    borderColor: '#e8eaed', paddingHorizontal: 14, marginBottom: 14,
  },
  dateBtnText: { flex: 1, fontSize: 15, color: '#111827', fontWeight: '500' },
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
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    marginRight: 8,
  },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  workersHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#16a34a',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  workerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  removeBtn: { width: 36, height: 48, justifyContent: 'center', alignItems: 'center' },
  actionRow: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    height: 52,
    backgroundColor: '#16a34a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#374151', fontSize: 15, fontWeight: '600' },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#16a34a',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 22,
    justifyContent: 'center',
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  newBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  registroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  registroNombre: { fontSize: 15, fontWeight: '700', color: '#111827' },
  registroSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  registroMonto: { fontSize: 14, fontWeight: '700', color: '#16a34a', marginTop: 5 },
  deleteBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyStateTitle: { fontSize: 15, fontWeight: '600', color: '#6b7280', marginTop: 12 },
  emptyStateSub: { fontSize: 13, color: '#9ca3af', marginTop: 4 },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f4f6f8',
    padding: 32,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#16a34a',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  successTitle: { fontSize: 26, fontWeight: '800', color: '#111827', marginBottom: 8 },
  successSub: { fontSize: 15, color: '#6b7280', marginBottom: 32, textAlign: 'center' },
  successBtn: {
    width: 240,
    height: 52,
    backgroundColor: '#16a34a',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
})
