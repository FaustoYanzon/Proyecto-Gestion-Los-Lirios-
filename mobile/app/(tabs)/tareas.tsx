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
  SectionList,
  Modal,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import api from '../../lib/api'
import { getCache, setCache, CACHE_TTL } from '../../lib/cache'
import { colors, fonts } from '../../lib/theme'
import type { Parcela, RegistroTrabajo, UnidadMedida } from '../../lib/types'
import { TAREAS_POR_TEMPORADA, UNIDAD_LABELS } from '../../lib/types'

const TOP_5_TAREAS = ['Poda', 'Verde', 'Jornal Comun', 'Cosecha', 'Raleo']
const UNIDADES: UnidadMedida[] = ['dias', 'plantas', 'melgas', 'metros', 'vines', 'cajas', 'gamelas', 'otros']

function isoToday() { return new Date().toISOString().split('T')[0] }

function formatDateDisplay(iso: string) {
  const [y, mo, d] = iso.split('-')
  return `${d}/${mo}/${y}`
}

function formatMonto(v: string | number) {
  return Number(v).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
}

// ─── Step indicator (4 pasos) ─────────────────────────────────────────────────

const STEP_LABELS = ['Tarea', 'Detalle', 'Trabajadores', 'Confirmar']

function StepIndicator({ current }: { current: 0 | 1 | 2 | 3 }) {
  return (
    <View style={si.row}>
      {STEP_LABELS.map((label, idx) => {
        const done = idx < current
        const active = idx === current
        return (
          <View key={label} style={si.item}>
            <View style={[si.dot, done && si.dotDone, active && si.dotActive]}>
              {done ? (
                <Ionicons name="checkmark" size={10} color={colors.blanco} />
              ) : (
                <Text style={[si.dotText, active && { color: colors.blanco }]}>{idx + 1}</Text>
              )}
            </View>
            <Text style={[si.label, active && si.labelActive, done && si.labelDone]} numberOfLines={1}>{label}</Text>
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
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: colors.blanco,
    borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  item: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.hueso, justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  dotActive: { backgroundColor: colors.burdeos[600] },
  dotDone:   { backgroundColor: colors.burdeos[600] },
  dotText:   { fontSize: 10, fontWeight: '700', color: colors.niebla },
  label:     { fontSize: 9, color: colors.niebla, marginLeft: 4, fontWeight: '500', flex: 1 },
  labelActive: { color: colors.ink, fontWeight: '700' },
  labelDone:   { color: colors.burdeos[600], fontWeight: '600' },
  line:     { flex: 1, height: 1, backgroundColor: colors.hueso, marginHorizontal: 3 },
  lineDone: { backgroundColor: colors.burdeos[600] },
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
            {DAY_NAMES.map((d) => (
              <Text key={d} style={dp.dayName}>{d}</Text>
            ))}
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
  cellSel: { backgroundColor: colors.burdeos[600], borderRadius: 8 },
  cellToday: { backgroundColor: colors.crema, borderRadius: 8 },
  cellText: { fontSize: 15, fontWeight: '500', color: colors.ink },
  cellTextSel: { color: colors.blanco, fontWeight: '700' },
  cellTextToday: { color: colors.burdeos[600], fontWeight: '700' },
})

// ─── Step 1: Tarea + Fecha ────────────────────────────────────────────────────

function StepTareaFecha({
  onNext,
}: {
  onNext: (tarea: string, fecha: string) => void
}) {
  const [selTarea, setSelTarea] = useState('')
  const [fecha, setFecha] = useState(isoToday())
  const [dateVisible, setDateVisible] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)

  const sections = TAREAS_POR_TEMPORADA.map((t) => ({
    title: t.temporada,
    data: t.tareas as unknown as string[],
  }))

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={0} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>¿Qué tarea?</Text>

        <View style={styles.chipGrid}>
          {TOP_5_TAREAS.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.taskChip, selTarea === t && styles.taskChipSelected]}
              onPress={() => setSelTarea(t)}
              activeOpacity={0.75}
            >
              <Text style={[styles.taskChipText, selTarea === t && styles.taskChipTextSelected]}>{t}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[styles.taskChip, styles.taskChipOtra]}
            onPress={() => setModalVisible(true)}
            activeOpacity={0.75}
          >
            <Text style={[styles.taskChipText, { color: colors.ink60 }]}>Otra</Text>
            <Ionicons name="chevron-down" size={13} color={colors.ink60} style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        </View>

        {selTarea ? (
          <View style={styles.selectedTag}>
            <Ionicons name="checkmark-circle" size={16} color={colors.burdeos[600]} />
            <Text style={styles.selectedTagText}>{selTarea}</Text>
          </View>
        ) : null}

        <Text style={[styles.fieldLabel, { marginTop: 24 }]}>FECHA</Text>
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

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 24 }, !selTarea && { opacity: 0.4 }]}
          onPress={() => {
            if (!selTarea) { Alert.alert('Error', 'Seleccioná una tarea.'); return }
            onNext(selTarea, fecha)
          }}
        >
          <Text style={styles.primaryBtnText}>Continuar</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={{ flex: 1, backgroundColor: colors.hueso }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Todas las tareas</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
              <Ionicons name="close" size={20} color={colors.ink} />
            </TouchableOpacity>
          </View>
          <SectionList
            sections={sections}
            keyExtractor={(item) => item}
            renderSectionHeader={({ section }) => (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>{section.title}</Text>
              </View>
            )}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.listItem}
                onPress={() => { setSelTarea(item); setModalVisible(false) }}
                activeOpacity={0.7}
              >
                <Text style={styles.listItemTitle}>{item}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.niebla} />
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </View>
      </Modal>
    </View>
  )
}

