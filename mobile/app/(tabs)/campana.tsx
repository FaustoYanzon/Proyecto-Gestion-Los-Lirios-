import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { getEstadoCampanaActual, postEstadoVariedadCampana } from '../../lib/api'
import { colors } from '../../lib/theme'
import { useAuthStore } from '../../store/authStore'
import type { EstadoActualVariedad, EstadoCampana, VariedadUva } from '../../lib/types'
import { ESTADO_CAMPANA_LABELS, ESTADO_CAMPANA_COLORES, VARIEDAD_LABELS } from '../../lib/types'

const ESTADOS: EstadoCampana[] = [
  'brotacion', 'floracion', 'cuaje', 'cierre_racimo', 'envero', 'cosecha', 'post_cosecha',
]

function isoToday() { return new Date().toISOString().split('T')[0] }

function formatDateDisplay(iso: string) {
  const [y, mo, d] = iso.split('-')
  return `${d}/${mo}/${y}`
}

// Mismo criterio de campaña (mayo->abril) que usa el resto de la app.
function anioCampanaActual(): number {
  const now = new Date()
  return now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ['Estado', 'Confirmar']

function StepIndicator({ current, onCancel }: { current: 0 | 1; onCancel: () => void }) {
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
  dotActive: { backgroundColor: colors.burdeos[600] },
  dotDone:   { backgroundColor: colors.burdeos[600] },
  dotText:   { fontSize: 11, fontWeight: '700', color: colors.niebla },
  label:     { fontSize: 11, color: colors.niebla, marginLeft: 6, fontWeight: '500', flex: 1 },
  labelActive: { color: colors.ink, fontWeight: '700' },
  labelDone:   { color: colors.burdeos[600], fontWeight: '600' },
  line:     { flex: 1, height: 1, backgroundColor: colors.hueso, marginHorizontal: 4 },
  lineDone: { backgroundColor: colors.burdeos[600] },
  cancelBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.hueso,
    justifyContent: 'center', alignItems: 'center', marginLeft: 8, flexShrink: 0,
  },
})

// ─── Step 1: elegir estado ──────────────────────────────────────────────────

