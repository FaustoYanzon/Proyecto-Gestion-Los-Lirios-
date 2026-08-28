import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { ICONS, ICON_STROKE, type IconKey } from '../../lib/icons'
import { useAuthStore } from '../../store/authStore'
import { useFincaStore } from '../../store/fincaStore'
import api, { getRiegosEnCurso } from '../../lib/api'
import { getCache, setCache, CACHE_TTL } from '../../lib/cache'
import { advanceRotation } from '../../lib/rotation'
import { colors, fonts, FINCA_COORDS, fenologiaColors, withAlpha } from '../../lib/theme'
import type { FaseVariedad, Parcela, RiegoEnCurso } from '../../lib/types'
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
  icon: IconKey
  bg: string
  onPress: () => void
}) {
  const Icon = ICONS[icon]
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { backgroundColor: bg }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Icon size={22} color={colors.blanco} strokeWidth={ICON_STROKE} />
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
  riegos, parcelaNombre,
}: {
  riegos: RiegoEnCurso[]
  parcelaNombre: (id: string) => string
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
              <Text style={styles.enCursoTitle}>
                Cabezal {r.cabezal} - {parcelaNombre(r.parcela_id)} - V{r.valvula.split(',').join('+')}
              </Text>
              <Text style={styles.enCursoStats}>
                {formatTranscurrido(totales.horas)}
              </Text>
              <Text style={styles.enCursoResp}>{r.responsable}</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}

// Fuente: /clima/actual (Open-Meteo vía backend, cache de 30 min). Evaluado
// scrapear Climagro (estación real en la finca) el 2026-08-05 y descartado
// por ahora — sin API, requiere login+parseo de HTML, mantenimiento frágil.
// Espejo del ClimateCard de frontend/app/dashboard/page.tsx (mismos datos,
// mismos umbrales de UV) — mantener sincronizado a mano si cambia uno.
interface ClimaActualMini {
  current: {
    temperature_2m: number
    apparent_temperature: number
    relative_humidity_2m: number
    wind_speed_10m: number
    wind_direction_10m: number
    weather_code: number
  }
  daily: {
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    uv_index_max: number[]
  }
  _cached?: boolean
}

function wmoDescriptionMini(code: number): string {
  if (code === 0) return 'Despejado'
  if (code <= 2) return 'Parcialmente nublado'
  if (code === 3) return 'Nublado'
  if (code <= 49) return 'Niebla'
  if (code <= 69 || code === 80 || code === 81 || code === 82) return 'Lluvia'
  if (code <= 79) return 'Nieve'
  if (code <= 99) return 'Tormenta'
  return 'Variable'
}

function wmoIconNameMini(code: number): IconKey {
  if (code === 0) return 'clima'
  if (code <= 2) return 'nubesol'
  if (code === 3) return 'nublado'
  if (code <= 49) return 'nublado'
  if (code <= 69 || code === 80 || code === 81 || code === 82) return 'lluvia'
  if (code <= 79) return 'nieve'
  if (code <= 99) return 'tormenta'
  return 'nublado'
}

// Grados → punto cardinal abreviado (N/NE/E/SE/S/SO/O/NO)
function windDirectionLabelMini(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO']
  return dirs[Math.round(deg / 45) % 8]
}

function uvLevelMini(uv: number): { label: string; color: string } {
  if (uv < 3) return { label: 'Bajo', color: colors.verdeCampo }
  if (uv < 6) return { label: 'Moderado', color: '#b8860b' }
  if (uv < 8) return { label: 'Alto', color: '#c96a1f' }
  if (uv < 11) return { label: 'Muy alto', color: colors.sangre }
  return { label: 'Extremo', color: colors.burdeos[600] }
}

