import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import api from '../lib/api'
import { getCache, CACHE_TTL } from '../lib/cache'
import { colors, fonts } from '../lib/theme'
import type { Parcela } from '../lib/types'
import { useAuthStore } from '../store/authStore'

const FAVORITOS = ['Mancozeb', 'Azufre', 'Karate', 'Cobre', 'Folpet']

function isoToday() { return new Date().toISOString().split('T')[0] }

function formatDateDisplay(iso: string) {
  const [y, mo, d] = iso.split('-')
  return `${d}/${mo}/${y}`
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ['Fecha / Resp.', 'Detalle', 'Confirmar']

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
                <Ionicons name="checkmark" size={11} color={colors.blanco} />
              ) : (
                <Text style={[si.dotText, active && { color: colors.blanco }]}>{idx + 1}</Text>
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
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: colors.blanco,
    borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  item: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.hueso, justifyContent: 'center', alignItems: 'center',
  },
  dotActive: { backgroundColor: colors.tierra },
  dotDone:   { backgroundColor: colors.tierra },
  dotText:   { fontSize: 11, fontWeight: '700', color: colors.niebla },
  label:     { fontSize: 11, color: colors.niebla, marginLeft: 6, fontWeight: '500', flex: 1 },
  labelActive: { color: colors.ink, fontWeight: '700' },
  labelDone:   { color: colors.tierra, fontWeight: '600' },
  line:     { flex: 1, height: 1, backgroundColor: colors.hueso, marginHorizontal: 4 },
  lineDone: { backgroundColor: colors.tierra },
})

// ─── DatePickerModal ──────────────────────────────────────────────────────────

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

function DatePickerModal({
  visible, value, onConfirm, onClose,
}: {
  visible: boolean; value: string
  onConfirm: (d: string) => void; onClose: () => void
}) {
  const todayISO = isoToday()
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
      <View style={{ flex: 1, backgroundColor: colors.hueso }}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Seleccionar fecha</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={20} color={colors.ink} />
          </TouchableOpacity>
        </View>
        <View style={{ padding: 16 }}>
          <View style={dp.navRow}>
            <TouchableOpacity onPress={prevMonth} style={dp.navBtn}>
              <Ionicons name="chevron-back" size={18} color={colors.ink} />
            </TouchableOpacity>
            <Text style={dp.monthLabel}>{MONTH_NAMES[calMonth]} {calYear}</Text>
            <TouchableOpacity onPress={nextMonth} style={dp.navBtn}>
              <Ionicons name="chevron-forward" size={18} color={colors.ink} />
            </TouchableOpacity>
          </View>
          <View style={dp.dayNamesRow}>
            {DAY_NAMES.map((d) => <Text key={d} style={dp.dayName}>{d}</Text>)}
          </View>
          <View style={dp.grid}>
            {calDays.map((isoDate, idx) => {
              if (!isoDate) return <View key={`e-${idx}`} style={dp.cell} />
              const isSel = isoDate === selDate
              const isToday = isoDate === todayISO
              return (
                <TouchableOpacity
                  key={isoDate}
                  style={[dp.cell, isSel && dp.cellSel, !isSel && isToday && dp.cellToday]}
                  onPress={() => setSelDate(isoDate)}
                >
                  <Text style={[dp.cellText, isSel && dp.cellTextSel, !isSel && isToday && dp.cellTextToday]}>
                    {parseInt(isoDate.split('-')[2])}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
        <View style={{ padding: 16 }}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => { onConfirm(selDate); onClose() }}
          >
            <Text style={styles.primaryBtnText}>Confirmar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const dp = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.hueso, justifyContent: 'center', alignItems: 'center' },
  monthLabel: { fontSize: 16, fontWeight: '700', color: colors.ink },
  dayNamesRow: { flexDirection: 'row', marginBottom: 4 },
  dayName: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: colors.niebla, textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, justifyContent: 'center', alignItems: 'center', padding: 2 },
  cellSel: { backgroundColor: colors.tierra, borderRadius: 8 },
  cellToday: { backgroundColor: colors.crema, borderRadius: 8 },
  cellText: { fontSize: 15, fontWeight: '500', color: colors.ink },
  cellTextSel: { color: colors.blanco, fontWeight: '700' },
  cellTextToday: { color: colors.tierra, fontWeight: '700' },
})