function StepEstado({
  variedadLabel, currentEstado, onNext, onCancelar,
}: {
  variedadLabel: string
  currentEstado: EstadoCampana
  onNext: (estado: EstadoCampana) => void
  onCancelar: () => void
}) {
  const [selected, setSelected] = useState<EstadoCampana>(currentEstado)

  return (
    <View style={styles.stepContainer}>
      <StepIndicator current={0} onCancel={onCancelar} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Estado de campaña</Text>
        <Text style={styles.stepSubtitle}>{variedadLabel} · se aplica a todas sus parcelas</Text>

        <View style={styles.fasesGrid}>
          {ESTADOS.map((estado) => {
            const color = ESTADO_CAMPANA_COLORES[estado]
            const active = selected === estado
            return (
              <TouchableOpacity
                key={estado}
                style={[
                  styles.faseChip,
                  active
                    ? { backgroundColor: color, borderColor: color }
                    : { borderColor: `${color}60` },
                ]}
                onPress={() => setSelected(estado)}
                activeOpacity={0.8}
              >
                <View style={[styles.faseDot, { backgroundColor: active ? colors.blanco : color }]} />
                <Text style={[styles.faseLabel, active && { color: colors.blanco }]}>
                  {ESTADO_CAMPANA_LABELS[estado]}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { marginTop: 24 }]}
          onPress={() => onNext(selected)}
        >
          <Text style={styles.primaryBtnText}>Continuar</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  )
}

// ─── Step 2: confirmar ───────────────────────────────────────────────────────

function StepConfirmar({
  variedad, variedadLabel, estado, onSuccess, onBack, onCancelar,
}: {
  variedad: VariedadUva
  variedadLabel: string
  estado: EstadoCampana
  onSuccess: () => void
  onBack: () => void
  onCancelar: () => void
}) {
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)
  const color = ESTADO_CAMPANA_COLORES[estado]
  const today = isoToday()

  async function handleSubmit() {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      setLoading(true)
      await postEstadoVariedadCampana({
        variedad,
        anio: anioCampanaActual(),
        estado_campana: estado,
        fecha_confirmacion: today,
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
      <StepIndicator current={1} onCancel={onCancelar} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.stepTitle}>Confirmar</Text>

        <View style={styles.summaryCard}>
          <View style={[styles.summaryRow, styles.summaryRowBorder]}>
            <Text style={styles.summaryLabel}>Variedad</Text>
            <Text style={styles.summaryValue}>{variedadLabel}</Text>
          </View>
          <View style={[styles.summaryRow, styles.summaryRowBorder]}>
            <Text style={styles.summaryLabel}>Fecha</Text>
            <Text style={styles.summaryValue}>{formatDateDisplay(today)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Estado</Text>
            <View style={[styles.estadoBadgeLg, { backgroundColor: `${color}18`, borderColor: `${color}40` }]}>
              <View style={[styles.estadoDot, { backgroundColor: color }]} />
              <Text style={[styles.estadoLabelLg, { color }]}>{ESTADO_CAMPANA_LABELS[estado]}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.warningText}>
          Se va a aplicar a TODAS las parcelas de {variedadLabel}.
        </Text>

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

// ─── Tarjeta por variedad ─────────────────────────────────────────────────────

function VariedadCard({
  item, canEdit, onEdit,
}: {
  item: EstadoActualVariedad
  canEdit: boolean
  onEdit: () => void
}) {
  const color = ESTADO_CAMPANA_COLORES[item.estado_campana]
  const variedadLabel = VARIEDAD_LABELS[item.variedad] ?? item.variedad

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.variedadNombre}>{variedadLabel}</Text>
        <View style={[styles.estadoBadge, { backgroundColor: `${color}18`, borderColor: `${color}40` }]}>
          <View style={[styles.estadoDot, { backgroundColor: color }]} />
          <Text style={[styles.estadoLabel, { color }]}>{item.estado_campana_label}</Text>
        </View>
      </View>

      <Text style={styles.cardSub}>
        {item.parcelas.length} {item.parcelas.length === 1 ? 'parcela' : 'parcelas'} · riegos esperados: {item.riegos_esperados}
      </Text>
      <Text style={styles.cardFuente}>
        {item.fuente === 'manual'
          ? `✎ Confirmado a mano · ${item.fecha_confirmacion ? formatDateDisplay(item.fecha_confirmacion) : ''}`
          : `✦ Automático desde ${formatDateDisplay(item.fecha_inicio)}`}
      </Text>
      <Text style={styles.cardProximo}>
        Próximo: {ESTADO_CAMPANA_LABELS[item.proxima_estado_campana]} · {formatDateDisplay(item.proxima_fecha)}
      </Text>

      {canEdit && (
        <TouchableOpacity style={styles.editBtn} onPress={onEdit} activeOpacity={0.8}>
          <Ionicons name="create-outline" size={15} color={colors.burdeos[600]} />
          <Text style={styles.editBtnText}>Editar estado</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

type Step = 'list' | 'estado' | 'confirmar'

export default function CampanaScreen() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const canEdit = user?.role === 'gerencial' || user?.role === 'super_admin'

  const [step, setStep] = useState<Step>('list')
  const [items, setItems] = useState<EstadoActualVariedad[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const [selItem, setSelItem] = useState<EstadoActualVariedad | null>(null)
  const [selEstado, setSelEstado] = useState<EstadoCampana | null>(null)

  const loadData = useCallback(async () => {
    try {
      setItems(await getEstadoCampanaActual())
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

  function volverAInicio() {
    setStep('list')
    router.replace('/(tabs)')
  }

  function handleCancelar() {
    Alert.alert(
      'Cancelar carga',
      'Se van a perder los datos ingresados. ¿Volver a Inicio?',
      [
        { text: 'Seguir cargando', style: 'cancel' },
        { text: 'Salir', style: 'destructive', onPress: volverAInicio },
      ],
    )
  }

  function openEdit(item: EstadoActualVariedad) {
    setSelItem(item)
    setSelEstado(item.estado_campana)
    setStep('estado')
  }

  if (step === 'estado' && selItem) {
    return (
      <StepEstado
        variedadLabel={VARIEDAD_LABELS[selItem.variedad] ?? selItem.variedad}
        currentEstado={selEstado ?? selItem.estado_campana}
        onNext={(estado) => { setSelEstado(estado); setStep('confirmar') }}
        onCancelar={handleCancelar}
      />
    )
  }

  if (step === 'confirmar' && selItem && selEstado) {
    return (
      <StepConfirmar
        variedad={selItem.variedad}
        variedadLabel={VARIEDAD_LABELS[selItem.variedad] ?? selItem.variedad}
        estado={selEstado}
        onSuccess={() => { setStep('list'); loadData(); setToast('Estado actualizado ✓') }}
        onBack={() => setStep('estado')}
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
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.burdeos[600]} />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.burdeos[600]} style={{ marginTop: 32 }} />
        ) : items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="leaf-outline" size={36} color={colors.hueso} />
            <Text style={styles.emptyStateTitle}>Sin variedades activas</Text>
          </View>
        ) : (
          items.map((item) => (
            <VariedadCard
              key={item.variedad}
              item={item}
              canEdit={canEdit}
              onEdit={() => openEdit(item)}
            />
          ))
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  stepContainer: { flex: 1, backgroundColor: colors.hueso },
  stepTitle: { fontSize: 20, fontWeight: '800', color: colors.ink, marginBottom: 4 },
  stepSubtitle: { fontSize: 14, fontWeight: '600', color: colors.burdeos[600], marginBottom: 20 },

  // fases chips (step 1)
  fasesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  faseChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 16, paddingVertical: 13,
    borderRadius: 12, borderWidth: 1.5, backgroundColor: colors.blanco,
    minWidth: '45%', flexGrow: 1,
  },
  faseDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  faseLabel: { fontSize: 14, fontWeight: '600', color: colors.ink },

  // summary (step 2)
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
  warningText: {
    fontSize: 12, color: colors.niebla, marginTop: 12, textAlign: 'center', fontStyle: 'italic',
  },
  estadoBadgeLg: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1,
  },
  estadoLabelLg: { fontSize: 13, fontWeight: '700' },

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

  // variety cards (list)
  card: {
    backgroundColor: colors.blanco, borderRadius: 16, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: colors.hueso,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  variedadNombre: { fontSize: 16, fontWeight: '800', color: colors.ink },
  estadoBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1,
  },
  estadoDot: { width: 7, height: 7, borderRadius: 4 },
  estadoLabel: { fontSize: 11, fontWeight: '700' },
  cardSub: { fontSize: 12, color: colors.ink60, marginBottom: 3 },
  cardFuente: { fontSize: 11, color: colors.niebla, marginBottom: 2 },
  cardProximo: { fontSize: 11, color: colors.niebla },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 12, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1.5, borderColor: colors.burdeos[200],
  },
  editBtnText: { fontSize: 12, fontWeight: '700', color: colors.burdeos[600] },

  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyStateTitle: { fontSize: 15, fontWeight: '600', color: colors.ink60, marginTop: 12 },

  // toast
  toast: {
    position: 'absolute', top: 16, left: 20, right: 20, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.burdeos[600], borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 16,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  toastText: { color: colors.blanco, fontSize: 14, fontWeight: '700' },
})