function ClimateCardMini() {
  const finca = useFincaStore((s) => s.active.key)
  const [clima, setClima] = useState<ClimaActualMini | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const cached = await getCache<ClimaActualMini>('clima', CACHE_TTL.clima)
      if (cached) { setClima(cached); setLoading(false) }
      try {
        const { data } = await api.get<ClimaActualMini>('/clima/actual', { params: { finca } })
        setClima(data)
        await setCache('clima', data)
      } catch { /* usa lo cacheado si existe, si no queda oculto */ }
      finally { setLoading(false) }
    })()
  }, [finca])

  if (loading && !clima) {
    return <View style={[styles.climateCard, { height: 132 }]} />
  }
  if (!clima) return null

  const temp = Math.round(clima.current.temperature_2m)
  const feels = Math.round(clima.current.apparent_temperature)
  const max = clima.daily.temperature_2m_max[0] != null ? Math.round(clima.daily.temperature_2m_max[0]) : null
  const min = clima.daily.temperature_2m_min[0] != null ? Math.round(clima.daily.temperature_2m_min[0]) : null
  const wind = Math.round(clima.current.wind_speed_10m)
  const windDir = windDirectionLabelMini(clima.current.wind_direction_10m)
  const humidity = Math.round(clima.current.relative_humidity_2m)
  const uv = clima.daily.uv_index_max[0] != null ? Math.round(clima.daily.uv_index_max[0]) : null
  const uvInfo = uv !== null ? uvLevelMini(uv) : null
  const WeatherIcon = ICONS[wmoIconNameMini(clima.current.weather_code)]

  return (
    <View style={styles.climateCard}>
      <View style={styles.climateHeader}>
        <WeatherIcon size={16} color={colors.cielo} strokeWidth={ICON_STROKE} />
        <Text style={styles.climateHeaderText}>
          CLIMA — {(FINCA_COORDS[finca as keyof typeof FINCA_COORDS]?.label ?? finca).toUpperCase()}
        </Text>
      </View>

      <View style={styles.climateBigRow}>
        <Text style={styles.climateTemp}>{temp}°</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.climateDesc}>
            {wmoDescriptionMini(clima.current.weather_code)}
            {feels !== temp ? ` · Sensación ${feels}°` : ''}
          </Text>
          {max !== null && min !== null && (
            <Text style={styles.climateMaxMin}>Máx {max}° · Mín {min}°</Text>
          )}
        </View>
      </View>

      <View style={styles.climateStatsRow}>
        <View style={styles.climateStatCol}>
          <ICONS.viento size={15} color={colors.ink60} strokeWidth={ICON_STROKE} />
          <Text style={styles.climateStatValue}>{wind} km/h</Text>
          <Text style={styles.climateStatLabel}>{windDir}</Text>
        </View>
        <View style={styles.climateStatCol}>
          <ICONS.humedad size={15} color={colors.ink60} strokeWidth={ICON_STROKE} />
          <Text style={styles.climateStatValue}>{humidity}%</Text>
          <Text style={styles.climateStatLabel}>Humedad</Text>
        </View>
        <View style={styles.climateStatCol}>
          <ICONS.uv size={15} color={colors.ink60} strokeWidth={ICON_STROKE} />
          <Text style={[styles.climateStatValue, uvInfo && { color: uvInfo.color }]}>UV {uv}</Text>
          <Text style={styles.climateStatLabel}>{uvInfo?.label}</Text>
        </View>
      </View>

      <Text style={styles.climateUpdated}>
        {clima._cached ? 'Actualizado hace menos de 30 min' : 'Actualizado ahora'}
      </Text>
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
  const faseColor = fenologiaColors[f.fase] ?? colors.ink60

  return (
    <View style={{ marginBottom: 24 }}>
      <Text style={styles.sectionLabel}>TAREAS RECOMENDADAS</Text>
      <View style={styles.fenologiaCard}>
        <View style={styles.fenologiaHeader}>
          <Text style={styles.fenologiaVariedad}>{VARIEDAD_LABELS[f.variedad] ?? f.variedad}</Text>
          <View style={[styles.fenologiaBadge, { backgroundColor: withAlpha(faseColor, 0.12) }]}>
            <Text style={[styles.fenologiaBadgeText, { color: faseColor }]}>{f.fase_label}</Text>
          </View>
        </View>
        <Text style={styles.fenologiaFuente}>
          {f.fuente === 'manual'
            ? `Confirmado a mano${f.fecha_confirmacion ? ` · ${f.fecha_confirmacion.split('-').reverse().join('/')}` : ''}`
            : 'Estimado según fecha de campaña'}
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
  const [parcelas, setParcelas] = useState<Parcela[]>([])

  function parcelaNombre(id: string) {
    return parcelas.find((p) => p.id === id)?.nombre ?? '—'
  }

  const loadParcelas = useCallback(async () => {
    const cached = await getCache<Parcela[]>('parcelas', CACHE_TTL.parcelas)
    if (cached) setParcelas(cached)
    try {
      const { data } = await api.get<Parcela[]>('/parcelas/mapa')
      setParcelas(data)
      await setCache('parcelas', data)
    } catch { /* usa lo cacheado si existe */ }
  }, [])

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

  useEffect(() => { loadFenologia(); loadRiegosEnCurso(); loadParcelas() }, [loadFenologia, loadRiegosEnCurso, loadParcelas])

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

  function onRefresh() { setRefreshing(true); loadFenologia(); loadRiegosEnCurso(); loadParcelas() }

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
          icon="campana"
          bg={colors.burdeos[600]}
          onPress={() => router.push('/(tabs)/campana')}
        />
      </View>

      {/* ── Riegos en curso ── */}
      <RiegosEnCursoInicio
        riegos={riegosEnCurso}
        parcelaNombre={parcelaNombre}
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
    backgroundColor: colors.crema, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    marginBottom: 24,
    borderWidth: 1, borderColor: colors.hueso,
  },
  climateHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  climateHeaderText: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6,
  },
  climateBigRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  climateTemp: { fontSize: 34, fontWeight: '800', color: colors.ink, lineHeight: 36 },
  climateDesc: { fontSize: 13, color: colors.ink60, marginBottom: 2 },
  climateMaxMin: { fontSize: 12, color: colors.niebla },
  climateStatsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: 14, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: colors.hueso,
  },
  climateStatCol: { alignItems: 'center', gap: 3, flex: 1 },
  climateStatValue: { fontSize: 13, fontWeight: '700', color: colors.ink },
  climateStatLabel: { fontSize: 10, color: colors.niebla },
  climateUpdated: { fontSize: 11, color: colors.niebla, marginTop: 12 },
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
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  fenologiaBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  fenologiaFuente: { fontSize: 13, color: colors.ink60, marginBottom: 6 },
  fenologiaTarea: { fontSize: 12, color: colors.ink60, lineHeight: 17 },
  fenologiaContador: { fontSize: 10, color: colors.niebla, marginTop: 6, textAlign: 'right' },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 12,
  },
})
