import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  Modal,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import api, { getRiegosEnCurso, iniciarRiego, terminarRiego } from '../../lib/api'
import { getCache, setCache, CACHE_TTL } from '../../lib/cache'
import { useAuthStore } from '../../store/authStore'
import { colors, fonts } from '../../lib/theme'
import type { Parcela, RegistroRiego, RiegoEnCurso } from '../../lib/types'
import { CABEZAL_VALVULAS, getValvulasForParcela, calcRiegoTotales } from '../../lib/types'

// El backend guarda inicio/fin en UTC (timestamptz). Todo lo que se muestre
// al usuario se ancla explícitamente a America/Argentina/San_Juan: no hay que
// depender del huso del dispositivo (podría estar mal configurado) ni de
// toISOString() (siempre UTC), que hacían que "hoy" o la hora mostrada
// pudieran desfasarse según el momento del día.
const TZ_ARGENTINA = 'America/Argentina/San_Juan'

function isoToday() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ_ARGENTINA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
function nowHHMM() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ_ARGENTINA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date())
}
function formatDateDisplay(iso: string) {
  if (!iso) return '—'
  const [y, mo, d] = iso.split('-')
  return `${d}/${mo}/${y}`
}
function formatDatetime(iso: string) {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      timeZone: TZ_ARGENTINA,
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ['Parral', 'Horario', 'Detalle', 'Confirmar']

function StepIndicator({ current, onCancel }: { current: 0 | 1 | 2 | 3; onCancel: () => void }) {
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
      <TouchableOpacity
        style={si.cancelBtn}
        onPress={onCancel}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={18} color={colors.ink60} />
      </TouchableOpacity>
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
  dotActive: { backgroundColor: colors.cielo },
  dotDone:   { backgroundColor: colors.cielo },
  dotText:   { fontSize: 10, fontWeight: '700', color: colors.niebla },
  label:     { fontSize: 9, color: colors.niebla, marginLeft: 4, fontWeight: '500', flex: 1 },
  labelActive: { color: colors.ink, fontWeight: '700' },
  labelDone:   { color: colors.cielo, fontWeight: '600' },
  line:     { flex: 1, height: 1, backgroundColor: colors.hueso, marginHorizontal: 3 },
  lineDone: { backgroundColor: colors.cielo },
  cancelBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.hueso,
    justifyContent: 'center', alignItems: 'center', marginLeft: 8, flexShrink: 0,
  },
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
  const [selDate, setSelDate] = useState(value || todayISO)
  const [calYear, setCalYear] = useState(() => parseInt((value || todayISO).split('-')[0]))
  const [calMonth, setCalMonth] = useState(() => parseInt((value || todayISO).split('-')[1]) - 1)

  useEffect(() => {
    if (visible) {
      const v = value || todayISO
      setSelDate(v)
      setCalYear(parseInt(v.split('-')[0]))
      setCalMonth(parseInt(v.split('-')[1]) - 1)
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
  cellSel: { backgroundColor: colors.cielo, borderRadius: 8 },
  cellToday: { backgroundColor: colors.crema, borderRadius: 8 },
  cellText: { fontSize: 15, fontWeight: '500', color: colors.ink },
  cellTextSel: { color: colors.blanco, fontWeight: '700' },
  cellTextToday: { color: colors.cielo, fontWeight: '700' },
})

// ─── TimePickerModal ──────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']

function TimePickerModal({
  visible, value, onConfirm, onClose,
}: {
  visible: boolean; value: string
  onConfirm: (t: string) => void; onClose: () => void
}) {
  const [h, setH] = useState('00')
  const [m, setM] = useState('00')

  useEffect(() => {
    if (visible) {
      const [vh, vm] = (value || nowHHMM()).split(':')
      setH(vh ?? '00')
      // Redondea al múltiplo de 5 más cercano hacia abajo
      const mm = Math.floor(parseInt(vm ?? '0', 10) / 5) * 5
      setM(String(mm).padStart(2, '0'))
    }
  }, [visible, value])

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.hueso }}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Seleccionar hora</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={20} color={colors.ink} />
          </TouchableOpacity>
        </View>
        <View style={{ padding: 16 }}>
          <Text style={tp.bigTime}>{h}:{m}</Text>

          <Text style={tp.sectionLabel}>HORA</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tp.chipRow}>
            {HOURS.map((hh) => (
              <TouchableOpacity
                key={hh}
                style={[tp.chip, h === hh && tp.chipActive]}
                onPress={() => setH(hh)}
              >
                <Text style={[tp.chipText, h === hh && tp.chipTextActive]}>{hh}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={tp.sectionLabel}>MINUTOS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tp.chipRow}>
            {MINUTES.map((mm) => (
              <TouchableOpacity
                key={mm}
                style={[tp.chip, m === mm && tp.chipActive]}
                onPress={() => setM(mm)}
              >
                <Text style={[tp.chipText, m === mm && tp.chipTextActive]}>{mm}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity
            style={tp.nowBtn}
            onPress={() => {
              const now = nowHHMM().split(':')
              setH(now[0])
              setM(String(Math.floor(parseInt(now[1], 10) / 5) * 5).padStart(2, '0'))
            }}
          >
            <Ionicons name="time-outline" size={14} color={colors.ink60} />
            <Text style={tp.nowBtnText}>Ahora</Text>
          </TouchableOpacity>
        </View>
        <View style={{ padding: 16 }}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => { onConfirm(`${h}:${m}`); onClose() }}
          >
            <Text style={styles.primaryBtnText}>Confirmar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const tp = StyleSheet.create({
  bigTime: {
    fontSize: 40, fontWeight: '800', color: colors.ink, textAlign: 'center',
    marginBottom: 20, fontFamily: fonts.mono,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8, marginTop: 12,
  },
  chipRow: { gap: 8, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.hueso, backgroundColor: colors.blanco,
  },
  chipActive: { backgroundColor: colors.cielo, borderColor: colors.cielo },
  chipText: { fontSize: 14, color: colors.ink, fontWeight: '600', fontFamily: fonts.mono },
  chipTextActive: { color: colors.blanco },
  nowBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 16, paddingVertical: 10,
  },
  nowBtnText: { fontSize: 13, color: colors.ink60, fontWeight: '600' },
})

// ─── Step 1: cabezal + parral + válvulas ──────────────────────────────────────

const CABEZALES = Object.keys(CABEZAL_VALVULAS).sort()

function StepUbicacion({
  parcelas, initialCabezal, initialParcelaId, initialValvulas, onNext, onCancelar,
}: {
  parcelas: Parcela[]
  initialCabezal: string | null
  initialParcelaId: string | null
  initialValvulas: string[]
  onNext: (cabezal: string, parcela: Parcela, valvulas: string[]) => void
  onCancelar: () => void
}) {
  const [cabezal, setCabezal] = useState<string | null>(initialCabezal)
  const [parcelaId, setParcelaId] = useState<string | null>(initialParcelaId)
  const [valvulas, setValvulas] = useState<Set<string>>(new Set(initialValvulas))

  const parralesDelCabezal = cabezal
    ? parcelas.filter((p) => p.tipo === 'parral' && p.is_active && p.cabezal_riego === cabezal)
    : []

  const parcelaSel = parcelas.find((p) => p.id === parcelaId) ?? null
  const valvulasDisponibles = parcelaSel ? getValvulasForParcela(parcelaSel.nombre) : []

  function selectCabezal(cab: string) {
    setCabezal(cab)
    setParcelaId(null)
    setValvulas(new Set())
  }

  function selectParcela(p: Parcela) {
    setParcelaId(p.id)
    setValvulas(new Set())
  }

  function toggleValvula(v: string) {
    setValvulas((prev) => {
      const next = new Set(prev)
      next.has(v) ? next.delete(v) : next.add(v)
      return next
    })
  }

  function handleContinue() {
    if (!cabezal) { Alert.alert('Falta el cabezal', 'Seleccioná un cabezal de riego.'); return }
    if (!parcelaSel) { Alert.alert('Falta el parral', 'Seleccioná el parral a regar.'); return }
    if (valvulas.size === 0) { Alert.alert('Faltan válvulas', 'Seleccioná al menos una válvula.'); return }
    onNext(cabezal, parcelaSel, Array.from(valvulas).sort((a, b) => Number(a) - Number(b)))
  }

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={0} onCancel={onCancelar} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

        <Text style={styles.fieldLabel}>1. CABEZAL</Text>
        <View style={styles.chipGridWrap}>
          {CABEZALES.map((cab) => (
            <TouchableOpacity
              key={cab}
              style={[styles.cabezalChip, cabezal === cab && styles.cabezalChipActive]}
              onPress={() => selectCabezal(cab)}
              activeOpacity={0.8}
            >
              <Text style={[styles.cabezalChipText, cabezal === cab && styles.cabezalChipTextActive]}>
                Cabezal {cab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {cabezal && (
          <>
            <Text style={[styles.fieldLabel, { marginTop: 22 }]}>2. PARRAL</Text>
            {parralesDelCabezal.length === 0 ? (
              <Text style={styles.emptyText}>Sin parrales activos para este cabezal</Text>
            ) : (
              <View style={styles.chipGridWrap}>
                {parralesDelCabezal.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.parcelaChip, parcelaId === p.id && styles.parcelaChipActive]}
                    onPress={() => selectParcela(p)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.parcelaChipText, parcelaId === p.id && styles.parcelaChipTextActive]}>
                      {p.nombre}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        {parcelaSel && (
          <>
            <Text style={[styles.fieldLabel, { marginTop: 22 }]}>3. VÁLVULAS ABIERTAS</Text>
            <View style={styles.chipGridWrap}>
              {valvulasDisponibles.map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[styles.valvulaChip, valvulas.has(v) && styles.valvulaChipActive]}
                  onPress={() => toggleValvula(v)}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="water"
                    size={14}
                    color={valvulas.has(v) ? colors.blanco : colors.cielo}
                  />
                  <Text style={[styles.valvulaChipText, valvulas.has(v) && styles.valvulaChipTextActive]}>
                    Válvula {v}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {valvulas.size > 0 && (
              <Text style={styles.hintText}>
                {valvulas.size} válvula{valvulas.size > 1 ? 's' : ''} × 1 ha c/u ≈ {valvulas.size} ha regadas
              </Text>
            )}
          </>
        )}

        <TouchableOpacity style={[styles.primaryBtn, { marginTop: 28 }]} onPress={handleContinue}>
          <Text style={styles.primaryBtnText}>Continuar</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}

// ─── Bifurcación: cargar ya hecho vs. iniciar ahora ───────────────────────────

function StepModo({
  onElegirRetroactivo, onElegirIniciar, onCancelar,
}: {
  onElegirRetroactivo: () => void
  onElegirIniciar: () => void
  onCancelar: () => void
}) {
  return (
    <View style={styles.stepContainer}>
      <View style={si.row}>
        <Text style={[styles.stepTitle, { flex: 1, marginBottom: 0 }]}>¿Qué querés hacer?</Text>
        <TouchableOpacity
          style={si.cancelBtn}
          onPress={onCancelar}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={18} color={colors.ink60} />
        </TouchableOpacity>
      </View>
      <View style={{ padding: 16, gap: 12 }}>
        <TouchableOpacity style={styles.modoCard} onPress={onElegirRetroactivo} activeOpacity={0.8}>
          <Ionicons name="calendar-outline" size={26} color={colors.cielo} />
          <View style={{ flex: 1 }}>
            <Text style={styles.modoCardTitle}>Ya se hizo</Text>
            <Text style={styles.modoCardSub}>Cargar un riego que ya terminó, con inicio y fin conocidos.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.niebla} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.modoCard} onPress={onElegirIniciar} activeOpacity={0.8}>
          <Ionicons name="play-circle-outline" size={26} color={colors.cielo} />
          <View style={{ flex: 1 }}>
            <Text style={styles.modoCardTitle}>Iniciar ahora</Text>
            <Text style={styles.modoCardSub}>Arranca el riego ya mismo, sin hora de fin — lo cerrás después.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.niebla} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ─── Step 2: horario ──────────────────────────────────────────────────────────

function StepHorario({
  initialFechaInicio, initialHoraInicio, initialFechaFin, initialHoraFin, onNext, onBack, onCancelar,
}: {
  initialFechaInicio: string
  initialHoraInicio: string
  initialFechaFin: string
  initialHoraFin: string
  onNext: (fechaInicio: string, horaInicio: string, fechaFin: string, horaFin: string) => void
  onBack: () => void
  onCancelar: () => void
}) {
  const [fechaInicio, setFechaInicio] = useState(initialFechaInicio || isoToday())
  const [horaInicio, setHoraInicio] = useState(initialHoraInicio)
  const [fechaFin, setFechaFin] = useState(initialFechaFin || isoToday())
  const [horaFin, setHoraFin] = useState(initialHoraFin)

  const [dateModal, setDateModal] = useState<'inicio' | 'fin' | null>(null)
  const [timeModal, setTimeModal] = useState<'inicio' | 'fin' | null>(null)

  const preview = (horaInicio && horaFin)
    ? calcRiegoTotales(`${fechaInicio}T${horaInicio}:00`, `${fechaFin}T${horaFin}:00`, 1)
    : null

  function handleContinue() {
    if (!horaInicio) { Alert.alert('Falta la hora de inicio', ''); return }
    if (!horaFin) { Alert.alert('Falta la hora de fin', ''); return }
    if (!preview) { Alert.alert('Horario inválido', 'El fin debe ser posterior al inicio.'); return }
    onNext(fechaInicio, horaInicio, fechaFin, horaFin)
  }

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={1} onCancel={onCancelar} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>¿Cuándo se regó?</Text>

        <Text style={styles.fieldLabel}>INICIO</Text>
        <View style={styles.dateTimeRow}>
          <DatePickerModal
            visible={dateModal === 'inicio'} value={fechaInicio}
            onConfirm={setFechaInicio} onClose={() => setDateModal(null)}
          />
          <TimePickerModal
            visible={timeModal === 'inicio'} value={horaInicio}
            onConfirm={setHoraInicio} onClose={() => setTimeModal(null)}
          />
          <TouchableOpacity style={[styles.dateBtn, { flex: 1 }]} onPress={() => setDateModal('inicio')}>
            <Ionicons name="calendar-outline" size={16} color={colors.ink60} />
            <Text style={styles.dateBtnText}>{formatDateDisplay(fechaInicio)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.dateBtn, { flex: 1 }]} onPress={() => setTimeModal('inicio')}>
            <Ionicons name="time-outline" size={16} color={colors.ink60} />
            <Text style={styles.dateBtnText}>{horaInicio || 'Hora'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>FIN</Text>
        <View style={styles.dateTimeRow}>
          <DatePickerModal
            visible={dateModal === 'fin'} value={fechaFin}
            onConfirm={setFechaFin} onClose={() => setDateModal(null)}
          />
          <TimePickerModal
            visible={timeModal === 'fin'} value={horaFin}
            onConfirm={setHoraFin} onClose={() => setTimeModal(null)}
          />
          <TouchableOpacity style={[styles.dateBtn, { flex: 1 }]} onPress={() => setDateModal('fin')}>
            <Ionicons name="calendar-outline" size={16} color={colors.ink60} />
            <Text style={styles.dateBtnText}>{formatDateDisplay(fechaFin)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.dateBtn, { flex: 1 }]} onPress={() => setTimeModal('fin')}>
            <Ionicons name="time-outline" size={16} color={colors.ink60} />
            <Text style={styles.dateBtnText}>{horaFin || 'Hora'}</Text>
          </TouchableOpacity>
        </View>

        {preview ? (
          <View style={styles.previewCard}>
            <Ionicons name="time" size={16} color={colors.cielo} />
            <Text style={styles.previewText}>Duración: {preview.horas} h</Text>
          </View>
        ) : (horaInicio && horaFin) ? (
          <Text style={styles.errorText}>El fin debe ser posterior al inicio.</Text>
        ) : null}

        <View style={[styles.actionRow, { marginTop: 24 }]}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
            <Text style={styles.secondaryBtnText}>Atrás</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtn, { flex: 2 }]} onPress={handleContinue}>
            <Text style={styles.primaryBtnText}>Continuar</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

// ─── Step 3: fertirriego + responsable ────────────────────────────────────────

function StepDetalle({
  initialConFertirriego, initialProducto, initialDosis, initialResponsable, onNext, onBack, onCancelar,
}: {
  initialConFertirriego: boolean
  initialProducto: string
  initialDosis: string
  initialResponsable: string
  onNext: (conFertirriego: boolean, producto: string, dosis: string, responsable: string) => void
  onBack: () => void
  onCancelar: () => void
}) {
  const [conFertirriego, setConFertirriego] = useState(initialConFertirriego)
  const [producto, setProducto] = useState(initialProducto)
  const [dosis, setDosis] = useState(initialDosis)
  const [responsable, setResponsable] = useState(initialResponsable)

  function handleContinue() {
    if (conFertirriego && !producto.trim()) {
      Alert.alert('Falta el producto', 'Indicá el nombre del fertilizante.')
      return
    }
    if (!responsable.trim()) {
      Alert.alert('Falta el responsable', 'Indicá quién realizó el riego.')
      return
    }
    onNext(conFertirriego, producto.trim(), dosis.trim(), responsable.trim())
  }

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={2} onCancel={onCancelar} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Fertiriego y responsable</Text>

        <Text style={styles.fieldLabel}>¿ES CON FERTIRIEGO?</Text>
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleBtn, !conFertirriego && styles.toggleBtnActive]}
            onPress={() => setConFertirriego(false)}
          >
            <Text style={[styles.toggleBtnText, !conFertirriego && styles.toggleBtnTextActive]}>Solo agua</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, conFertirriego && styles.toggleBtnActive]}
            onPress={() => setConFertirriego(true)}
          >
            <Text style={[styles.toggleBtnText, conFertirriego && styles.toggleBtnTextActive]}>Con fertiriego</Text>
          </TouchableOpacity>
        </View>

        {conFertirriego && (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.fieldLabel}>PRODUCTO</Text>
            <TextInput
              style={styles.input}
              value={producto}
              onChangeText={setProducto}
              placeholder="Nombre del fertilizante..."
              placeholderTextColor={colors.niebla}
            />
            <Text style={styles.fieldLabel}>DOSIS (L/HA)</Text>
            <TextInput
              style={styles.input}
              value={dosis}
              onChangeText={setDosis}
              placeholder="0.0"
              placeholderTextColor={colors.niebla}
              keyboardType="decimal-pad"
            />
          </View>
        )}

        <Text style={[styles.fieldLabel, { marginTop: 16 }]}>RESPONSABLE</Text>
        <TextInput
          style={styles.input}
          value={responsable}
          onChangeText={setResponsable}
          placeholder="Nombre del responsable..."
          placeholderTextColor={colors.niebla}
        />

        <View style={[styles.actionRow, { marginTop: 24 }]}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onBack}>
            <Text style={styles.secondaryBtnText}>Atrás</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtn, { flex: 2 }]} onPress={handleContinue}>
            <Text style={styles.primaryBtnText}>Continuar</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

