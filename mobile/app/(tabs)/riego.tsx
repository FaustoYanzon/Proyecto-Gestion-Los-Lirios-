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
import api from '../../lib/api'
import { useAuthStore } from '../../store/authStore'
import type { Parcela, RegistroRiego, RiegoPayload } from '../../lib/types'
import { getValvulasForParcela, calcMmRiego } from '../../lib/types'

function isoToday() {
  return new Date().toISOString().split('T')[0]
}

function buildISO(date: string, hour: number, minute: number): string {
  const h = String(hour).padStart(2, '0')
  const m = String(minute).padStart(2, '0')
  return `${date}T${h}:${m}:00`
}

function formatDateDisplay(dateISO: string): string {
  const [y, mo, d] = dateISO.split('-')
  return `${d}/${mo}/${y}`
}

function formatTimeDisplay(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function formatDatetime(dt: string) {
  try {
    return new Date(dt).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return dt }
}

const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DAY_NAMES = ['Lu','Ma','Mi','Ju','Vi','Sa','Do']

function buildCalendarDays(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1).getDay() // 0=Sun
  const offset = firstDay === 0 ? 6 : firstDay - 1   // shift so Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = Array(offset).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const mm = String(month + 1).padStart(2, '0')
    const dd = String(d).padStart(2, '0')
    cells.push(`${year}-${mm}-${dd}`)
  }
  return cells
}

// ─── Parcela picker modal ─────────────────────────────────────────────────────

function ParcelaPicker({
  visible, parcelas, onSelect, onClose,
}: {
  visible: boolean; parcelas: Parcela[]; onSelect: (p: Parcela) => void; onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const filtered = parcelas.filter((p) => p.nombre.toLowerCase().includes(search.toLowerCase()))

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Seleccionar parral</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={20} color="#374151" />
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar..."
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
              <View style={{ flex: 1 }}>
                <Text style={styles.modalItemText}>{item.nombre}</Text>
                <Text style={styles.modalItemSub}>
                  Cabezal {item.cabezal_riego ?? '—'}
                  {item.superficie_ha ? ` · ${item.superficie_ha.toFixed(2)} ha` : ''}
                </Text>
              </View>
              <View style={styles.cabezalBadge}>
                <Text style={styles.cabezalBadgeText}>CAB. {item.cabezal_riego}</Text>
              </View>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </View>
    </Modal>
  )
}

// ─── Date+Time picker modal ───────────────────────────────────────────────────

const MINUTE_OPTIONS = [0, 15, 30, 45]

