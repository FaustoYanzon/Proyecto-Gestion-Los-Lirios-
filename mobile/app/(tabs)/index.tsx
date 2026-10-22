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
import api from '../../lib/api'
import { getCache, setCache, CACHE_TTL } from '../../lib/cache'
import { advanceRotation } from '../../lib/rotation'
import { colors, fonts, FINCA_COORDS, fenologiaColors, withAlpha } from '../../lib/theme'
import type { FaseVariedad } from '../../lib/types'
import { VARIEDAD_LABELS } from '../../lib/types'

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

// Color de fondo de la tarjeta según el cielo (espejo de weatherTheme en
// frontend/lib/weather.ts, sin degradé: expo-linear-gradient exigiría build).
function weatherBgMini(code: number): string {
  if (code === 0) return '#d9822b'
  if (code <= 2) return '#3d86b0'
  if (code === 3) return '#5f7383'
  if (code <= 49) return '#6f7f8a'
  if (code <= 69 || code === 80 || code === 81 || code === 82) return '#2a6190'
  if (code <= 99) return '#44447a'
  return colors.cielo
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
    return <View style={[styles.climateCard, { height: 150, backgroundColor: colors.cielo, borderColor: colors.cielo, opacity: 0.4 }]} />
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

  const bg = weatherBgMini(clima.current.weather_code)

  return (
    <View style={[styles.climateCard, { backgroundColor: bg, borderColor: bg }]}>
      <View style={styles.climateHeader}>
        <Text style={styles.climateHeaderText}>
          CLIMA — {(FINCA_COORDS[finca as keyof typeof FINCA_COORDS]?.label ?? finca).toUpperCase()}
        </Text>
        <Text style={styles.climateUpdated}>
          {clima._cached ? 'hace <30 min' : 'ahora'}
        </Text>
      </View>

      <View style={styles.climateBigRow}>
        <WeatherIcon size={44} color={colors.blanco} strokeWidth={1.5} />
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
          <ICONS.viento size={15} color={colors.blanco} strokeWidth={ICON_STROKE} />
          <Text style={styles.climateStatValue}>{wind} km/h</Text>
          <Text style={styles.climateStatLabel}>{windDir}</Text>
        </View>
        <View style={styles.climateStatCol}>
          <ICONS.humedad size={15} color={colors.blanco} strokeWidth={ICON_STROKE} />
          <Text style={styles.climateStatValue}>{humidity}%</Text>
          <Text style={styles.climateStatLabel}>Humedad</Text>
        </View>
        <View style={styles.climateStatCol}>
          <ICONS.uv size={15} color={colors.blanco} strokeWidth={ICON_STROKE} />
          <Text style={styles.climateStatValue}>UV {uv}</Text>
          <Text style={styles.climateStatLabel}>{uvInfo?.label}</Text>
        </View>
      </View>
    </View>
  )
}

// ── Pronóstico 5 días (espejo de PronosticoCard en la web) ──
interface PronosticoMini {
  daily: {
    time: string[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_sum: number[]
    precipitation_probability_max: number[]
    wind_speed_10m_max: number[]
    weather_code: number[]
  }
}

const DIAS_PRONOSTICO = 5

function fmtDiaMini(iso: string, idx: number): string {
  if (idx === 0) return 'Hoy'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '')
}

// Lo más grave de los próximos días. Umbrales orientativos: helada ≤ 2 °C de
// mínima, viento ≥ 40 km/h, códigos WMO 96/99 = tormenta con granizo.
function alertaPronosticoMini(d: PronosticoMini['daily']): { texto: string; grave: boolean } | null {
  const n = Math.min(DIAS_PRONOSTICO, d.time.length)
  const cuando = (i: number) => (i === 0 ? 'hoy' : i === 1 ? 'mañana' : fmtDiaMini(d.time[i], i))
  for (let i = 0; i < n; i++) {
    if (d.weather_code[i] === 96 || d.weather_code[i] === 99) return { texto: `Riesgo de granizo ${cuando(i)}`, grave: true }
    if (d.temperature_2m_min[i] <= 2) return { texto: `Posible helada ${cuando(i)} (mín ${Math.round(d.temperature_2m_min[i])}°)`, grave: true }
  }
  for (let i = 0; i < n; i++) {
    if (d.wind_speed_10m_max[i] >= 40) return { texto: `Viento fuerte ${cuando(i)} (${Math.round(d.wind_speed_10m_max[i])} km/h)`, grave: false }
  }
  const lluvia = d.precipitation_sum.slice(0, n).findIndex((v) => v >= 5)
  if (lluvia >= 0) return { texto: `Lluvia ${cuando(lluvia)} (${d.precipitation_sum[lluvia].toFixed(0)} mm)`, grave: false }
  return null
}