// ─── Step 1: Fecha + Responsable ──────────────────────────────────────────────

function StepFechaResp({
  initialResponsable,
  onNext,
}: {
  initialResponsable: string
  onNext: (fecha: string, responsable: string) => void
}) {
  const [fecha, setFecha] = useState(isoToday())
  const [responsable, setResponsable] = useState(initialResponsable)
  const [dateVisible, setDateVisible] = useState(false)

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={0} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Fecha y Responsable</Text>

        <Text style={styles.fieldLabel}>FECHA</Text>
        <DatePickerModal
          visible={dateVisible}
          value={fecha}
          onConfirm={(d) => setFecha(d)}
          onClose={() => setDateVisible(false)}
        />
        <TouchableOpacity style={styles.dateBtn} onPress={() => setDateVisible(true)}>
          <Ionicons name="calendar-outline" size={16} color={colors.ink60} />
          <Text style={styles.dateBtnText}>{formatDateDisplay(fecha)}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.niebla} />
        </TouchableOpacity>

        <Text style={[styles.fieldLabel, { marginTop: 8 }]}>RESPONSABLE</Text>
        <TextInput
          style={styles.input}
          value={responsable}
          onChangeText={setResponsable}
          placeholder="Nombre del responsable"
          placeholderTextColor={colors.niebla}
          autoCapitalize="words"
        />

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 24 }]}
          onPress={() => {
            if (!responsable.trim()) { Alert.alert('Error', 'Ingresá el nombre del responsable.'); return }
            onNext(fecha, responsable.trim())
          }}
        >
          <Text style={styles.primaryBtnText}>Continuar</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}

// ─── Step 2: Detalle ──────────────────────────────────────────────────────────

type DetalleData = {
  parcela: Parcela | null
  producto: string
  dosis: string
  motivo: string
  diasCarencia: number
  diasReingreso: number
}