function DateTimePicker({
  visible, label, date, hour, minute,
  onConfirm, onClose,
}: {
  visible: boolean
  label: string
  date: string
  hour: number
  minute: number
  onConfirm: (date: string, hour: number, minute: number) => void
  onClose: () => void
}) {
  const todayISO = new Date().toISOString().split('T')[0]
  const [selDate, setSelDate] = useState(date)
  const [selHour, setSelHour] = useState(hour)
  const [selMin, setSelMin] = useState(minute)
  const [calYear, setCalYear] = useState(() => parseInt(date.split('-')[0]))
  const [calMonth, setCalMonth] = useState(() => parseInt(date.split('-')[1]) - 1)

  useEffect(() => {
    if (visible) {
      setSelDate(date); setSelHour(hour); setSelMin(minute)
      setCalYear(parseInt(date.split('-')[0]))
      setCalMonth(parseInt(date.split('-')[1]) - 1)
    }
  }, [visible, date, hour, minute])

  const HOURS = Array.from({ length: 24 }, (_, i) => i)
  const calDays = buildCalendarDays(calYear, calMonth)

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1) }
    else setCalMonth(calMonth - 1)
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1) }
    else setCalMonth(calMonth + 1)
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{label}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={20} color="#374151" />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
          {/* Calendar */}
          <View style={dtStyles.section}>
            <View style={dtStyles.calNavRow}>
              <TouchableOpacity onPress={prevMonth} style={dtStyles.navBtn}>
                <Ionicons name="chevron-back" size={18} color="#374151" />
              </TouchableOpacity>
              <Text style={dtStyles.calMonthLabel}>
                {MONTH_NAMES[calMonth]} {calYear}
              </Text>
              <TouchableOpacity onPress={nextMonth} style={dtStyles.navBtn}>
                <Ionicons name="chevron-forward" size={18} color="#374151" />
              </TouchableOpacity>
            </View>

            <View style={dtStyles.dayNamesRow}>
              {DAY_NAMES.map((d) => (
                <Text key={d} style={dtStyles.dayName}>{d}</Text>
              ))}
            </View>

            <View style={dtStyles.calGrid}>
              {calDays.map((isoDate, idx) => {
                if (!isoDate) return <View key={`e-${idx}`} style={dtStyles.calCell} />
                const isSelected = isoDate === selDate
                const isToday = isoDate === todayISO
                return (
                  <TouchableOpacity
                    key={isoDate}
                    style={[
                      dtStyles.calCell,
                      isSelected && dtStyles.calCellSelected,
                      !isSelected && isToday && dtStyles.calCellToday,
                    ]}
                    onPress={() => setSelDate(isoDate)}
                  >
                    <Text style={[
                      dtStyles.calCellText,
                      isSelected && dtStyles.calCellTextSelected,
                      !isSelected && isToday && dtStyles.calCellTextToday,
                    ]}>
                      {parseInt(isoDate.split('-')[2])}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>

          {/* Hour selector */}
          <View style={dtStyles.section}>
            <Text style={dtStyles.sectionLabel}>HORA</Text>
            <View style={dtStyles.hourGrid}>
              {HOURS.map((h) => (
                <TouchableOpacity
                  key={h}
                  style={[dtStyles.hourBtn, selHour === h && dtStyles.hourBtnActive]}
                  onPress={() => setSelHour(h)}
                >
                  <Text style={[dtStyles.hourBtnText, selHour === h && dtStyles.hourBtnTextActive]}>
                    {String(h).padStart(2, '0')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Minute selector */}
          <View style={dtStyles.section}>
            <Text style={dtStyles.sectionLabel}>MINUTOS</Text>
            <View style={dtStyles.minuteRow}>
              {MINUTE_OPTIONS.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[dtStyles.minBtn, selMin === m && dtStyles.minBtnActive]}
                  onPress={() => setSelMin(m)}
                >
                  <Text style={[dtStyles.minBtnText, selMin === m && dtStyles.minBtnTextActive]}>
                    :{String(m).padStart(2, '0')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Preview */}
          <View style={dtStyles.preview}>
            <Ionicons name="time-outline" size={16} color="#16a34a" />
            <Text style={dtStyles.previewText}>
              {formatDateDisplay(selDate)} a las {formatTimeDisplay(selHour, selMin)}
            </Text>
          </View>
        </ScrollView>

        <View style={{ padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f0f2f5' }}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => { onConfirm(selDate, selHour, selMin); onClose() }}
          >
            <Text style={styles.primaryBtnText}>Confirmar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const dtStyles = StyleSheet.create({
  section: { paddingHorizontal: 16, marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  calNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  calMonthLabel: { fontSize: 15, fontWeight: '700', color: '#111827' },
  dayNamesRow: { flexDirection: 'row', marginBottom: 4 },
  dayName: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, justifyContent: 'center', alignItems: 'center', padding: 2 },
  calCellSelected: { backgroundColor: '#16a34a', borderRadius: 8 },
  calCellToday: { backgroundColor: '#f0fdf4', borderRadius: 8 },
  calCellText: { fontSize: 14, fontWeight: '500', color: '#374151' },
  calCellTextSelected: { color: '#fff', fontWeight: '700' },
  calCellTextToday: { color: '#16a34a', fontWeight: '700' },
  hourGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hourBtn: {
    width: 48, height: 36, borderRadius: 8, borderWidth: 1,
    borderColor: '#e5e7eb', backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
  },
  hourBtnActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  hourBtnText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  hourBtnTextActive: { color: '#fff' },
  minuteRow: { flexDirection: 'row', gap: 10 },
  minBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5,
    borderColor: '#e5e7eb', backgroundColor: '#fff', alignItems: 'center',
  },
  minBtnActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  minBtnText: { fontSize: 15, fontWeight: '700', color: '#374151' },
  minBtnTextActive: { color: '#fff' },
  preview: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f0fdf4', borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 12, marginHorizontal: 16, marginBottom: 4,
  },
  previewText: { fontSize: 15, fontWeight: '700', color: '#166534' },
})

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function RiegoScreen() {
  const user = useAuthStore((s) => s.user)
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [riegos, setRiegos] = useState<RegistroRiego[]>([])
  const [pickerVisible, setPickerVisible] = useState(false)
  const [dtPickerTarget, setDtPickerTarget] = useState<'inicio' | 'fin' | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Form state
  const [parcela, setParcela] = useState<Parcela | null>(null)
  const [selectedValvulas, setSelectedValvulas] = useState<Set<string>>(new Set())

  const now = new Date()
  const [inicioDate, setInicioDate] = useState(isoToday())
  const [inicioHour, setInicioHour] = useState(now.getHours())
  const [inicioMin, setInicioMin] = useState(0)

  const [finDate, setFinDate] = useState(isoToday())
  const [finHour, setFinHour] = useState(Math.min(now.getHours() + 4, 23))
  const [finMin, setFinMin] = useState(0)

  const [mmAplicados, setMmAplicados] = useState('')
  const [fertNombre, setFertNombre] = useState('')
  const [fertDosis, setFertDosis] = useState('')
  const [responsable, setResponsable] = useState(user?.full_name ?? '')
  const [conFertilizante, setConFertilizante] = useState(false)

  // Derived
  const cabezal = parcela?.cabezal_riego ?? null
  const valvulasDisponibles = parcela ? getValvulasForParcela(parcela.nombre) : []

  const inicioISO = buildISO(inicioDate, inicioHour, inicioMin)
  const finISO = buildISO(finDate, finHour, finMin)
  const mmPreview = calcMmRiego(inicioISO, finISO)

  const loadData = useCallback(async () => {
    try {
      const [parcelasRes, riegosRes] = await Promise.all([
        api.get<Parcela[]>('/parcelas/mapa'),
        api.get<RegistroRiego[]>('/produccion/riego/?limit=10'),
      ])
      const parrales = parcelasRes.data.filter(
        (p) => p.is_active && p.tipo === 'parral' && p.cabezal_riego && p.cabezal_riego !== 'MANTO'
      )
      setParcelas(parrales)
      setRiegos(riegosRes.data)
    } catch { /* offline */ }
    finally { setRefreshing(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  function onRefresh() { setRefreshing(true); loadData() }

  function handleSelectParcela(p: Parcela) {
    setParcela(p)
    setSelectedValvulas(new Set())
  }

  function toggleValvula(v: string) {
    setSelectedValvulas((prev) => {
      const next = new Set(prev)
      next.has(v) ? next.delete(v) : next.add(v)
      return next
    })
  }

  async function handleSubmit() {
    if (!parcela) { Alert.alert('Error', 'Seleccioná una parcela.'); return }
    if (!cabezal) { Alert.alert('Error', 'Esta parcela no tiene cabezal asignado.'); return }
    if (selectedValvulas.size === 0) { Alert.alert('Error', 'Seleccioná al menos una válvula.'); return }
    if (!responsable.trim()) { Alert.alert('Error', 'Ingresá el responsable.'); return }

    const iniDate = new Date(inicioISO)
    const finDate2 = new Date(finISO)
    if (finDate2 <= iniDate) { Alert.alert('Error', 'El fin debe ser posterior al inicio.'); return }

    const valvula = Array.from(selectedValvulas).sort().join(',')
    const payload: RiegoPayload = {
      fecha: inicioDate,
      parcela_id: parcela.id,
      cabezal,
      valvula,
      inicio: iniDate.toISOString(),
      fin: finDate2.toISOString(),
      responsable: responsable.trim(),
    }
    if (mmAplicados) payload.mm_aplicados = Number(mmAplicados)
    if (conFertilizante && fertNombre.trim()) payload.fertilizante_nombre = fertNombre.trim()
    if (conFertilizante && fertDosis) payload.fertilizante_dosis_lt_ha = Number(fertDosis)

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
    setSelectedValvulas(new Set())
    const n = new Date()
    setInicioDate(isoToday()); setInicioHour(n.getHours()); setInicioMin(0)
    setFinDate(isoToday()); setFinHour(Math.min(n.getHours() + 4, 23)); setFinMin(0)
    setMmAplicados(''); setFertNombre(''); setFertDosis('')
    setResponsable(user?.full_name ?? '')
    setConFertilizante(false)
    setSubmitted(false)
  }

  function parcelaNombre(id: string): string {
    return parcelas.find((p) => p.id === id)?.nombre ?? '—'
  }

  if (submitted) {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successIcon}>
          <Ionicons name="water" size={36} color="#fff" />
        </View>
        <Text style={styles.successTitle}>Riego registrado</Text>
        <Text style={styles.successSub}>Se guardó el registro correctamente</Text>
        <TouchableOpacity style={styles.successBtn} onPress={resetForm}>
          <Text style={styles.primaryBtnText}>Nuevo riego</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <>
      <ParcelaPicker
        visible={pickerVisible}
        parcelas={parcelas}
        onSelect={handleSelectParcela}
        onClose={() => setPickerVisible(false)}
      />
      <DateTimePicker
        visible={dtPickerTarget === 'inicio'}
        label="Inicio del riego"
        date={inicioDate}
        hour={inicioHour}
        minute={inicioMin}
        onConfirm={(d, h, m) => { setInicioDate(d); setInicioHour(h); setInicioMin(m) }}
        onClose={() => setDtPickerTarget(null)}
      />
      <DateTimePicker
        visible={dtPickerTarget === 'fin'}
        label="Fin del riego"
        date={finDate}
        hour={finHour}
        minute={finMin}
        onConfirm={(d, h, m) => { setFinDate(d); setFinHour(h); setFinMin(m) }}
        onClose={() => setDtPickerTarget(null)}
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
      >
        <Text style={styles.screenTitle}>Registrar riego</Text>

        {/* Parcela */}
        <Text style={styles.fieldLabel}>PARCELA</Text>
        <TouchableOpacity style={styles.pickerBtn} onPress={() => setPickerVisible(true)}>
          <View style={{ flex: 1 }}>
            <Text style={parcela ? styles.pickerValue : styles.pickerPlaceholder}>
              {parcela ? parcela.nombre : 'Seleccionar parral...'}
            </Text>
            {parcela && cabezal && (
              <Text style={styles.pickerSub}>Cabezal {cabezal}</Text>
            )}
          </View>
          <Ionicons name="chevron-down" size={16} color="#9ca3af" />
        </TouchableOpacity>

        {/* Cabezal — read only derived from parcela */}
        {parcela && cabezal && (
          <View style={styles.cabezalInfo}>
            <Ionicons name="water-outline" size={14} color="#2563eb" />
            <Text style={styles.cabezalInfoText}>Cabezal {cabezal} asignado automáticamente</Text>
          </View>
        )}

        {/* Válvulas */}
        {parcela && (
          <>
            <Text style={[styles.fieldLabel, { marginTop: 4 }]}>VÁLVULAS ABIERTAS</Text>
            <View style={styles.valvulasRow}>
              {valvulasDisponibles.map((v) => {
                const active = selectedValvulas.has(v)
                return (
                  <TouchableOpacity
                    key={v}
                    style={[styles.valvulaChip, active && styles.valvulaChipActive]}
                    onPress={() => toggleValvula(v)}
                  >
                    <Text style={[styles.valvulaChipText, active && styles.valvulaChipTextActive]}>
                      Válvula {v}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </>
        )}

        {/* Datetime pickers */}
        <Text style={[styles.fieldLabel, { marginTop: 4 }]}>HORARIO</Text>
        <View style={styles.datetimeRow}>
          <TouchableOpacity
            style={styles.datetimeBtn}
            onPress={() => setDtPickerTarget('inicio')}
          >
            <Text style={styles.datetimeBtnLabel}>Inicio</Text>
            <Text style={styles.datetimeBtnValue}>{formatTimeDisplay(inicioHour, inicioMin)}</Text>
            <Text style={styles.datetimeBtnDate}>{formatDateDisplay(inicioDate)}</Text>
          </TouchableOpacity>
          <View style={styles.datetimeArrow}>
            <Ionicons name="arrow-forward" size={18} color="#9ca3af" />
          </View>
          <TouchableOpacity
            style={styles.datetimeBtn}
            onPress={() => setDtPickerTarget('fin')}
          >
            <Text style={styles.datetimeBtnLabel}>Fin</Text>
            <Text style={styles.datetimeBtnValue}>{formatTimeDisplay(finHour, finMin)}</Text>
            <Text style={styles.datetimeBtnDate}>{formatDateDisplay(finDate)}</Text>
          </TouchableOpacity>
        </View>

        {/* MM preview */}
        {mmPreview !== null && (
          <View style={styles.mmPreview}>
            <Ionicons name="water" size={14} color="#2563eb" />
            <Text style={styles.mmPreviewText}>
              {(new Date(finISO).getTime() - new Date(inicioISO).getTime()) / 3600000 < 1
                ? (((new Date(finISO).getTime() - new Date(inicioISO).getTime()) / 3600000).toFixed(1) + ' h')
                : (((new Date(finISO).getTime() - new Date(inicioISO).getTime()) / 3600000).toFixed(1) + ' h')
              } de riego → <Text style={{ fontWeight: '800', color: '#1e40af' }}>{mmPreview} mm</Text>
            </Text>
          </View>
        )}

        {/* Responsable */}
        <Text style={[styles.fieldLabel, { marginTop: 4 }]}>RESPONSABLE</Text>
        <TextInput
          style={styles.input}
          value={responsable}
          onChangeText={setResponsable}
          placeholder="Nombre del responsable"
          placeholderTextColor="#9ca3af"
          autoCapitalize="words"
        />

        {/* mm aplicados manual */}
        <Text style={styles.fieldLabel}>MM APLICADOS (opcional)</Text>
        <TextInput
          style={styles.input}
          value={mmAplicados}
          onChangeText={setMmAplicados}
          placeholder={mmPreview !== null ? `Auto: ${mmPreview} mm` : 'Se calcula del horario'}
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
        />

        {/* Fertilizante toggle */}
        <TouchableOpacity
          style={styles.fertToggle}
          onPress={() => setConFertilizante(!conFertilizante)}
        >
          <View style={[styles.toggle, conFertilizante && styles.toggleActive]}>
            {conFertilizante && <View style={styles.toggleKnobRight} />}
            {!conFertilizante && <View style={styles.toggleKnobLeft} />}
          </View>
          <Text style={styles.fertToggleText}>Con fertiriego</Text>
        </TouchableOpacity>

        {conFertilizante && (
          <View style={styles.fertSection}>
            <Text style={styles.fieldLabel}>FERTILIZANTE</Text>
            <TextInput
              style={styles.input}
              value={fertNombre}
              onChangeText={setFertNombre}
              placeholder="Nombre del producto"
              placeholderTextColor="#9ca3af"
            />
            <Text style={styles.fieldLabel}>DOSIS (L/HA)</Text>
            <TextInput
              style={styles.input}
              value={fertDosis}
              onChangeText={setFertDosis}
              placeholder="0.0"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
            />
          </View>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 8 }, loading && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Guardar riego</Text>}
        </TouchableOpacity>

        {/* Recent riegos */}
        <Text style={[styles.sectionLabel, { marginTop: 28 }]}>RIEGOS RECIENTES</Text>
        {riegos.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="water-outline" size={36} color="#d1d5db" />
            <Text style={styles.emptyStateTitle}>Sin riegos recientes</Text>
          </View>
        ) : (
          riegos.map((r) => (
            <View key={r.id} style={styles.riegoCard}>
              <View style={styles.riegoCardHeader}>
                <Text style={styles.riegoParcelaNombre}>{parcelaNombre(r.parcela_id)}</Text>
                <Text style={styles.riegoDate}>{r.fecha}</Text>
              </View>
              <View style={styles.riegoCardMeta}>
                <View style={styles.riegoBadge}>
                  <Text style={styles.riegoBadgeText}>Cab. {r.cabezal}</Text>
                </View>
                <View style={[styles.riegoBadge, { backgroundColor: '#eff6ff' }]}>
                  <Text style={[styles.riegoBadgeText, { color: '#2563eb' }]}>Válv. {r.valvula}</Text>
                </View>
              </View>
              <Text style={styles.riegoSub}>
                {formatDatetime(r.inicio)} → {formatDatetime(r.fin)}
              </Text>
              <View style={styles.riegoStats}>
                <Text style={styles.riegoStatItem}>{r.duracion_horas.toFixed(1)} h</Text>
                {r.mm_aplicados != null && (
                  <Text style={styles.riegoStatItem}>{r.mm_aplicados} mm</Text>
                )}
                {r.fertilizante_nombre && (
                  <Text style={styles.riegoStatItem}>{r.fertilizante_nombre}</Text>
                )}
              </View>
              <Text style={styles.riegoResp}>{r.responsable}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  screenTitle: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 20 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: '#6b7280', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 },
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
  pickerBtn: {
    minHeight: 52,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e8eaed',
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  pickerValue: { fontSize: 15, color: '#111827', fontWeight: '600' },
  pickerPlaceholder: { fontSize: 15, color: '#9ca3af' },
  pickerSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  cabezalInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
  },
  cabezalInfoText: { fontSize: 13, color: '#2563eb', fontWeight: '600' },
  valvulasRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  valvulaChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#fff',
  },
  valvulaChipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  valvulaChipText: { fontSize: 14, color: '#374151', fontWeight: '600' },
  valvulaChipTextActive: { color: '#fff' },
  datetimeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  datetimeBtn: {
    flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5,
    borderColor: '#e8eaed', paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center',
  },
  datetimeBtnLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.4 },
  datetimeBtnValue: { fontSize: 22, fontWeight: '800', color: '#111827', marginTop: 2 },
  datetimeBtnDate: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  datetimeArrow: { width: 28, alignItems: 'center' },
  mmPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#eff6ff', borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 10, marginBottom: 16,
  },
  mmPreviewText: { fontSize: 14, color: '#2563eb', fontWeight: '600', flex: 1 },
  fertToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, marginBottom: 14,
  },
  toggle: {
    width: 44, height: 24, borderRadius: 12, backgroundColor: '#e5e7eb',
    justifyContent: 'center', paddingHorizontal: 3,
  },
  toggleActive: { backgroundColor: '#16a34a' },
  toggleKnobLeft: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: 'flex-start' },
  toggleKnobRight: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: 'flex-end' },
  fertToggleText: { fontSize: 15, color: '#374151', fontWeight: '600' },
  fertSection: {
    backgroundColor: '#f8fafc', borderRadius: 12, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: '#e5e7eb',
  },
  primaryBtn: {
    height: 52, backgroundColor: '#16a34a', borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  riegoCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  riegoCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  riegoParcelaNombre: { fontSize: 15, fontWeight: '700', color: '#111827' },
  riegoDate: { fontSize: 12, color: '#9ca3af' },
  riegoCardMeta: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  riegoBadge: {
    backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6,
  },
  riegoBadgeText: { fontSize: 11, fontWeight: '700', color: '#166534' },
  riegoSub: { fontSize: 12, color: '#6b7280', marginBottom: 6 },
  riegoStats: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  riegoStatItem: { fontSize: 13, fontWeight: '700', color: '#374151' },
  riegoResp: { fontSize: 12, color: '#16a34a', fontWeight: '600' },
  emptyState: { alignItems: 'center', paddingVertical: 32 },
  emptyStateTitle: { fontSize: 14, color: '#9ca3af', marginTop: 10 },
  successContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#f4f6f8', padding: 32,
  },
  successIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: '#2563eb',
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
    shadowColor: '#2563eb', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  successTitle: { fontSize: 26, fontWeight: '800', color: '#111827', marginBottom: 8 },
  successSub: { fontSize: 15, color: '#6b7280', marginBottom: 32, textAlign: 'center' },
  successBtn: {
    width: 240, height: 52, backgroundColor: '#2563eb', borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#2563eb', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  // Modal
  modalContainer: { flex: 1, backgroundColor: '#f4f6f8', paddingTop: 16 },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#f0f2f5',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },
  searchInput: {
    height: 46, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1,
    borderColor: '#e8eaed', paddingHorizontal: 14, fontSize: 15, color: '#111827',
    marginHorizontal: 16, marginBottom: 12,
  },
  modalItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
    paddingHorizontal: 16, backgroundColor: '#fff',
  },
  modalItemText: { fontSize: 15, fontWeight: '600', color: '#111827' },
  modalItemSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  cabezalBadge: {
    backgroundColor: '#eff6ff', paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 6, marginLeft: 10,
  },
  cabezalBadgeText: { fontSize: 10, fontWeight: '800', color: '#2563eb', letterSpacing: 0.5 },
  separator: { height: 1, backgroundColor: '#f4f6f8' },
})