// ─── Step 4: confirmar ────────────────────────────────────────────────────────

interface RiegoDraft {
  cabezal: string
  parcela: Parcela
  valvulas: string[]
  fechaInicio: string
  horaInicio: string
  fechaFin: string
  horaFin: string
  conFertirriego: boolean
  producto: string
  dosis: string
  responsable: string
}

function StepConfirmar({
  draft, onSuccess, onBack, onCancelar,
}: {
  draft: RiegoDraft
  onSuccess: () => void
  onBack: () => void
  onCancelar: () => void
}) {
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)

  const inicioISO = `${draft.fechaInicio}T${draft.horaInicio}:00-03:00`
  const finISO = `${draft.fechaFin}T${draft.horaFin}:00-03:00`
  const totales = calcRiegoTotales(inicioISO, finISO, draft.valvulas.length)

  async function handleSubmit() {
    if (submittingRef.current) return
    if (!totales) { Alert.alert('Error', 'El horario cargado no es válido.'); return }
    submittingRef.current = true
    try {
      setLoading(true)
      await api.post('/produccion/riego/', {
        fecha: draft.fechaInicio,
        parcela_id: draft.parcela.id,
        cabezal: draft.cabezal,
        valvula: draft.valvulas.join(','),
        inicio: inicioISO,
        fin: finISO,
        responsable: draft.responsable,
        fertilizante_nombre: draft.conFertirriego && draft.producto ? draft.producto : undefined,
        fertilizante_dosis_lt_ha: draft.conFertirriego && draft.dosis ? Number(draft.dosis) : undefined,
      })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', typeof detail === 'string' ? detail : 'No se pudo guardar el riego.')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  const rows: { label: string; value: string; highlight?: boolean }[] = [
    { label: 'Cabezal', value: `Cabezal ${draft.cabezal}` },
    { label: 'Parral', value: draft.parcela.nombre },
    { label: 'Válvulas', value: draft.valvulas.map((v) => `V${v}`).join(', ') },
    { label: 'Inicio', value: formatDatetime(inicioISO) },
    { label: 'Fin', value: formatDatetime(finISO) },
    { label: 'Duración', value: totales ? `${totales.horas} h` : '—' },
    { label: 'Litros totales', value: totales ? `${totales.litros.toLocaleString('es-AR')} L` : '—', highlight: true },
    {
      label: 'Fertiriego',
      value: draft.conFertirriego && draft.producto ? `${draft.producto} (${draft.dosis || '0'} L/ha)` : 'Sin fertiriego',
    },
    { label: 'Responsable', value: draft.responsable },
  ]

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={3} onCancel={onCancelar} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Confirmar riego</Text>

        <View style={styles.summaryCard}>
          {rows.map(({ label, value, highlight }, idx, arr) => (
            <View
              key={label}
              style={[
                styles.summaryRow,
                idx < arr.length - 1 && styles.summaryRowBorder,
                highlight && styles.summaryRowHighlight,
              ]}
            >
              <Text style={[styles.summaryLabel, highlight && { color: colors.cielo }]}>{label}</Text>
              <Text
                style={[styles.summaryValue, highlight && { color: colors.cielo }, { flex: 1, textAlign: 'right' }]}
                numberOfLines={2}
              >
                {value}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onBack} disabled={loading}>
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

// ─── Confirmar "iniciar ahora" (sin fin todavía) ──────────────────────────────

interface IniciarDraft {
  cabezal: string
  parcela: Parcela
  valvulas: string[]
  conFertirriego: boolean
  producto: string
  dosis: string
  responsable: string
}

function StepIniciarConfirmar({
  draft, onSuccess, onBack, onCancelar,
}: {
  draft: IniciarDraft
  onSuccess: () => void
  onBack: () => void
  onCancelar: () => void
}) {
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)

  async function handleSubmit() {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      setLoading(true)
      await iniciarRiego({
        parcela_id: draft.parcela.id,
        cabezal: draft.cabezal,
        valvula: draft.valvulas.join(','),
        responsable: draft.responsable,
        fertilizante_nombre: draft.conFertirriego && draft.producto ? draft.producto : undefined,
        fertilizante_dosis_lt_ha: draft.conFertirriego && draft.dosis ? Number(draft.dosis) : undefined,
      })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', typeof detail === 'string' ? detail : 'No se pudo iniciar el riego.')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  const rows: { label: string; value: string }[] = [
    { label: 'Cabezal', value: `Cabezal ${draft.cabezal}` },
    { label: 'Parral', value: draft.parcela.nombre },
    { label: 'Válvulas', value: draft.valvulas.map((v) => `V${v}`).join(', ') },
    {
      label: 'Fertiriego',
      value: draft.conFertirriego && draft.producto ? `${draft.producto} (${draft.dosis || '0'} L/ha)` : 'Sin fertiriego',
    },
    { label: 'Responsable', value: draft.responsable },
  ]

  return (
    <View style={styles.stepContainer}>
      <View style={si.row}>
        <Text style={[styles.stepTitle, { flex: 1, marginBottom: 0 }]}>Iniciar riego</Text>
        <TouchableOpacity
          style={si.cancelBtn}
          onPress={onCancelar}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={18} color={colors.ink60} />
        </TouchableOpacity>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={styles.previewCard}>
          <Ionicons name="play" size={16} color={colors.cielo} />
          <Text style={styles.previewText}>Arranca ahora — se cierra después desde &quot;En curso&quot;</Text>
        </View>

        <View style={[styles.summaryCard, { marginTop: 16 }]}>
          {rows.map(({ label, value }, idx, arr) => (
            <View
              key={label}
              style={[styles.summaryRow, idx < arr.length - 1 && styles.summaryRowBorder]}
            >
              <Text style={styles.summaryLabel}>{label}</Text>
              <Text style={[styles.summaryValue, { flex: 1, textAlign: 'right' }]} numberOfLines={2}>
                {value}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onBack} disabled={loading}>
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
                <Ionicons name="play" size={18} color={colors.blanco} style={{ marginRight: 6 }} />
                <Text style={styles.primaryBtnText}>Iniciar riego</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

// ─── Recent riegos ────────────────────────────────────────────────────────────

function formatTranscurrido(horas: number): string {
  const totalMin = Math.floor(horas * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

function RecentRiegos({
  riegos, parcelas, refreshing, onRefresh, riegosEnCurso, onTerminar, terminandoId,
}: {
  riegos: RegistroRiego[]
  parcelas: Parcela[]
  refreshing: boolean
  onRefresh: () => void
  riegosEnCurso: RiegoEnCurso[]
  onTerminar: (r: RiegoEnCurso, horas: number, litros: number) => void
  terminandoId: string | null
}) {
  function parcelaNombre(id: string) {
    return parcelas.find((p) => p.id === id)?.nombre ?? '—'
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.cielo} />
      }
    >
      {riegosEnCurso.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>RIEGOS EN CURSO</Text>
          {riegosEnCurso.map((r) => {
            const totales = calcRiegoTotales(r.inicio, new Date().toISOString(), r.n_valvulas) ?? { horas: 0, litros: 0 }
            return (
              <View key={r.id} style={styles.enCursoCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.riegoNombre}>
                    {parcelaNombre(r.parcela_id)} · Cab. {r.cabezal} · V{r.valvula.split(',').join('+')}
                  </Text>
                  <Text style={styles.enCursoStats}>
                    {formatTranscurrido(totales.horas)} · {totales.litros.toLocaleString('es-AR')} L
                  </Text>
                  <Text style={styles.riegoResp}>{r.responsable}</Text>
                </View>
                <TouchableOpacity
                  style={styles.terminarBtn}
                  onPress={() => onTerminar(r, totales.horas, totales.litros)}
                  disabled={terminandoId === r.id}
                >
                  <Text style={styles.terminarBtnText}>Terminar</Text>
                </TouchableOpacity>
              </View>
            )
          })}
        </>
      )}

      {riegos.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="water-outline" size={36} color={colors.hueso} />
          <Text style={styles.emptyStateTitle}>Sin riegos recientes</Text>
        </View>
      ) : (
        <>
          <Text style={styles.sectionLabel}>RIEGOS RECIENTES</Text>
          {riegos.map((r) => (
            <View key={r.id} style={styles.riegoCard}>
              <View style={styles.riegoCardHeader}>
                <Text style={styles.riegoNombre}>{parcelaNombre(r.parcela_id)}</Text>
                <Text style={styles.riegoDate}>{r.fecha}</Text>
              </View>
              <View style={styles.riegoBadges}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Cab. {r.cabezal} · V{r.valvula.split(',').join('+')}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: '#e0f2fe' }]}>
                  <Text style={[styles.badgeText, { color: colors.cielo }]}>
                    {r.duracion_horas.toFixed(1)} h
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: '#e0f2fe' }]}>
                  <Text style={[styles.badgeText, { color: colors.cielo }]}>
                    {r.litros_aplicados.toLocaleString('es-AR')} L
                  </Text>
                </View>
                {r.fertilizante_nombre && (
                  <View style={[styles.badge, { backgroundColor: '#fef3c7' }]}>
                    <Text style={[styles.badgeText, { color: '#92400e' }]}>Fertiriego</Text>
                  </View>
                )}
              </View>
              <Text style={styles.riegoResp}>{r.responsable}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

type Step = 'list' | 'ubicacion' | 'modo' | 'horario' | 'detalle' | 'confirmar' | 'iniciar_confirmar'
type Modo = 'retroactivo' | 'iniciar'

const emptyDraft: RiegoDraft = {
  cabezal: '', parcela: null as unknown as Parcela, valvulas: [],
  fechaInicio: isoToday(), horaInicio: '', fechaFin: isoToday(), horaFin: '',
  conFertirriego: false, producto: '', dosis: '', responsable: '',
}

export default function RiegoScreen() {
  const user = useAuthStore((s) => s.user)
  const [step, setStep] = useState<Step>('list')
  const [modo, setModo] = useState<Modo>('retroactivo')
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [riegos, setRiegos] = useState<RegistroRiego[]>([])
  const [riegosEnCurso, setRiegosEnCurso] = useState<RiegoEnCurso[]>([])
  const [terminandoId, setTerminandoId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [draft, setDraft] = useState<RiegoDraft>(emptyDraft)
  const [toast, setToast] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const [cachedParcelas, cachedRiegos] = await Promise.all([
      getCache<Parcela[]>('parcelas', CACHE_TTL.parcelas),
      getCache<RegistroRiego[]>('riegos', CACHE_TTL.riegos),
    ])
    if (cachedParcelas) setParcelas(cachedParcelas)
    if (cachedRiegos) setRiegos(cachedRiegos)

    try {
      const [parcelasRes, riegosRes] = await Promise.all([
        api.get<Parcela[]>('/parcelas/mapa'),
        api.get<RegistroRiego[]>('/produccion/riego/?limit=10'),
      ])
      const active = parcelasRes.data.filter((p) => p.is_active)
      setParcelas(active)
      setRiegos(riegosRes.data)
      await Promise.all([
        setCache('parcelas', active),
        setCache('riegos', riegosRes.data),
      ])
    } catch { /* offline */ }
    finally { setRefreshing(false) }
  }, [])

  const loadRiegosEnCurso = useCallback(async () => {
    try {
      setRiegosEnCurso(await getRiegosEnCurso())
    } catch { /* offline */ }
  }, [])

  useEffect(() => { loadData(); loadRiegosEnCurso() }, [loadData, loadRiegosEnCurso])

  // Refetch cada 30s para detectar riegos iniciados/cerrados por otros
  // usuarios/dispositivos — el cronómetro que se ve en cada card se calcula
  // localmente (calcRiegoTotales contra "ahora"), no hace falta pegarle al
  // servidor cada segundo para eso.
  useEffect(() => {
    const t = setInterval(loadRiegosEnCurso, 30_000)
    return () => clearInterval(t)
  }, [loadRiegosEnCurso])

  // Tick de 1s puramente para forzar el re-render del cronómetro en pantalla
  // mientras haya al menos un riego en curso.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (riegosEnCurso.length === 0) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [riegosEnCurso.length])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  function onRefresh() { setRefreshing(true); loadData(); loadRiegosEnCurso() }

  async function handleTerminar(r: RiegoEnCurso, horas: number, litros: number) {
    Alert.alert(
      'Terminar riego',
      `Se va a registrar ${formatTranscurrido(horas)} y ${litros.toLocaleString('es-AR')} L aplicados. ¿Confirmás?`,
      [
        { text: 'Seguir regando', style: 'cancel' },
        {
          text: 'Terminar', style: 'default',
          onPress: async () => {
            if (terminandoId) return
            setTerminandoId(r.id)
            try {
              await terminarRiego(r.id)
              await Promise.all([loadRiegosEnCurso(), loadData()])
              setToast('Riego terminado ✓')
            } catch (e: unknown) {
              const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
              Alert.alert('Error', typeof detail === 'string' ? detail : 'No se pudo terminar el riego.')
            } finally {
              setTerminandoId(null)
            }
          },
        },
      ],
    )
  }

  function startWizard() {
    setDraft({ ...emptyDraft, responsable: user?.full_name ?? '' })
    setModo('retroactivo')
    setStep('ubicacion')
  }

  function resetWizard() {
    setDraft(emptyDraft)
    setStep('list')
  }

  function handleCancelar() {
    Alert.alert(
      'Cancelar carga',
      'Se van a perder los datos ingresados. ¿Querés salir?',
      [
        { text: 'Seguir cargando', style: 'cancel' },
        { text: 'Salir', style: 'destructive', onPress: resetWizard },
      ],
    )
  }

  if (step === 'ubicacion') {
    return (
      <StepUbicacion
        parcelas={parcelas}
        initialCabezal={draft.cabezal || null}
        initialParcelaId={draft.parcela?.id ?? null}
        initialValvulas={draft.valvulas}
        onNext={(cabezal, parcela, valvulas) => {
          setDraft((d) => ({ ...d, cabezal, parcela, valvulas }))
          setStep('modo')
        }}
        onCancelar={handleCancelar}
      />
    )
  }

  if (step === 'modo') {
    return (
      <StepModo
        onElegirRetroactivo={() => { setModo('retroactivo'); setStep('horario') }}
        onElegirIniciar={() => { setModo('iniciar'); setStep('detalle') }}
        onCancelar={handleCancelar}
      />
    )
  }

  if (step === 'horario') {
    return (
      <StepHorario
        initialFechaInicio={draft.fechaInicio}
        initialHoraInicio={draft.horaInicio}
        initialFechaFin={draft.fechaFin}
        initialHoraFin={draft.horaFin}
        onNext={(fechaInicio, horaInicio, fechaFin, horaFin) => {
          setDraft((d) => ({ ...d, fechaInicio, horaInicio, fechaFin, horaFin }))
          setStep('detalle')
        }}
        onBack={() => setStep('ubicacion')}
        onCancelar={handleCancelar}
      />
    )
  }

  if (step === 'detalle') {
    return (
      <StepDetalle
        initialConFertirriego={draft.conFertirriego}
        initialProducto={draft.producto}
        initialDosis={draft.dosis}
        initialResponsable={draft.responsable}
        onNext={(conFertirriego, producto, dosis, responsable) => {
          setDraft((d) => ({ ...d, conFertirriego, producto, dosis, responsable }))
          setStep(modo === 'iniciar' ? 'iniciar_confirmar' : 'confirmar')
        }}
        onBack={() => setStep(modo === 'iniciar' ? 'modo' : 'horario')}
        onCancelar={handleCancelar}
      />
    )
  }

  if (step === 'confirmar') {
    return (
      <StepConfirmar
        draft={draft}
        onSuccess={() => { resetWizard(); loadData(); setToast('Riego cargado ✓') }}
        onBack={() => setStep('detalle')}
        onCancelar={handleCancelar}
      />
    )
  }

  if (step === 'iniciar_confirmar' && draft.parcela) {
    return (
      <StepIniciarConfirmar
        draft={draft}
        onSuccess={() => { resetWizard(); loadRiegosEnCurso(); setToast('Riego iniciado ✓') }}
        onBack={() => setStep('detalle')}
        onCancelar={handleCancelar}
      />
    )
  }

  return (
    <View style={{ flex: 1 }}>
      {toast && (
        <View style={styles.toast} pointerEvents="none">
          <Ionicons name="checkmark-circle" size={18} color={colors.blanco} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
      <TouchableOpacity
        style={styles.newBtn}
        onPress={startWizard}
        activeOpacity={0.85}
      >
        <Ionicons name="add-circle-outline" size={20} color={colors.blanco} />
        <Text style={styles.newBtnText}>Registrar riego</Text>
      </TouchableOpacity>
      <RecentRiegos
        riegos={riegos}
        parcelas={parcelas}
        refreshing={refreshing}
        onRefresh={onRefresh}
        riegosEnCurso={riegosEnCurso}
        onTerminar={handleTerminar}
        terminandoId={terminandoId}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  stepContainer: { flex: 1, backgroundColor: colors.hueso },
  stepTitle: { fontSize: 20, fontWeight: '800', color: colors.ink, marginBottom: 20 },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  hintText: { fontSize: 12, color: colors.ink60, marginTop: 8, fontStyle: 'italic' },
  errorText: { fontSize: 12, color: colors.sangre, marginTop: 8 },

  // chip grids (cabezal / parral / valvula)
  chipGridWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cabezalChip: {
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.hueso, backgroundColor: colors.blanco,
  },
  cabezalChipActive: { backgroundColor: colors.cielo, borderColor: colors.cielo },
  cabezalChipText: { fontSize: 14, color: colors.ink, fontWeight: '700' },
  cabezalChipTextActive: { color: colors.blanco },

  parcelaChip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.hueso, backgroundColor: colors.blanco,
  },
  parcelaChipActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  parcelaChipText: { fontSize: 13, color: colors.ink, fontWeight: '600' },
  parcelaChipTextActive: { color: colors.blanco },

  valvulaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.cielo, backgroundColor: colors.blanco,
  },
  valvulaChipActive: { backgroundColor: colors.cielo },
  valvulaChipText: { fontSize: 13, color: colors.cielo, fontWeight: '700' },
  valvulaChipTextActive: { color: colors.blanco },

  emptyText: { fontSize: 13, color: colors.niebla, fontStyle: 'italic', paddingVertical: 8 },

  // date/time
  dateTimeRow: { flexDirection: 'row', gap: 8 },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, borderColor: colors.hueso,
    backgroundColor: colors.blanco, paddingVertical: 14, paddingHorizontal: 14,
  },
  dateBtnText: { fontSize: 14, color: colors.ink, fontWeight: '600' },

  previewCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#e0f2fe', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14,
    marginTop: 16,
  },
  previewText: { fontSize: 14, color: colors.cielo, fontWeight: '700' },

  // toggle (fertirriego)
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggleBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.hueso, backgroundColor: colors.blanco,
  },
  toggleBtnActive: { backgroundColor: colors.cielo, borderColor: colors.cielo },
  toggleBtnText: { fontSize: 14, color: colors.ink, fontWeight: '600' },
  toggleBtnTextActive: { color: colors.blanco },

  input: {
    backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.hueso,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 14, height: 48,
  },

  // summary
  summaryCard: {
    backgroundColor: colors.blanco, borderRadius: 16,
    borderWidth: 1, borderColor: colors.hueso, overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
  },
  summaryRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hueso },
  summaryRowHighlight: { backgroundColor: '#e0f2fe' },
  summaryLabel: { fontSize: 13, color: colors.ink60, fontWeight: '600' },
  summaryValue: { fontSize: 14, color: colors.ink, fontWeight: '700' },

  actionRow: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    height: 52, backgroundColor: colors.cielo, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', flexDirection: 'row',
  },
  primaryBtnText: { color: colors.blanco, fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    flex: 1, height: 52, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.hueso,
    backgroundColor: colors.blanco, justifyContent: 'center', alignItems: 'center',
  },
  secondaryBtnText: { color: colors.ink, fontSize: 15, fontWeight: '600' },

  // modal header (shared by DatePickerModal / TimePickerModal)
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  closeBtn: { padding: 4 },

  // new btn
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.cielo, borderRadius: 14,
    margin: 16, paddingVertical: 16, paddingHorizontal: 20,
    justifyContent: 'center',
    shadowColor: colors.cielo,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  newBtnText: { color: colors.blanco, fontSize: 16, fontWeight: '700' },

  // recent
  riegoCard: {
    backgroundColor: colors.blanco, borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  riegoCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
  },
  riegoNombre: { fontSize: 15, fontWeight: '700', color: colors.ink },
  riegoDate: { fontSize: 12, color: colors.niebla },
  riegoBadges: { flexDirection: 'row', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  badge: {
    backgroundColor: colors.crema, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.burdeos[600] },
  riegoResp: { fontSize: 12, color: colors.cielo, fontWeight: '600' },

  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyStateTitle: { fontSize: 14, color: colors.niebla, marginTop: 10 },

  // modo (bifurcación cargar ya hecho vs iniciar ahora)
  modoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.blanco, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: colors.hueso,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  modoCardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  modoCardSub: { fontSize: 12, color: colors.ink60, marginTop: 2 },

  // riegos en curso
  enCursoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.crema, borderRadius: 14, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: colors.hueso,
  },
  enCursoStats: { fontSize: 13, color: colors.cielo, fontWeight: '700', fontFamily: fonts.mono, marginTop: 2 },
  terminarBtn: {
    backgroundColor: colors.cielo, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14, flexShrink: 0,
  },
  terminarBtnText: { color: colors.blanco, fontSize: 13, fontWeight: '700' },

  // toast
  toast: {
    position: 'absolute', top: 16, left: 20, right: 20, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.cielo, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 16,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  toastText: { color: colors.blanco, fontSize: 14, fontWeight: '700' },
})