// ─── Step 2: Detalle (ubicación + unidad + precio) ────────────────────────────

function StepDetalle({
  tarea, parcelas, onNext, onBack,
}: {
  tarea: string
  parcelas: Parcela[]
  onNext: (parcela: Parcela | null, unidad: UnidadMedida, precio: number) => void
  onBack: () => void
}) {
  const [search, setSearch] = useState('')
  const [parcela, setParcela] = useState<Parcela | null>(null)
  const [unidad, setUnidad] = useState<UnidadMedida>('dias')
  const [precio, setPrecio] = useState('')

  const filtered = parcelas.filter((p) =>
    p.nombre.toLowerCase().includes(search.toLowerCase())
  )

  function handleNext() {
    if (!precio.trim() || isNaN(Number(precio))) {
      Alert.alert('Error', 'Ingresá un precio válido.')
      return
    }
    onNext(parcela, unidad, Number(precio))
  }

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={1} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Detalle</Text>
        <Text style={styles.stepSubtitle}>{tarea}</Text>

        <Text style={styles.fieldLabel}>UBICACIÓN</Text>
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
                {p.variedad && (
                  <Text style={[styles.parcelaItemSub, parcela?.id === p.id && { color: colors.burdeos[200] }]}>
                    {p.variedad.replace('_', ' ')}
                  </Text>
                )}
              </View>
              {parcela?.id === p.id && (
                <Ionicons name="checkmark" size={16} color={colors.blanco} />
              )}
            </TouchableOpacity>
          ))}
          {filtered.length === 0 && (
            <Text style={styles.emptyText}>Sin resultados</Text>
          )}
        </View>
        <TouchableOpacity style={styles.ghostBtn} onPress={() => { setParcela(null); setSearch('') }}>
          <Text style={styles.ghostBtnText}>Sin ubicación específica</Text>
        </TouchableOpacity>

        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>UNIDAD</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 4 }}>
            {UNIDADES.map((u) => (
              <TouchableOpacity
                key={u}
                style={[styles.unidadChip, unidad === u && styles.unidadChipActive]}
                onPress={() => setUnidad(u)}
              >
                <Text style={[styles.unidadChipText, unidad === u && styles.unidadChipTextActive]}>
                  {UNIDAD_LABELS[u]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <Text style={[styles.fieldLabel, { marginTop: 16 }]}>PRECIO POR UNIDAD (ARS)</Text>
        <TextInput
          style={styles.input}
          value={precio}
          onChangeText={setPrecio}
          placeholder="0"
          placeholderTextColor={colors.niebla}
          keyboardType="numeric"
        />

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
            <Text style={styles.secondaryBtnText}>Atrás</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtn, { flex: 2 }]} onPress={handleNext}>
            <Text style={styles.primaryBtnText}>Continuar</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

// ─── Step 3: Trabajadores ─────────────────────────────────────────────────────

type Trabajador = { nombre: string; cantidad: number }

function StepTrabajadores({
  precio, onNext, onBack,
}: {
  precio: number
  onNext: (trabajadores: Trabajador[]) => void
  onBack: () => void
}) {
  const [workers, setWorkers] = useState<Trabajador[]>([{ nombre: '', cantidad: 1 }])

  function setNombre(idx: number, v: string) {
    setWorkers((prev) => prev.map((w, i) => i === idx ? { ...w, nombre: v } : w))
  }
  function setCantidad(idx: number, delta: number) {
    setWorkers((prev) => prev.map((w, i) => i === idx ? { ...w, cantidad: Math.max(1, w.cantidad + delta) } : w))
  }
  function addWorker() {
    setWorkers((prev) => [...prev, { nombre: '', cantidad: 1 }])
  }
  function removeWorker(idx: number) {
    setWorkers((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleNext() {
    const valid = workers.filter((w) => w.nombre.trim())
    if (valid.length === 0) {
      Alert.alert('Error', 'Ingresá al menos un trabajador con nombre.')
      return
    }
    onNext(valid)
  }

  const totalCant = workers.reduce((s, w) => s + w.cantidad, 0)
  const totalMonto = precio * totalCant

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={2} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Trabajadores</Text>

        {workers.map((w, idx) => (
          <View key={idx} style={styles.workerCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>NOMBRE</Text>
              <TextInput
                style={styles.input}
                value={w.nombre}
                onChangeText={(v) => setNombre(idx, v)}
                placeholder="Nombre del trabajador"
                placeholderTextColor={colors.niebla}
                autoCapitalize="words"
              />
              <View style={styles.workerBottomRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>CANTIDAD</Text>
                  <View style={styles.miniStepperRow}>
                    <TouchableOpacity style={styles.miniStepperBtn} onPress={() => setCantidad(idx, -1)}>
                      <Ionicons name="remove" size={16} color={colors.ink} />
                    </TouchableOpacity>
                    <Text style={styles.miniStepperValue}>{w.cantidad}</Text>
                    <TouchableOpacity style={styles.miniStepperBtn} onPress={() => setCantidad(idx, 1)}>
                      <Ionicons name="add" size={16} color={colors.ink} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.workerAmountBox}>
                  <Text style={styles.workerAmountLabel}>MONTO</Text>
                  <Text style={styles.workerAmountValue}>{formatMonto(precio * w.cantidad)}</Text>
                </View>
              </View>
            </View>
            {workers.length > 1 && (
              <TouchableOpacity style={styles.removeWorkerBtn} onPress={() => removeWorker(idx)}>
                <Ionicons name="close-circle" size={20} color={colors.niebla} />
              </TouchableOpacity>
            )}
          </View>
        ))}

        <TouchableOpacity style={styles.addWorkerBtn} onPress={addWorker}>
          <Ionicons name="add-circle-outline" size={18} color={colors.burdeos[600]} />
          <Text style={styles.addWorkerBtnText}>Agregar trabajador</Text>
        </TouchableOpacity>

        {totalCant > 0 && (
          <View style={styles.totalBanner}>
            <View>
              <Text style={styles.totalBannerLabel}>Total</Text>
              <Text style={styles.totalBannerSub}>{totalCant} {totalCant === 1 ? 'unidad' : 'unidades'}</Text>
            </View>
            <Text style={styles.totalBannerValue}>{formatMonto(totalMonto)}</Text>
          </View>
        )}

        <View style={[styles.actionRow, { marginTop: 24 }]}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
            <Text style={styles.secondaryBtnText}>Atrás</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtn, { flex: 2 }]} onPress={handleNext}>
            <Text style={styles.primaryBtnText}>Continuar</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

// ─── Step 4: Confirmar ────────────────────────────────────────────────────────

function StepConfirmar({
  tarea, fecha, parcela, unidad, precio, trabajadores,
  onSuccess, onBack,
}: {
  tarea: string
  fecha: string
  parcela: Parcela | null
  unidad: UnidadMedida
  precio: number
  trabajadores: Trabajador[]
  onSuccess: () => void
  onBack: () => void
}) {
  const [loading, setLoading] = useState(false)
  const totalCant = trabajadores.reduce((s, w) => s + w.cantidad, 0)
  const total = precio * totalCant

  async function handleSubmit() {
    const payload = {
      fecha,
      parcela_id: parcela?.id ?? null,
      tarea,
      unidad_medida: unidad,
      precio_unitario: precio,
      trabajadores: trabajadores.map((w) => ({ trabajador_nombre: w.nombre, cantidad: w.cantidad })),
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
      <StepIndicator current={3} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Confirmar</Text>

        <View style={styles.summaryCard}>
          {[
            { label: 'Tarea',     value: tarea },
            { label: 'Fecha',     value: formatDateDisplay(fecha) },
            { label: 'Ubicación', value: parcela?.nombre ?? 'Sin ubicación' },
            { label: 'Unidad',    value: UNIDAD_LABELS[unidad] },
            { label: 'Precio',    value: formatMonto(precio) },
          ].map(({ label, value }, idx, arr) => (
            <View
              key={label}
              style={[styles.summaryRow, idx < arr.length - 1 && styles.summaryRowBorder]}
            >
              <Text style={styles.summaryLabel}>{label}</Text>
              <Text style={styles.summaryValue}>{value}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { marginTop: 16 }]}>TRABAJADORES</Text>
        {trabajadores.map((w, idx) => (
          <View key={idx} style={styles.workerSummaryRow}>
            <Text style={styles.workerSummaryName}>{w.nombre}</Text>
            <Text style={styles.workerSummaryDetail}>
              {w.cantidad} × {formatMonto(precio)} = {formatMonto(precio * w.cantidad)}
            </Text>
          </View>
        ))}

        <View style={[styles.summaryCard, { marginTop: 12 }]}>
          <View style={[styles.summaryRow, styles.summaryRowHighlight]}>
            <Text style={[styles.summaryLabel, { color: colors.burdeos[600] }]}>Total</Text>
            <Text style={[styles.summaryValue, { color: colors.burdeos[600], fontSize: 18 }]}>
              {formatMonto(total)}
            </Text>
          </View>
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

// ─── Recent registros ─────────────────────────────────────────────────────────

function RecentList({ registros, onRefresh }: { registros: RegistroTrabajo[]; onRefresh: () => void }) {
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
        <Ionicons name="clipboard-outline" size={36} color={colors.hueso} />
        <Text style={styles.emptyStateTitle}>Sin registros recientes</Text>
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

type Step = 'list' | 'tarea_fecha' | 'detalle' | 'trabajadores' | 'confirmar' | 'success'

export default function TareasScreen() {
  const [step, setStep] = useState<Step>('list')
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [loadingParcelas, setLoadingParcelas] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [selTarea, setSelTarea] = useState('')
  const [selFecha, setSelFecha] = useState(isoToday())
  const [selParcela, setSelParcela] = useState<Parcela | null>(null)
  const [selUnidad, setSelUnidad] = useState<UnidadMedida>('dias')
  const [selPrecio, setSelPrecio] = useState(0)
  const [selTrabajadores, setSelTrabajadores] = useState<Trabajador[]>([])

  const loadParcelas = useCallback(async () => {
    const cached = await getCache<Parcela[]>('parcelas', CACHE_TTL.parcelas)
    if (cached) { setParcelas(cached); setLoadingParcelas(false) }
    try {
      const { data } = await api.get<Parcela[]>('/parcelas/mapa')
      const active = data.filter((p) => p.is_active)
      setParcelas(active)
      await setCache('parcelas', active)
    } catch { /* offline */ }
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

  function resetWizard() {
    setSelTarea(''); setSelFecha(isoToday()); setSelParcela(null)
    setSelUnidad('dias'); setSelPrecio(0); setSelTrabajadores([])
    setStep('list')
  }

  if (step === 'tarea_fecha') {
    return (
      <StepTareaFecha
        onNext={(t, f) => { setSelTarea(t); setSelFecha(f); setStep('detalle') }}
      />
    )
  }

  if (step === 'detalle') {
    return (
      <StepDetalle
        tarea={selTarea}
        parcelas={parcelas}
        onNext={(p, u, pr) => { setSelParcela(p); setSelUnidad(u); setSelPrecio(pr); setStep('trabajadores') }}
        onBack={() => setStep('tarea_fecha')}
      />
    )
  }

  if (step === 'trabajadores') {
    return (
      <StepTrabajadores
        precio={selPrecio}
        onNext={(t) => { setSelTrabajadores(t); setStep('confirmar') }}
        onBack={() => setStep('detalle')}
      />
    )
  }

  if (step === 'confirmar') {
    return (
      <StepConfirmar
        tarea={selTarea}
        fecha={selFecha}
        parcela={selParcela}
        unidad={selUnidad}
        precio={selPrecio}
        trabajadores={selTrabajadores}
        onSuccess={() => { setStep('success'); loadRegistros() }}
        onBack={() => setStep('trabajadores')}
      />
    )
  }

  if (step === 'success') {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark" size={40} color={colors.blanco} />
        </View>
        <Text style={[styles.successTitle, { fontFamily: fonts.display }]}>Guardado</Text>
        <Text style={styles.successSub}>Los registros se cargaron al sistema</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={resetWizard}>
          <Text style={styles.primaryBtnText}>Nueva carga</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.burdeos[600]} />
      }
    >
      <TouchableOpacity style={styles.newBtn} onPress={() => setStep('tarea_fecha')} activeOpacity={0.85}>
        <Ionicons name="add-circle-outline" size={20} color={colors.blanco} />
        <Text style={styles.newBtnText}>Nueva carga de tareas</Text>
      </TouchableOpacity>

      {loadingParcelas ? (
        <ActivityIndicator color={colors.burdeos[600]} style={{ marginTop: 24 }} />
      ) : (
        <RecentList registros={registros} onRefresh={onRefresh} />
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  stepContainer: { flex: 1, backgroundColor: colors.hueso },
  stepTitle: { fontSize: 20, fontWeight: '800', color: colors.ink, marginBottom: 4 },
  stepSubtitle: { fontSize: 14, fontWeight: '600', color: colors.burdeos[600], marginBottom: 20 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },

  // chip grid
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  taskChip: {
    paddingHorizontal: 18, paddingVertical: 14, borderRadius: 12,
    backgroundColor: colors.hueso, minWidth: '45%', flexGrow: 1,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.hueso,
  },
  taskChipSelected: {
    backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600],
  },
  taskChipOtra: {
    backgroundColor: colors.blanco, borderWidth: 1.5, borderColor: colors.hueso,
    flexDirection: 'row',
  },
  taskChipText: { fontSize: 14, fontWeight: '700', color: colors.ink },
  taskChipTextSelected: { color: colors.blanco },

  // selected tag
  selectedTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: colors.crema, borderRadius: 10,
    borderWidth: 1, borderColor: colors.burdeos[200],
    alignSelf: 'flex-start',
  },
  selectedTagText: { fontSize: 14, fontWeight: '700', color: colors.burdeos[600] },

  // unidad chips
  unidadChip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.hueso, backgroundColor: colors.blanco,
  },
  unidadChipActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  unidadChipText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  unidadChipTextActive: { color: colors.blanco },

  // parcela list
  searchInput: {
    height: 46, backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.hueso,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 8,
  },
  parcelaList: {
    backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.hueso, overflow: 'hidden',
  },
  parcelaItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  parcelaItemActive: { backgroundColor: colors.burdeos[600] },
  parcelaItemText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  parcelaItemSub: { fontSize: 12, color: colors.ink60, marginTop: 1, textTransform: 'capitalize' },
  ghostBtn: {
    marginTop: 8, paddingVertical: 12, alignItems: 'center',
    borderRadius: 10, borderWidth: 1, borderColor: colors.hueso, backgroundColor: colors.blanco,
  },
  ghostBtnText: { color: colors.ink60, fontSize: 13, fontWeight: '500' },

  // worker card
  workerCard: {
    flexDirection: 'row', backgroundColor: colors.blanco,
    borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: colors.hueso,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  workerBottomRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  miniStepperRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  miniStepperBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.hueso, justifyContent: 'center', alignItems: 'center',
  },
  miniStepperValue: { fontSize: 22, fontWeight: '800', color: colors.ink, minWidth: 32, textAlign: 'center' },
  workerAmountBox: { flex: 1, alignItems: 'flex-end' },
  workerAmountLabel: { fontSize: 9, fontWeight: '700', color: colors.niebla, letterSpacing: 0.5, textTransform: 'uppercase' },
  workerAmountValue: { fontSize: 16, fontWeight: '800', color: colors.burdeos[600] },
  removeWorkerBtn: { padding: 4, marginLeft: 8, alignSelf: 'flex-start' },

  addWorkerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1.5, borderColor: colors.burdeos[600],
    borderStyle: 'dashed', justifyContent: 'center', marginBottom: 16,
  },
  addWorkerBtnText: { color: colors.burdeos[600], fontSize: 14, fontWeight: '700' },

  totalBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.crema, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: colors.burdeos[200],
  },
  totalBannerLabel: { fontSize: 13, fontWeight: '700', color: colors.ink },
  totalBannerSub: { fontSize: 11, color: colors.ink60, marginTop: 1 },
  totalBannerValue: { fontSize: 22, fontWeight: '800', color: colors.burdeos[600] },

  // worker summary
  workerSummaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, paddingHorizontal: 14,
    backgroundColor: colors.blanco, borderRadius: 10, marginBottom: 4,
    borderWidth: 1, borderColor: colors.hueso,
  },
  workerSummaryName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  workerSummaryDetail: { fontSize: 12, color: colors.ink60 },

  // date btn
  dateBtn: {
    height: 48, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.hueso, paddingHorizontal: 14, marginBottom: 14,
  },
  dateBtnText: { flex: 1, fontSize: 15, color: colors.ink, fontWeight: '500' },
  input: {
    height: 48, backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.hueso,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 14,
  },

  // summary card
  summaryCard: {
    backgroundColor: colors.blanco, borderRadius: 16,
    borderWidth: 1, borderColor: colors.hueso, overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
  },
  summaryRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hueso },
  summaryRowHighlight: { backgroundColor: colors.crema },
  summaryLabel: { fontSize: 13, color: colors.ink60, fontWeight: '600' },
  summaryValue: { fontSize: 14, color: colors.ink, fontWeight: '700' },

  // actions
  actionRow: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    height: 52, backgroundColor: colors.burdeos[600], borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', flexDirection: 'row',
  },
  primaryBtnText: { color: colors.blanco, fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    flex: 1, height: 52, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.hueso,
    backgroundColor: colors.blanco, justifyContent: 'center', alignItems: 'center',
  },
  secondaryBtnText: { color: colors.ink, fontSize: 15, fontWeight: '600' },

  // new btn
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.burdeos[600], borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 20,
    marginBottom: 22, justifyContent: 'center',
    shadowColor: colors.burdeos[600],
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  newBtnText: { color: colors.blanco, fontSize: 16, fontWeight: '700' },

  // recent
  registroCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.blanco, borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  registroNombre: { fontSize: 15, fontWeight: '700', color: colors.ink },
  registroSub: { fontSize: 12, color: colors.ink60, marginTop: 2 },
  registroMonto: { fontSize: 14, fontWeight: '700', color: colors.burdeos[600], marginTop: 5 },
  deleteBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyStateTitle: { fontSize: 15, fontWeight: '600', color: colors.ink60, marginTop: 12 },
  emptyText: { color: colors.niebla, textAlign: 'center', paddingVertical: 24 },

  // success
  successContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.hueso, padding: 32,
  },
  successIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.burdeos[600],
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
    shadowColor: colors.burdeos[600],
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
  listItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16, backgroundColor: colors.blanco,
  },
  listItemTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  separator: { height: 1, backgroundColor: colors.hueso },
  sectionHeader: { backgroundColor: colors.hueso, paddingVertical: 8, paddingHorizontal: 16 },
  sectionHeaderText: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
})