function StepDetalle({
  fecha, responsable, parcelas,
  onNext, onBack,
}: {
  fecha: string
  responsable: string
  parcelas: Parcela[]
  onNext: (data: DetalleData) => void
  onBack: () => void
}) {
  const [search, setSearch] = useState('')
  const [parcela, setParcela] = useState<Parcela | null>(null)
  const [selFav, setSelFav] = useState<string | null>(null)
  const [producto, setProducto] = useState('')
  const [dosis, setDosis] = useState('')
  const [motivo, setMotivo] = useState('')
  const [diasCarencia, setDiasCarencia] = useState(14)
  const [diasReingreso, setDiasReingreso] = useState(12)

  const filtered = parcelas
    .filter((p) => p.tipo === 'parral')
    .filter((p) => p.nombre.toLowerCase().includes(search.toLowerCase()))

  function selectFav(fav: string) {
    setSelFav(fav)
    setProducto(fav)
  }

  function addDays(iso: string, days: number): string {
    const d = new Date(iso)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  function handleNext() {
    const prod = producto.trim()
    if (!prod) { Alert.alert('Error', 'Ingresá o seleccioná un producto.'); return }
    if (!parcela) { Alert.alert('Error', 'Seleccioná una parcela.'); return }
    if (!motivo.trim()) { Alert.alert('Error', 'Ingresá el motivo de la aplicación.'); return }
    const dosisNum = parseFloat(dosis.replace(',', '.'))
    if (isNaN(dosisNum) || dosisNum <= 0) { Alert.alert('Error', 'Ingresá una dosis válida (lt/ha).'); return }
    onNext({ parcela, producto: prod, dosis, motivo: motivo.trim(), diasCarencia, diasReingreso })
  }

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={1} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Detalle</Text>

        {/* Mini resumen */}
        <View style={styles.summaryMini}>
          <Ionicons name="calendar-outline" size={14} color={colors.ink60} />
          <Text style={styles.summaryMiniText}>{formatDateDisplay(fecha)} · {responsable}</Text>
        </View>

        {/* Ubicación */}
        <Text style={[styles.fieldLabel, { marginTop: 16 }]}>UBICACIÓN (parcela)</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar parcela..."
          placeholderTextColor={colors.niebla}
          value={search}
          onChangeText={setSearch}
        />
        <View style={styles.parcelaList}>
          {filtered.slice(0, 6).map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.parcelaItem, parcela?.id === p.id && styles.parcelaItemActive]}
              onPress={() => setParcela(parcela?.id === p.id ? null : p)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.parcelaItemText, parcela?.id === p.id && { color: colors.blanco }]}>
                  {p.nombre}
                </Text>
                {p.superficie_ha != null && (
                  <Text style={[styles.parcelaItemSub, parcela?.id === p.id && { color: 'rgba(255,255,255,0.7)' }]}>
                    {p.superficie_ha.toFixed(2)} ha
                  </Text>
                )}
              </View>
              {parcela?.id === p.id && <Ionicons name="checkmark" size={16} color={colors.blanco} />}
            </TouchableOpacity>
          ))}
          {filtered.length === 0 && <Text style={styles.emptyText}>Sin resultados</Text>}
        </View>

        {/* Producto */}
        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>PRODUCTO</Text>
        <View style={styles.favGrid}>
          {FAVORITOS.map((fav) => (
            <TouchableOpacity
              key={fav}
              style={[styles.favChip, selFav === fav && styles.favChipActive]}
              onPress={() => selectFav(fav)}
              activeOpacity={0.75}
            >
              <Text style={[styles.favChipText, selFav === fav && styles.favChipTextActive]}>{fav}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          style={styles.input}
          value={producto}
          onChangeText={(v) => { setProducto(v); setSelFav(null) }}
          placeholder="Otro producto..."
          placeholderTextColor={colors.niebla}
          autoCapitalize="words"
        />

        {/* Dosis */}
        <Text style={styles.fieldLabel}>DOSIS (lt/ha)</Text>
        <TextInput
          style={styles.input}
          value={dosis}
          onChangeText={setDosis}
          placeholder="ej. 1.5"
          placeholderTextColor={colors.niebla}
          keyboardType="decimal-pad"
        />

        {/* Motivo */}
        <Text style={styles.fieldLabel}>MOTIVO</Text>
        <TextInput
          style={styles.input}
          value={motivo}
          onChangeText={setMotivo}
          placeholder="ej. Preventivo, Oídio, Botrytis..."
          placeholderTextColor={colors.niebla}
          autoCapitalize="sentences"
        />

        {/* Días */}
        <View style={styles.daysRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>DÍAS CARENCIA</Text>
            <View style={styles.daysStepperRow}>
              <TouchableOpacity style={styles.dayStepperBtn} onPress={() => setDiasCarencia((v) => Math.max(0, v - 1))}>
                <Ionicons name="remove" size={16} color={colors.ink} />
              </TouchableOpacity>
              <Text style={styles.daysValue}>{diasCarencia}</Text>
              <TouchableOpacity style={styles.dayStepperBtn} onPress={() => setDiasCarencia((v) => v + 1)}>
                <Ionicons name="add" size={16} color={colors.ink} />
              </TouchableOpacity>
            </View>
            <Text style={styles.daysHint}>
              Cosecha desde {formatDateDisplay(addDays(fecha, diasCarencia))}
            </Text>
          </View>
          <View style={{ width: 12 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>DÍAS REINGRESO</Text>
            <View style={styles.daysStepperRow}>
              <TouchableOpacity style={styles.dayStepperBtn} onPress={() => setDiasReingreso((v) => Math.max(0, v - 1))}>
                <Ionicons name="remove" size={16} color={colors.ink} />
              </TouchableOpacity>
              <Text style={styles.daysValue}>{diasReingreso}</Text>
              <TouchableOpacity style={styles.dayStepperBtn} onPress={() => setDiasReingreso((v) => v + 1)}>
                <Ionicons name="add" size={16} color={colors.ink} />
              </TouchableOpacity>
            </View>
            <Text style={styles.daysHint}>
              Reingreso desde {formatDateDisplay(addDays(fecha, diasReingreso))}
            </Text>
          </View>
        </View>

        <View style={[styles.actionRow, { marginTop: 24 }]}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
            <Text style={styles.secondaryBtnText}>Atrás</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtn, { flex: 2 }]}
            onPress={handleNext}
          >
            <Text style={styles.primaryBtnText}>Continuar</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

// ─── Step 3: Confirmar ────────────────────────────────────────────────────────

function StepConfirmar({
  fecha, responsable, parcela, producto, dosis, motivo, diasCarencia, diasReingreso,
  onSuccess, onBack,
}: {
  fecha: string
  responsable: string
  parcela: Parcela | null
  producto: string
  dosis: string
  motivo: string
  diasCarencia: number
  diasReingreso: number
  onSuccess: () => void
  onBack: () => void
}) {
  const [loading, setLoading] = useState(false)

  function addDays(iso: string, days: number): string {
    const d = new Date(iso)
    d.setDate(d.getDate() + days)
    return d.toISOString().split('T')[0]
  }

  async function handleSubmit() {
    const dosisNum = parseFloat(dosis.replace(',', '.'))
    try {
      setLoading(true)
      await api.post('/produccion/fitosanitarios/', {
        fecha,
        parcela_id: parcela?.id,
        producto_nombre: producto,
        dosis_lt_ha: dosisNum,
        motivo,
        dias_carencia: diasCarencia,
        dias_reingreso: diasReingreso,
        responsable,
      })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', typeof detail === 'string' ? detail : 'No se pudo guardar la aplicación.')
    } finally {
      setLoading(false)
    }
  }

  const rows = [
    { label: 'Fecha',        value: formatDateDisplay(fecha) },
    { label: 'Responsable',  value: responsable },
    { label: 'Parcela',      value: parcela?.nombre ?? 'Sin parcela' },
    { label: 'Producto',     value: producto },
    { label: 'Dosis',        value: `${dosis} lt/ha` },
    { label: 'Motivo',       value: motivo },
    { label: 'Días carencia',  value: `${diasCarencia} días` },
    { label: 'Días reingreso', value: `${diasReingreso} días` },
    { label: 'Hab. cosecha',   value: formatDateDisplay(addDays(fecha, diasCarencia)) },
    { label: 'Hab. reingreso', value: formatDateDisplay(addDays(fecha, diasReingreso)) },
  ]

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={2} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Confirmar</Text>

        <View style={styles.summaryCard}>
          {rows.map(({ label, value }, idx) => (
            <View key={label} style={[styles.summaryRow, idx < rows.length - 1 && styles.summaryRowBorder]}>
              <Text style={styles.summaryLabel}>{label}</Text>
              <Text style={[styles.summaryValue, { flex: 1, textAlign: 'right' }]}>{value}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.actionRow, { marginTop: 24 }]}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
            <Text style={styles.secondaryBtnText}>Atrás</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primaryBtn, { flex: 2 }, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.blanco} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color={colors.blanco} style={{ marginRight: 6 }} />
                <Text style={styles.primaryBtnText}>Confirmar</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

type Step = 'fecha_resp' | 'detalle' | 'confirmar' | 'success'

export default function FitoScreen() {
  const user = useAuthStore((s) => s.user)
  const [step, setStep] = useState<Step>('fecha_resp')
  const [parcelas, setParcelas] = useState<Parcela[]>([])

  const [selFecha, setSelFecha] = useState(isoToday())
  const [selResponsable, setSelResponsable] = useState('')
  const [selDetalle, setSelDetalle] = useState<DetalleData | null>(null)

  const initialResponsable = user?.full_name?.split(' ')[0] ?? ''

  const loadParcelas = useCallback(async () => {
    const cached = await getCache<Parcela[]>('parcelas', CACHE_TTL.parcelas)
    if (cached) { setParcelas(cached); return }
    try {
      const { data } = await api.get<Parcela[]>('/parcelas/mapa')
      setParcelas(data.filter((p) => p.is_active))
    } catch { /* offline */ }
  }, [])

  useEffect(() => { loadParcelas() }, [loadParcelas])

  function reset() {
    setSelFecha(isoToday())
    setSelResponsable('')
    setSelDetalle(null)
    setStep('fecha_resp')
  }

  if (step === 'detalle') {
    return (
      <StepDetalle
        fecha={selFecha}
        responsable={selResponsable}
        parcelas={parcelas}
        onNext={(data) => { setSelDetalle(data); setStep('confirmar') }}
        onBack={() => setStep('fecha_resp')}
      />
    )
  }

  if (step === 'confirmar' && selDetalle) {
    return (
      <StepConfirmar
        fecha={selFecha}
        responsable={selResponsable}
        parcela={selDetalle.parcela}
        producto={selDetalle.producto}
        dosis={selDetalle.dosis}
        motivo={selDetalle.motivo}
        diasCarencia={selDetalle.diasCarencia}
        diasReingreso={selDetalle.diasReingreso}
        onSuccess={() => setStep('success')}
        onBack={() => setStep('detalle')}
      />
    )
  }

  if (step === 'success') {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successIcon}>
          <Ionicons name="flask" size={36} color={colors.blanco} />
        </View>
        <Text style={[styles.successTitle, { fontFamily: fonts.display }]}>
          Aplicación registrada
        </Text>
        <Text style={styles.successSub}>La fitosanitaria fue guardada correctamente</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={reset}>
          <Text style={styles.primaryBtnText}>Nueva aplicación</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <StepFechaResp
      initialResponsable={initialResponsable}
      onNext={(f, r) => { setSelFecha(f); setSelResponsable(r); setStep('detalle') }}
    />
  )
}

const styles = StyleSheet.create({
  stepContainer: { flex: 1, backgroundColor: colors.hueso },
  stepTitle: { fontSize: 20, fontWeight: '800', color: colors.ink, marginBottom: 20 },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },

  // summary mini
  summaryMini: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.blanco, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: colors.hueso,
  },
  summaryMiniText: { fontSize: 14, fontWeight: '600', color: colors.ink },

  // favoritos
  favGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  favChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.hueso, backgroundColor: colors.blanco,
  },
  favChipActive: { backgroundColor: colors.tierra, borderColor: colors.tierra },
  favChipText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  favChipTextActive: { color: colors.blanco },

  // input
  input: {
    height: 48, backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.hueso,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 14,
  },
  searchInput: {
    height: 46, backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.hueso,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 8,
  },

  // parcela list
  parcelaList: {
    backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.hueso, overflow: 'hidden', marginBottom: 4,
  },
  parcelaItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  parcelaItemActive: { backgroundColor: colors.tierra },
  parcelaItemText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  parcelaItemSub: { fontSize: 12, color: colors.ink60, marginTop: 1 },
  emptyText: { color: colors.niebla, textAlign: 'center', paddingVertical: 16, fontSize: 13 },

  // date btn
  dateBtn: {
    height: 48, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.hueso, paddingHorizontal: 14, marginBottom: 14,
  },
  dateBtnText: { flex: 1, fontSize: 15, color: colors.ink, fontWeight: '500' },

  // días
  daysRow: { flexDirection: 'row', marginBottom: 8 },
  daysStepperRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  dayStepperBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.blanco, borderWidth: 1.5, borderColor: colors.hueso,
    justifyContent: 'center', alignItems: 'center',
  },
  daysValue: { fontSize: 22, fontWeight: '800', color: colors.ink, minWidth: 36, textAlign: 'center' },
  daysHint: { fontSize: 10, color: colors.niebla, fontWeight: '500' },

  // summary card (step 3)
  summaryCard: {
    backgroundColor: colors.blanco, borderRadius: 16,
    borderWidth: 1, borderColor: colors.hueso, overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13,
  },
  summaryRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hueso },
  summaryLabel: { fontSize: 13, color: colors.ink60, fontWeight: '600' },
  summaryValue: { fontSize: 13, color: colors.ink, fontWeight: '700' },

  // actions
  actionRow: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    height: 52, backgroundColor: colors.tierra, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', flexDirection: 'row',
  },
  primaryBtnText: { color: colors.blanco, fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    flex: 1, height: 52, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.hueso,
    backgroundColor: colors.blanco, justifyContent: 'center', alignItems: 'center',
  },
  secondaryBtnText: { color: colors.ink, fontSize: 15, fontWeight: '600' },

  // success
  successContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.hueso, padding: 32,
  },
  successIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.tierra,
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
    shadowColor: colors.tierra,
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  successTitle: { fontSize: 26, color: colors.ink, marginBottom: 8 },
  successSub: { fontSize: 15, color: colors.ink60, marginBottom: 32, textAlign: 'center' },

  // modal
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, backgroundColor: colors.blanco,
    borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.hueso, justifyContent: 'center', alignItems: 'center',
  },
})