function PronosticoCardMini() {
  const finca = useFincaStore((s) => s.active.key)
  const [data, setData] = useState<PronosticoMini | null>(null)

  useEffect(() => {
    (async () => {
      const cached = await getCache<PronosticoMini>('clima_pronostico', CACHE_TTL.clima)
      if (cached) setData(cached)
      try {
        const { data: fresh } = await api.get<PronosticoMini>('/clima/pronostico-extendido', { params: { finca } })
        setData(fresh)
        await setCache('clima_pronostico', fresh)
      } catch { /* usa lo cacheado si existe, si no queda oculto */ }
    })()
  }, [finca])

  // Un dato inventado es peor que ninguno: sin datos, no se muestra la tarjeta.
  if (!data) return null
  const d = data.daily
  const alerta = alertaPronosticoMini(d)
  const AlertIcon = ICONS[alerta?.grave ? 'alerta' : 'lluvia']

  return (
    <View style={styles.pronCard}>
      <Text style={styles.pronTitle}>PRÓXIMOS DÍAS</Text>
      {alerta && (
        <View style={[styles.pronAlert, alerta.grave ? styles.pronAlertGrave : styles.pronAlertInfo]}>
          <AlertIcon size={14} color={alerta.grave ? colors.sangre : colors.cielo} strokeWidth={ICON_STROKE} />
          <Text style={[styles.pronAlertText, { color: alerta.grave ? colors.sangre : colors.cielo }]}>{alerta.texto}</Text>
        </View>
      )}
      <View style={styles.pronRow}>
        {d.time.slice(0, DIAS_PRONOSTICO).map((dia, i) => {
          const Icon = ICONS[wmoIconNameMini(d.weather_code[i])]
          const prob = Math.round(d.precipitation_probability_max[i] ?? 0)
          return (
            <View key={dia} style={[styles.pronDay, i === 0 && styles.pronDayToday]}>
              <Text style={styles.pronDayName}>{fmtDiaMini(dia, i)}</Text>
              <Icon size={22} color={colors.cielo} strokeWidth={ICON_STROKE} />
              <Text style={styles.pronMax}>{Math.round(d.temperature_2m_max[i])}°</Text>
              <Text style={styles.pronMin}>{Math.round(d.temperature_2m_min[i])}°</Text>
              <Text style={styles.pronRain}>{prob > 0 ? `${prob}%` : ' '}</Text>
            </View>
          )
        })}
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

  useEffect(() => { loadFenologia() }, [loadFenologia])

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

  function onRefresh() { setRefreshing(true); loadFenologia() }

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

      {/* ── Climate mini ── */}
      <ClimateCardMini />

      {/* ── Pronóstico 5 días ── */}
      <PronosticoCardMini />

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

  climateCard: {
    borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 14,
    marginBottom: 24,
    borderWidth: 1,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 4,
  },
  climateHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
  },
  climateHeaderText: {
    fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.6,
  },
  climateBigRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  climateTemp: { fontSize: 40, fontWeight: '800', color: colors.blanco, lineHeight: 44 },
  climateDesc: { fontSize: 13, color: colors.blanco, fontWeight: '600', marginBottom: 2 },
  climateMaxMin: { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
  climateStatsRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  climateStatCol: {
    alignItems: 'center', gap: 3, flex: 1,
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 10, paddingVertical: 8,
  },
  climateStatValue: { fontSize: 13, fontWeight: '700', color: colors.blanco },
  climateStatLabel: { fontSize: 10, color: 'rgba(255,255,255,0.78)' },
  climateUpdated: { fontSize: 11, color: 'rgba(255,255,255,0.75)' },
  pronCard: {
    backgroundColor: colors.blanco, borderRadius: 16, padding: 14, marginBottom: 24,
    borderWidth: 1, borderColor: colors.borde,
  },
  pronTitle: { fontSize: 11, fontWeight: '700', color: colors.ink60, letterSpacing: 0.6, marginBottom: 10 },
  pronAlert: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 10,
  },
  pronAlertGrave: { backgroundColor: '#fbe9ec' },
  pronAlertInfo: { backgroundColor: '#e8f0f5' },
  pronAlertText: { fontSize: 12, fontWeight: '700', flex: 1 },
  pronRow: { flexDirection: 'row', gap: 6 },
  pronDay: {
    flex: 1, alignItems: 'center', gap: 3, paddingVertical: 8, borderRadius: 10,
    backgroundColor: colors.hueso,
  },
  pronDayToday: { backgroundColor: '#f3e9e1' },
  pronDayName: { fontSize: 11, fontWeight: '700', color: colors.ink60, textTransform: 'capitalize' },
  pronMax: { fontSize: 15, fontWeight: '800', color: colors.ink },
  pronMin: { fontSize: 12, color: colors.ink60 },
  pronRain: { fontSize: 10, color: colors.cielo, fontWeight: '600' },
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
