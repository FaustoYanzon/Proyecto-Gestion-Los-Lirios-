import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
  RefreshControl,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import api from '../../lib/api'
import { getCache, CACHE_TTL } from '../../lib/cache'
import { colors } from '../../lib/theme'
import type { Parcela, EstadoFenologico } from '../../lib/types'
import { ESTADO_LABELS, ESTADO_COLORS } from '../../lib/types'

interface EstadoActual {
  parcela_id: string
  parcela_nombre: string
  estado_fenologico: EstadoFenologico | null
  fecha_estado: string | null
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ['Parcela', 'Estado', 'Confirmar']

function StepIndicator({ current, onCancel }: { current: 0 | 1 | 2; onCancel: () => void }) {
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
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: colors.blanco,
    borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  item: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.hueso, justifyContent: 'center', alignItems: 'center',
  },
  dotActive: { backgroundColor: colors.verdeCampo },
  dotDone:   { backgroundColor: colors.verdeCampo },
  dotText:   { fontSize: 11, fontWeight: '700', color: colors.niebla },
  label:     { fontSize: 11, color: colors.niebla, marginLeft: 6, fontWeight: '500' },
  labelActive: { color: colors.ink, fontWeight: '700' },
  labelDone:   { color: colors.verdeCampo, fontWeight: '600' },
  line:     { flex: 1, height: 1, backgroundColor: colors.hueso, marginHorizontal: 4 },
  lineDone: { backgroundColor: colors.verdeCampo },
  cancelBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.hueso,
    justifyContent: 'center', alignItems: 'center', marginLeft: 8, flexShrink: 0,
  },
})

// ─── Step 1: lista de parrales ────────────────────────────────────────────────

function StepParcela({
  parcelas, estados, onSelect, onCancelar,
}: {
  parcelas: Parcela[]
  estados: EstadoActual[]
  onSelect: (p: Parcela) => void
  onCancelar: () => void
}) {
  const parrales = parcelas.filter((p) => p.tipo === 'parral')

  // Sort: sin estado primero, luego por fecha_estado ASC (más antiguo primero = más urgente)
  const sorted = [...parrales].sort((a, b) => {
    const ea = estados.find((e) => e.parcela_id === a.id)
    const eb = estados.find((e) => e.parcela_id === b.id)
    const fa = ea?.fecha_estado ?? null
    const fb = eb?.fecha_estado ?? null
    if (!fa && !fb) return 0
    if (!fa) return -1
    if (!fb) return 1
    return fa.localeCompare(fb)
  })

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={0} onCancel={onCancelar} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.stepTitle}>¿Qué parral?</Text>
        <Text style={styles.stepHint}>Ordenados por última actualización — más antiguos primero.</Text>

        {sorted.map((p) => {
          const estado = estados.find((e) => e.parcela_id === p.id)
          const fase = estado?.estado_fenologico
          const fecha = estado?.fecha_estado
          const color = fase ? (ESTADO_COLORS[fase] ?? colors.niebla) : colors.niebla
          const label = fase ? (ESTADO_LABELS[fase] ?? fase) : null

          return (
            <TouchableOpacity
              key={p.id}
              style={styles.parcelaRow}
              onPress={() => onSelect(p)}
              activeOpacity={0.75}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.parcelaNombre}>{p.nombre}</Text>
                {p.variedad && (
                  <Text style={styles.parcelaSub}>{p.variedad.replace('_', ' ')}</Text>
                )}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {label ? (
                  <View style={[styles.estadoBadge, { backgroundColor: `${color}18`, borderColor: `${color}40` }]}>
                    <View style={[styles.estadoDot, { backgroundColor: color }]} />
                    <Text style={[styles.estadoLabel, { color }]}>{label}</Text>
                  </View>
                ) : (
                  <Text style={styles.sinEstado}>Sin estado</Text>
                )}
                {fecha && (
                  <Text style={styles.parcelaFecha}>
                    {fecha.split('-').reverse().join('/')}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.hueso} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          )
        })}

        {sorted.length === 0 && (
          <Text style={styles.emptyText}>Sin parrales activos</Text>
        )}
      </ScrollView>
    </View>
  )
}

// ─── Step 2: chip-grid estado + foto ─────────────────────────────────────────

const FASES: EstadoFenologico[] = [
  'brotacion', 'floracion', 'cuaje', 'envero', 'madurez', 'cosecha', 'latencia',
]

