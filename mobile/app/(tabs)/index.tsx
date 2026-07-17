import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../../store/authStore'
import api, { getRiegosEnCurso, terminarRiego } from '../../lib/api'
import { getCache, setCache, CACHE_TTL } from '../../lib/cache'
import { advanceRotation } from '../../lib/rotation'
import { colors, fonts } from '../../lib/theme'
import type { FaseVariedad, RiegoEnCurso } from '../../lib/types'
import { VARIEDAD_LABELS, calcRiegoTotales } from '../../lib/types'

const NOTIF_ROTATION_KEY = 'fenologia_notif'
const NOTIF_ROTATION_INTERVAL_MS = 15 * 60 * 1000

function dateLabel() {
  return new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'short',
  })
}

function ActionButton({
  label, icon, bg, onPress,
}: {
  label: string
  icon: React.ComponentProps<typeof Ionicons>['name']
  bg: string
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { backgroundColor: bg }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Ionicons name={icon} size={22} color={colors.blanco} />
      <Text style={styles.actionBtnText}>{label}</Text>
    </TouchableOpacity>
  )
}

function formatTranscurrido(horas: number): string {
  const totalMin = Math.floor(horas * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

function RiegosEnCursoInicio({
  riegos, terminandoId, onTerminar,
}: {
  riegos: RiegoEnCurso[]
  terminandoId: string | null
  onTerminar: (r: RiegoEnCurso, horas: number, litros: number) => void
}) {
  if (riegos.length === 0) return null
  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={styles.sectionLabel}>RIEGOS EN CURSO</Text>
      {riegos.map((r) => {
        const totales = calcRiegoTotales(r.inicio, new Date().toISOString(), r.n_valvulas) ?? { horas: 0, litros: 0 }
        return (
          <View key={r.id} style={styles.enCursoCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.enCursoTitle}>Cabezal {r.cabezal} · V{r.valvula.split(',').join('+')}</Text>
              <Text style={styles.enCursoStats}>
                {formatTranscurrido(totales.horas)} · {totales.litros.toLocaleString('es-AR')} L
              </Text>
              <Text style={styles.enCursoResp}>{r.responsable}</Text>
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
    </View>
  )
}

function ClimateCardMini() {
  return (
    <View style={styles.climateCard}>
      <Ionicons name="partly-sunny-outline" size={18} color={colors.cielo} />
      <View style={{ flex: 1 }}>
        <Text style={styles.climateTemp}>22° · Despejado</Text>
        <Text style={styles.climateSub}>Los Mimbres — Fase 5</Text>
      </View>
    </View>
  )
}

// Tarea recomendada de UNA variedad por vez (no todas juntas), calculada
// automáticamente por fecha (app.core.fenologia en el backend) salvo que
// exista una confirmación manual vigente en Ciclo de Campaña (ventana de 45
// días), en cuyo caso esa gana — el tag de fuente aclara cuál es cuál. La
// variedad mostrada rota: ver useFocusEffect en InicioScreen (avanza al
// volver a esta pestaña y cada 15 min mientras queda abierta).
function FenologiaNotificaciones({
  fases, loading, idx,
}: { fases: FaseVariedad[]; loading: boolean; idx: number }) {
  if (loading) {
    return <View style={[styles.fenologiaCard, { height: 70 }]} />
  }
  if (fases.length === 0) return null

  const f = fases[idx % fases.length]

  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={styles.sectionLabel}>TAREAS RECOMENDADAS</Text>
      <View style={styles.fenologiaCard}>
        <View style={styles.fenologiaHeader}>
          <Text style={styles.fenologiaVariedad}>{VARIEDAD_LABELS[f.variedad] ?? f.variedad}</Text>
          <View style={styles.fenologiaBadge}>
            <Text style={styles.fenologiaBadgeText}>{f.fase_label}</Text>
          </View>
        </View>
        <Text style={styles.fenologiaFuente}>
          {f.fuente === 'manual'
            ? `✎ Confirmado a mano${f.fecha_confirmacion ? ` · ${f.fecha_confirmacion.split('-').reverse().join('/')}` : ''}`
            : '✦ Estimado automático'}
        </Text>
        {f.tareas_recomendadas.slice(0, 2).map((t, i) => (
          <Text key={i} style={styles.fenologiaTarea}>• {t}</Text>
        ))}
        {fases.length > 1 && (
          <Text style={styles.fenologiaContador}>{(idx % fases.length) + 1}/{fases.length}</Text>
        )}
      </View>
    </View>
  )
}

export default function InicioScreen() {
  const user = useAuthStore((s) => s.user)
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [fases, setFases] = useState<FaseVariedad[]>([])
  const [loadingFases, setLoadingFases] = useState(true)
  const [notifIdx, setNotifIdx] = useState(0)
  const [riegosEnCurso, setRiegosEnCurso] = useState<RiegoEnCurso[]>([])
  const [terminandoId, setTerminandoId] = useState<string | null>(null)

  const loadFenologia = useCallback(async () => {
    const cached = await getCache<FaseVariedad[]>('fenologia', CACHE_TTL.fenologia)
    if (cached) { setFases(cached); setLoadingFases(false) }
    try {
      const { data } = await api.get<FaseVariedad[]>('/produccion/fenologia/estado-actual')
      setFases(data)
      await setCache('fenologia', data)
    } catch { /* usa lo cacheado si existe */ }
    finally { setLoadingFases(false); setRefreshing(false) }
  }, [])

  const loadRiegosEnCurso = useCallback(async () => {
    try {
      setRiegosEnCurso(await getRiegosEnCurso())
    } catch { /* offline */ }
  }, [])

  useEffect(() => { loadFenologia(); loadRiegosEnCurso() }, [loadFenologia, loadRiegosEnCurso])

  // Refetch cada 30s para detectar riegos iniciados/cerrados desde otra
  // pantalla/dispositivo — el cronómetro de cada card es puramente local.
  useEffect(() => {
    const t = setInterval(loadRiegosEnCurso, 30_000)
    return () => clearInterval(t)
  }, [loadRiegosEnCurso])

  const [, setTick] = useState(0)
  useEffect(() => {
    if (riegosEnCurso.length === 0) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [riegosEnCurso.length])

  // Rota la notificación fenológica mostrada: avanza cada vez que esta
  // pestaña gana foco (login, volver de otra pestaña) y además cada 15 min
  // mientras queda abierta. `fases.length` como dependencia hace que, si el
  // foco ocurre antes de que termine de cargar (length 0), se dispare de
  // nuevo apenas los datos llegan.
  useFocusEffect(
    useCallback(() => {
      if (fases.length > 0) {
        advanceRotation(NOTIF_ROTATION_KEY, fases.length).then(setNotifIdx)
      }
      const interval = setInterval(() => {
        if (fases.length > 0) {
          advanceRotation(NOTIF_ROTATION_KEY, fases.length).then(setNotifIdx)
        }
      }, NOTIF_ROTATION_INTERVAL_MS)
      return () => clearInterval(interval)
    }, [fases.length]),
  )

  function onRefresh() { setRefreshing(true); loadFenologia(); loadRiegosEnCurso() }

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
              await loadRiegosEnCurso()
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

  const firstName = user?.full_name?.split(' ')[0] ?? ''

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.burdeos[600]}
        />
      }
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={[styles.dateText, { fontFamily: fonts.display }]}>
          {dateLabel()}
        </Text>
        <Text style={[styles.greeting, { fontFamily: fonts.sansBold }]}>
          {firstName ? `Hola, ${firstName}` : '¿Qué vas a hacer?'}
        </Text>
        {firstName ? (
          <Text style={[styles.subGreeting, { fontFamily: fonts.sans }]}>
            ¿Qué vas a hacer?
          </Text>
        ) : null}
      </View>

      {/* ── Action buttons ── */}
      <View style={styles.actionsGrid}>
        <ActionButton
          label="Ciclo Campaña"
          icon="leaf-outline"
          bg={colors.burdeos[600]}
          onPress={() => router.push('/(tabs)/campana')}
        />
      </View>

      {/* ── Riegos en curso ── */}
      <RiegosEnCursoInicio
        riegos={riegosEnCurso}
        terminandoId={terminandoId}
        onTerminar={handleTerminar}
      />

      {/* ── Climate mini ── */}
      <ClimateCardMini />

      {/* ── Tareas recomendadas (fenología automática) ── */}
      <FenologiaNotificaciones fases={fases} loading={loadingFases} idx={notifIdx} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  content: { padding: 16, paddingBottom: 32 },
  header: { marginBottom: 24 },
  dateText: { fontSize: 13, color: colors.ink60, fontWeight: '600', marginBottom: 4 },
  greeting: { fontSize: 24, color: colors.ink },
  subGreeting: { fontSize: 16, color: colors.ink60, marginTop: 2 },
  actionsGrid: { gap: 10, marginBottom: 16 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, paddingVertical: 18, paddingHorizontal: 20,
    minHeight: 56,
    shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 4,
  },
  actionBtnText: { color: colors.blanco, fontSize: 16, fontWeight: '700', flex: 1 },

  // riegos en curso
  enCursoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.crema, borderRadius: 14, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: colors.hueso,
  },
  enCursoTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  enCursoStats: { fontSize: 13, color: colors.cielo, fontWeight: '700', fontFamily: fonts.mono, marginTop: 2 },
  enCursoResp: { fontSize: 12, color: colors.ink60, marginTop: 1 },
  terminarBtn: {
    backgroundColor: colors.cielo, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14, flexShrink: 0,
  },
  terminarBtnText: { color: colors.blanco, fontSize: 13, fontWeight: '700' },

  climateCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.crema, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    marginBottom: 24,
    borderWidth: 1, borderColor: colors.hueso,
  },
  climateTemp: { fontSize: 15, fontWeight: '700', color: colors.ink },
  climateSub: { fontSize: 12, color: colors.niebla, marginTop: 1 },
  fenologiaCard: {
    backgroundColor: colors.blanco, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
    borderWidth: 1, borderColor: colors.hueso,
  },
  fenologiaHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4,
  },
  fenologiaVariedad: { fontSize: 14, fontWeight: '700', color: colors.ink },
  fenologiaBadge: {
    backgroundColor: '#f3e8ff', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  fenologiaBadgeText: { fontSize: 10, fontWeight: '700', color: '#7c3aed', textTransform: 'uppercase' },
  fenologiaFuente: { fontSize: 10, color: colors.niebla, marginBottom: 6 },
  fenologiaTarea: { fontSize: 12, color: colors.ink60, lineHeight: 17 },
  fenologiaContador: { fontSize: 10, color: colors.niebla, marginTop: 6, textAlign: 'right' },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 12,
  },
})
