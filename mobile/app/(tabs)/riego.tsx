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
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import api from '../../lib/api'
import { getCache, setCache, CACHE_TTL } from '../../lib/cache'
import { useAuthStore } from '../../store/authStore'
import { colors, fonts } from '../../lib/theme'
import type { Parcela, RegistroRiego } from '../../lib/types'
import { CABEZAL_VALVULAS } from '../../lib/types'

const M3_POR_HORA = 3.6

function isoNow() { return new Date().toISOString() }
function isoToday() { return new Date().toISOString().split('T')[0] }

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatDatetime(dt: string) {
  try {
    return new Date(dt).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch { return dt }
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ['Cabezal', 'Riego', 'Confirmar']

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
  dotActive: { backgroundColor: colors.cielo },
  dotDone:   { backgroundColor: colors.cielo },
  dotText:   { fontSize: 11, fontWeight: '700', color: colors.niebla },
  label:     { fontSize: 11, color: colors.niebla, marginLeft: 6, fontWeight: '500' },
  labelActive: { color: colors.ink, fontWeight: '700' },
  labelDone:   { color: colors.cielo, fontWeight: '600' },
  line:     { flex: 1, height: 1, backgroundColor: colors.hueso, marginHorizontal: 4 },
  lineDone: { backgroundColor: colors.cielo },
})

// ─── Step 1: seleccionar cabezal ──────────────────────────────────────────────

const CABEZALES = Object.keys(CABEZAL_VALVULAS).sort()