function StepEstado({
  parcela, onNext, onBack, onCancelar,
}: {
  parcela: Parcela
  onNext: (estado: EstadoFenologico, fotoUri: string | null) => void
  onBack: () => void
  onCancelar: () => void
}) {
  const [selected, setSelected] = useState<EstadoFenologico | null>(null)
  const [fotoUri, setFotoUri] = useState<string | null>(null)

  async function pickFoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert('Permiso denegado', 'Necesitás permitir el acceso a la galería.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    })
    if (!result.canceled && result.assets[0]) {
      setFotoUri(result.assets[0].uri)
    }
  }

  function handleNext() {
    if (!selected) { Alert.alert('Error', 'Seleccioná un estado fenológico.'); return }
    onNext(selected, fotoUri)
  }

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={1} onCancel={onCancelar} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Estado fenológico</Text>
        <Text style={styles.parcelaCtx}>{parcela.nombre}</Text>

        <View style={styles.fasesGrid}>
          {FASES.map((fase) => {
            const faseColor = ESTADO_COLORS[fase]
            const active = selected === fase
            return (
              <TouchableOpacity
                key={fase}
                style={[
                  styles.faseChip,
                  active
                    ? { backgroundColor: faseColor, borderColor: faseColor }
                    : { borderColor: `${faseColor}60` },
                ]}
                onPress={() => setSelected(fase)}
                activeOpacity={0.8}
              >
                <View style={[styles.faseDot, { backgroundColor: active ? colors.blanco : faseColor }]} />
                <Text style={[styles.faseLabel, active && { color: colors.blanco }]}>
                  {ESTADO_LABELS[fase]}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {/* Foto opcional */}
        <Text style={[styles.fieldLabel, { marginTop: 24 }]}>FOTO (opcional)</Text>
        {fotoUri ? (
          <View style={styles.fotoPreview}>
            <Image source={{ uri: fotoUri }} style={styles.fotoImg} />
            <TouchableOpacity style={styles.fotoRemove} onPress={() => setFotoUri(null)}>
              <Ionicons name="close-circle" size={22} color={colors.sangre} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.fotoBtn} onPress={pickFoto}>
            <Ionicons name="camera-outline" size={20} color={colors.ink60} />
            <Text style={styles.fotoBtnText}>Agregar foto</Text>
          </TouchableOpacity>
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
  parcela, estado, fotoUri, onSuccess, onBack, onCancelar,
}: {
  parcela: Parcela
  estado: EstadoFenologico
  fotoUri: string | null
  onSuccess: () => void
  onBack: () => void
  onCancelar: () => void
}) {
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)
  const today = new Date().toISOString().split('T')[0]
  const anio = new Date().getMonth() >= 4 ? new Date().getFullYear() : new Date().getFullYear() - 1
  const faseColor = ESTADO_COLORS[estado]

  async function handleSubmit() {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      setLoading(true)
      await api.post('/produccion/campana/', {
        parcela_id: parcela.id,
        anio,
        fecha_estado: today,
        estado_fenologico: estado,
      })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', typeof detail === 'string' ? detail : 'No se pudo guardar el estado.')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={2} onCancel={onCancelar} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Confirmar</Text>

        <View style={styles.summaryCard}>
          {[
            { label: 'Parcela', value: parcela.nombre },
            { label: 'Fecha',   value: today.split('-').reverse().join('/') },
          ].map(({ label, value }, idx) => (
            <View key={label} style={[styles.summaryRow, idx === 0 && styles.summaryRowBorder]}>
              <Text style={styles.summaryLabel}>{label}</Text>
              <Text style={styles.summaryValue}>{value}</Text>
            </View>
          ))}

          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Estado</Text>
            <View style={[styles.estadoBadgeLg, { backgroundColor: `${faseColor}18`, borderColor: `${faseColor}40` }]}>
              <View style={[styles.estadoDot, { backgroundColor: faseColor }]} />
              <Text style={[styles.estadoLabelLg, { color: faseColor }]}>
                {ESTADO_LABELS[estado]}
              </Text>
            </View>
          </View>
        </View>

        {fotoUri && (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.fieldLabel}>FOTO</Text>
            <Image source={{ uri: fotoUri }} style={styles.fotoSummary} />
            <Text style={styles.fotoNote}>Upload disponible en Fase 5</Text>
          </View>
        )}

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

type Step = 'list' | 'estado' | 'confirmar'

export default function CampanaScreen() {
  const [step, setStep] = useState<Step>('list')
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [estados, setEstados] = useState<EstadoActual[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const [selParcela, setSelParcela] = useState<Parcela | null>(null)
  const [selEstado, setSelEstado] = useState<EstadoFenologico | null>(null)
  const [selFoto, setSelFoto] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const cached = await getCache<Parcela[]>('parcelas', CACHE_TTL.parcelas)
    if (cached) setParcelas(cached)

    try {
      const [parcelasRes, estadosRes] = await Promise.all([
        api.get<Parcela[]>('/parcelas/mapa'),
        api.get<EstadoActual[]>('/produccion/campana/estado-actual/'),
      ])
      const active = parcelasRes.data.filter((p) => p.is_active)
      setParcelas(active)
      setEstados(estadosRes.data)
    } catch { /* offline */ }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  function onRefresh() { setRefreshing(true); loadData() }

  function resetWizard() {
    setSelParcela(null); setSelEstado(null); setSelFoto(null)
    setStep('list')
    loadData()
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

  if (step === 'estado' && selParcela) {
    return (
      <StepEstado
        parcela={selParcela}
        onNext={(estado, foto) => { setSelEstado(estado); setSelFoto(foto); setStep('confirmar') }}
        onBack={() => setStep('list')}
        onCancelar={handleCancelar}
      />
    )
  }

  if (step === 'confirmar' && selParcela && selEstado) {
    return (
      <StepConfirmar
        parcela={selParcela}
        estado={selEstado}
        fotoUri={selFoto}
        onSuccess={() => { resetWizard(); setToast('Estado guardado ✓') }}
        onBack={() => setStep('estado')}
        onCancelar={handleCancelar}
      />
    )
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.verdeCampo} />
      </View>
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
      <StepParcela
        parcelas={parcelas}
        estados={estados}
        onSelect={(p) => { setSelParcela(p); setStep('estado') }}
        onCancelar={handleCancelar}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  stepContainer: { flex: 1, backgroundColor: colors.hueso },
  stepTitle: { fontSize: 20, fontWeight: '800', color: colors.ink, marginBottom: 4 },
  stepHint: { fontSize: 13, color: colors.niebla, marginBottom: 16 },
  parcelaCtx: { fontSize: 14, fontWeight: '600', color: colors.burdeos[600], marginBottom: 20 },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },

  // lista parrales
  parcelaRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.blanco, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 14, marginBottom: 8,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  parcelaNombre: { fontSize: 14, fontWeight: '700', color: colors.ink },
  parcelaSub: { fontSize: 12, color: colors.ink60, marginTop: 2, textTransform: 'capitalize' },
  parcelaFecha: { fontSize: 11, color: colors.niebla, marginTop: 2 },
  estadoBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1,
  },
  estadoDot: { width: 7, height: 7, borderRadius: 4 },
  estadoLabel: { fontSize: 11, fontWeight: '700' },
  sinEstado: { fontSize: 11, color: colors.niebla, fontStyle: 'italic' },

  // fases chips
  fasesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  faseChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 16, paddingVertical: 13,
    borderRadius: 12, borderWidth: 1.5, backgroundColor: colors.blanco,
    minWidth: '45%', flexGrow: 1,
  },
  faseDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  faseLabel: { fontSize: 14, fontWeight: '600', color: colors.ink },

  // foto
  fotoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.niebla,
    paddingVertical: 20, backgroundColor: colors.blanco,
  },
  fotoBtnText: { fontSize: 14, color: colors.ink60, fontWeight: '500' },
  fotoPreview: { position: 'relative', borderRadius: 12, overflow: 'hidden' },
  fotoImg: { width: '100%', height: 180, borderRadius: 12 },
  fotoRemove: { position: 'absolute', top: 8, right: 8 },
  fotoSummary: { width: '100%', height: 160, borderRadius: 12, marginBottom: 6 },
  fotoNote: { fontSize: 11, color: colors.niebla, fontStyle: 'italic', textAlign: 'center' },

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
  summaryLabel: { fontSize: 13, color: colors.ink60, fontWeight: '600' },
  summaryValue: { fontSize: 14, color: colors.ink, fontWeight: '700' },
  estadoBadgeLg: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1,
  },
  estadoLabelLg: { fontSize: 13, fontWeight: '700' },

  // actions
  actionRow: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    height: 52, backgroundColor: colors.verdeCampo, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', flexDirection: 'row',
  },
  primaryBtnText: { color: colors.blanco, fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    flex: 1, height: 52, borderRadius: 12,
    borderWidth: 1.5, borderColor: colors.hueso,
    backgroundColor: colors.blanco, justifyContent: 'center', alignItems: 'center',
  },
  secondaryBtnText: { color: colors.ink, fontSize: 15, fontWeight: '600' },

  emptyText: { fontSize: 14, color: colors.niebla, fontStyle: 'italic', paddingVertical: 12 },

  // loading
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.hueso },

  // toast
  toast: {
    position: 'absolute', top: 16, left: 20, right: 20, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.verdeCampo, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 16,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  toastText: { color: colors.blanco, fontSize: 14, fontWeight: '700' },
})