function StepCabezal({ onSelect }: { onSelect: (cabezal: string | null) => void }) {
  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={0} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.stepTitle}>¿Qué cabezal?</Text>

        <View style={styles.cabezalGrid}>
          {CABEZALES.map((cab) => {
            const info = CABEZAL_VALVULAS[cab]
            return (
              <TouchableOpacity
                key={cab}
                style={styles.cabezalCard}
                onPress={() => onSelect(cab)}
                activeOpacity={0.8}
              >
                <Text style={styles.cabezalNum}>{cab}</Text>
                <Text style={styles.cabezalDesc} numberOfLines={2}>
                  {info?.descripcion ?? ''}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <TouchableOpacity
          style={styles.mantoBtn}
          onPress={() => onSelect(null)}
          activeOpacity={0.8}
        >
          <Ionicons name="water-outline" size={18} color={colors.ink60} />
          <Text style={styles.mantoBtnText}>Sin cabezal (manto)</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}

// ─── Step 2: cronómetro + parcelas ────────────────────────────────────────────

function StepCronometro({
  cabezal, parcelas, onNext, onBack,
}: {
  cabezal: string | null
  parcelas: Parcela[]
  onNext: (inicio: string, fin: string, selectedIds: string[]) => void
  onBack: () => void
}) {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [inicioISO, setInicioISO] = useState<string | null>(null)
  const [finISO, setFinISO] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const parcelasFiltradas = cabezal
    ? parcelas.filter(
        (p) => p.tipo === 'parral' && p.cabezal_riego === cabezal,
      )
    : parcelas.filter((p) => p.tipo === 'parral')

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  function handleStart() {
    const now = isoNow()
    setInicioISO(now)
    setFinISO(null)
    setElapsed(0)
    setRunning(true)
    intervalRef.current = setInterval(() => {
      setElapsed((e) => e + 1)
    }, 1000)
  }

  function handleStop() {
    setFinISO(isoNow())
    setRunning(false)
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  function toggleParcela(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleNext() {
    if (!inicioISO) { Alert.alert('Error', 'Iniciá el cronómetro primero.'); return }
    if (!finISO)    { Alert.alert('Error', 'Detené el cronómetro para registrar el fin.'); return }
    onNext(inicioISO, finISO, Array.from(selectedIds))
  }

  const m3Estimados = elapsed > 0 ? ((elapsed / 3600) * M3_POR_HORA).toFixed(1) : null

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={1} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>
          {cabezal ? `Cabezal ${cabezal}` : 'Riego a manto'}
        </Text>

        {/* Cronómetro */}
        <View style={styles.chronoCard}>
          <Text style={[styles.chronoTime, { fontFamily: fonts.mono }]}>
            {formatDuration(elapsed)}
          </Text>
          {m3Estimados && (
            <Text style={styles.chronoM3}>≈ {m3Estimados} m³ estimados</Text>
          )}
          <View style={styles.chronoBtns}>
            {!running && !inicioISO && (
              <TouchableOpacity style={styles.startBtn} onPress={handleStart}>
                <Ionicons name="play" size={20} color={colors.blanco} />
                <Text style={styles.startBtnText}>Iniciar</Text>
              </TouchableOpacity>
            )}
            {running && (
              <TouchableOpacity style={styles.stopBtn} onPress={handleStop}>
                <Ionicons name="stop" size={20} color={colors.blanco} />
                <Text style={styles.startBtnText}>Detener</Text>
              </TouchableOpacity>
            )}
            {!running && inicioISO && (
              <View style={styles.chronoDone}>
                <Ionicons name="checkmark-circle" size={18} color={colors.cielo} />
                <Text style={styles.chronoDoneText}>
                  {formatDatetime(inicioISO)} → {finISO ? formatDatetime(finISO) : '…'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Parcelas */}
        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>PARCELAS REGADAS</Text>
        {parcelasFiltradas.length === 0 ? (
          <Text style={styles.emptyText}>Sin parrales para este cabezal</Text>
        ) : (
          <View style={styles.parcelasGrid}>
            {parcelasFiltradas.map((p) => {
              const active = selectedIds.has(p.id)
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.parcelaChip, active && styles.parcelaChipActive]}
                  onPress={() => toggleParcela(p.id)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.parcelaChipText, active && styles.parcelaChipTextActive]}>
                    {p.nombre}
                  </Text>
                  {active && <Ionicons name="checkmark" size={13} color={colors.blanco} style={{ marginLeft: 4 }} />}
                </TouchableOpacity>
              )
            })}
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

// ─── Step 3: confirmar ────────────────────────────────────────────────────────

function StepConfirmar({
  cabezal, inicioISO, finISO, parcelaIds, parcelas,
  onSuccess, onBack,
}: {
  cabezal: string | null
  inicioISO: string
  finISO: string
  parcelaIds: string[]
  parcelas: Parcela[]
  onSuccess: () => void
  onBack: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const [observacion, setObservacion] = useState('')
  const [loading, setLoading] = useState(false)

  const duracionSec = Math.round(
    (new Date(finISO).getTime() - new Date(inicioISO).getTime()) / 1000,
  )
  const duracionH = duracionSec / 3600
  const m3Estimados = (duracionH * M3_POR_HORA).toFixed(2)

  const selectedParcelas = parcelas.filter((p) => parcelaIds.includes(p.id))
  const fecha = inicioISO.split('T')[0]

  async function handleSubmit() {
    const responsable = user?.full_name ?? 'Sin nombre'
    try {
      setLoading(true)
      if (selectedParcelas.length === 0) {
        // Sin parcela — un único registro
        await api.post('/produccion/riego/', {
          fecha,
          parcela_id: null,
          cabezal: cabezal ?? 'MANTO',
          valvula: '1',
          inicio: inicioISO,
          fin: finISO,
          responsable,
          ...(observacion.trim() ? {} : {}),
        })
      } else {
        await Promise.all(
          selectedParcelas.map((p) =>
            api.post('/produccion/riego/', {
              fecha,
              parcela_id: p.id,
              cabezal: p.cabezal_riego ?? cabezal ?? 'MANTO',
              valvula: '1',
              inicio: inicioISO,
              fin: finISO,
              responsable,
            }),
          ),
        )
      }
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', typeof detail === 'string' ? detail : 'No se pudo guardar el riego.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={2} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Confirmar</Text>

        <View style={styles.summaryCard}>
          {[
            { label: 'Cabezal',   value: cabezal ? `Cabezal ${cabezal}` : 'Manto' },
            { label: 'Inicio',    value: formatDatetime(inicioISO) },
            { label: 'Fin',       value: formatDatetime(finISO) },
            { label: 'Duración',  value: formatDuration(duracionSec) },
            { label: 'm³ est.',   value: `${m3Estimados} m³`, highlight: true },
            {
              label: 'Parcelas',
              value: selectedParcelas.length > 0
                ? selectedParcelas.map((p) => p.nombre).join(', ')
                : 'Sin parcela',
            },
          ].map(({ label, value, highlight }, idx, arr) => (
            <View
              key={label}
              style={[
                styles.summaryRow,
                idx < arr.length - 1 && styles.summaryRowBorder,
                highlight && styles.summaryRowHighlight,
              ]}
            >
              <Text style={[styles.summaryLabel, highlight && { color: colors.cielo }]}>
                {label}
              </Text>
              <Text
                style={[styles.summaryValue, highlight && { color: colors.cielo }, { flex: 1, textAlign: 'right' }]}
                numberOfLines={2}
              >
                {value}
              </Text>
            </View>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { marginTop: 20 }]}>OBSERVACIÓN (opcional)</Text>
        <TextInput
          style={[styles.input, { height: 80, textAlignVertical: 'top', paddingTop: 12 }]}
          value={observacion}
          onChangeText={setObservacion}
          placeholder="Notas sobre el riego..."
          placeholderTextColor={colors.niebla}
          multiline
        />

        <View style={styles.actionRow}>
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

// ─── Recent riegos ────────────────────────────────────────────────────────────

function RecentRiegos({
  riegos, parcelas, refreshing, onRefresh,
}: {
  riegos: RegistroRiego[]
  parcelas: Parcela[]
  refreshing: boolean
  onRefresh: () => void
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
                  <Text style={styles.badgeText}>Cab. {r.cabezal}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: '#e0f2fe' }]}>
                  <Text style={[styles.badgeText, { color: colors.cielo }]}>
                    {r.duracion_horas.toFixed(1)} h
                  </Text>
                </View>
                {r.mm_aplicados != null && (
                  <View style={[styles.badge, { backgroundColor: '#e0f2fe' }]}>
                    <Text style={[styles.badgeText, { color: colors.cielo }]}>
                      {r.mm_aplicados} mm
                    </Text>
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

type Step = 'list' | 'cabezal' | 'cronometro' | 'confirmar' | 'success'

export default function RiegoScreen() {
  const [step, setStep] = useState<Step>('list')
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [riegos, setRiegos] = useState<RegistroRiego[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const [selCabezal, setSelCabezal] = useState<string | null>(null)
  const [selInicio, setSelInicio] = useState('')
  const [selFin, setSelFin] = useState('')
  const [selParcelaIds, setSelParcelaIds] = useState<string[]>([])

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

  useEffect(() => { loadData() }, [loadData])

  function onRefresh() { setRefreshing(true); loadData() }

  function resetWizard() {
    setSelCabezal(null); setSelInicio(''); setSelFin(''); setSelParcelaIds([])
    setStep('list')
  }

  if (step === 'cabezal') {
    return (
      <StepCabezal
        onSelect={(cab) => { setSelCabezal(cab); setStep('cronometro') }}
      />
    )
  }

  if (step === 'cronometro') {
    return (
      <StepCronometro
        cabezal={selCabezal}
        parcelas={parcelas}
        onNext={(inicio, fin, ids) => {
          setSelInicio(inicio); setSelFin(fin); setSelParcelaIds(ids)
          setStep('confirmar')
        }}
        onBack={() => setStep('cabezal')}
      />
    )
  }

  if (step === 'confirmar') {
    return (
      <StepConfirmar
        cabezal={selCabezal}
        inicioISO={selInicio}
        finISO={selFin}
        parcelaIds={selParcelaIds}
        parcelas={parcelas}
        onSuccess={() => { setStep('success'); loadData() }}
        onBack={() => setStep('cronometro')}
      />
    )
  }

  if (step === 'success') {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successIcon}>
          <Ionicons name="water" size={36} color={colors.blanco} />
        </View>
        <Text style={[styles.successTitle, { fontFamily: fonts.display }]}>Riego registrado</Text>
        <Text style={styles.successSub}>Se guardó el registro correctamente</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={resetWizard}>
          <Text style={styles.primaryBtnText}>Nuevo riego</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity
        style={styles.newBtn}
        onPress={() => setStep('cabezal')}
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

  // cabezal grid 2×2
  cabezalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  cabezalCard: {
    width: '47%', backgroundColor: colors.cielo, borderRadius: 16,
    padding: 20, alignItems: 'center',
    shadowColor: colors.cielo,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  cabezalNum: { fontSize: 36, fontWeight: '800', color: colors.blanco, marginBottom: 6 },
  cabezalDesc: { fontSize: 11, color: 'rgba(255,255,255,0.8)', textAlign: 'center', fontWeight: '500' },
  mantoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderRadius: 14, borderWidth: 1.5, borderColor: colors.hueso,
    backgroundColor: colors.blanco, paddingVertical: 16,
  },
  mantoBtnText: { fontSize: 15, color: colors.ink60, fontWeight: '600' },

  // cronómetro
  chronoCard: {
    backgroundColor: colors.blanco, borderRadius: 20, padding: 24,
    alignItems: 'center', borderWidth: 1, borderColor: colors.hueso,
  },
  chronoTime: { fontSize: 48, color: colors.ink, letterSpacing: 2, marginBottom: 6 },
  chronoM3: { fontSize: 14, color: colors.cielo, fontWeight: '600', marginBottom: 16 },
  chronoBtns: { width: '100%' },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.cielo, borderRadius: 12, paddingVertical: 14,
  },
  stopBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.sangre, borderRadius: 12, paddingVertical: 14,
  },
  startBtnText: { color: colors.blanco, fontSize: 16, fontWeight: '700' },
  chronoDone: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#e0f2fe', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14,
  },
  chronoDoneText: { fontSize: 13, color: colors.cielo, fontWeight: '600' },

  // parcelas multiselect
  parcelasGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  parcelaChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.hueso, backgroundColor: colors.blanco,
  },
  parcelaChipActive: { backgroundColor: colors.cielo, borderColor: colors.cielo },
  parcelaChipText: { fontSize: 13, color: colors.ink, fontWeight: '600' },
  parcelaChipTextActive: { color: colors.blanco },

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

  input: {
    backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.hueso,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 14, height: 48,
  },
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
  riegoBadges: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  badge: {
    backgroundColor: colors.crema, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.burdeos[600] },
  riegoResp: { fontSize: 12, color: colors.cielo, fontWeight: '600' },

  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyStateTitle: { fontSize: 14, color: colors.niebla, marginTop: 10 },
  emptyText: { fontSize: 13, color: colors.niebla, fontStyle: 'italic', paddingVertical: 8 },

  // success
  successContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.hueso, padding: 32,
  },
  successIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: colors.cielo,
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
    shadowColor: colors.cielo,
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  successTitle: { fontSize: 26, color: colors.ink, marginBottom: 8 },
  successSub: { fontSize: 15, color: colors.ink60, marginBottom: 32, textAlign: 'center' },
})
