// Maquinaria: fleet of the active finca (semaforo) and open orders. Read-mostly
// screen; cached so it opens without signal. Encargado and above only.
import { useCallback, useRef, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, StyleSheet,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ICONS, ICON_STROKE } from '../../lib/icons'
import { colors } from '../../lib/theme'
import { useAuthStore } from '../../store/authStore'
import { useFincaStore } from '../../store/fincaStore'
import EmptyState from '../../components/ui/EmptyState'
import { OfflineQueueBanner } from '../../components/OfflineQueueBanner'
import {
  puedeVerMaquinaria, errorDetail, TIPO_MAQUINA_LABELS, ESTADO_MAQUINA_LABELS,
  ESTADO_ORDEN_LABELS, GRAVEDAD_FALLA_LABELS, ESTADO_MAQUINA_SEMAFORO,
  type MaquinaResponse, type OrdenResponse, type FincaMaquinaria,
} from '../../lib/maquinaria'
import {
  SEMAFORO_COLORS, COLOR_REPORTAR, colorEstadoOrden, fmtFechaHora, nombreMaquina,
  readFlotaCache, fetchFlota, readOrdenesCache, fetchOrdenesAbiertas,
} from '../../lib/maquinariaUi'

type Seccion = 'flota' | 'ordenes'

export default function MaquinariaIndexScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const role = useAuthStore((s) => s.user?.role)
  const finca = useFincaStore((s) => s.active)
  const fincaKey = finca.key as FincaMaquinaria

  const [seccion, setSeccion] = useState<Seccion>('flota')
  const [maquinas, setMaquinas] = useState<MaquinaResponse[]>([])
  const [ordenes, setOrdenes] = useState<OrdenResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Avoids a slow response for a previous finca overwriting the current one.
  const reqId = useRef(0)

  const load = useCallback(async () => {
    const id = ++reqId.current
    const [cm, co] = await Promise.all([readFlotaCache(fincaKey), readOrdenesCache(fincaKey)])
    if (id !== reqId.current) return
    if (cm) setMaquinas(cm)
    if (co) setOrdenes(co)
    if (cm || co) setLoading(false)
    try {
      const [m, o] = await Promise.all([fetchFlota(fincaKey), fetchOrdenesAbiertas(fincaKey)])
      if (id !== reqId.current) return
      setMaquinas(m)
      setOrdenes(o)
      setError(null)
    } catch (e) {
      if (id !== reqId.current) return
      setError(errorDetail(e, 'No se pudo actualizar la lista'))
    } finally {
      if (id === reqId.current) { setLoading(false); setRefreshing(false) }
    }
  }, [fincaKey])

  // Refetch on every focus so returning from a report/detail shows fresh data.
  useFocusEffect(useCallback(() => { load() }, [load]))

  if (!puedeVerMaquinaria(role)) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No tenés acceso a esta sección</Text>
      </View>
    )
  }

  const hayDatos = maquinas.length > 0 || ordenes.length > 0
  const tabs: [Seccion, string][] = [
    ['flota', `Flota (${maquinas.length})`],
    ['ordenes', `Órdenes abiertas (${ordenes.length})`],
  ]

  return (
    <View style={styles.container}>
      <View style={styles.segment}>
        {tabs.map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.segBtn, seccion === key && styles.segBtnActive]}
            onPress={() => setSeccion(key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segText, seccion === key && styles.segTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 96 + insets.bottom }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load() }}
            tintColor={colors.burdeos[600]}
          />
        }
      >
        <OfflineQueueBanner />
        <Text style={styles.fincaLabel}>{finca.label}</Text>

        {error && hayDatos && (
          <View style={styles.warn}>
            <ICONS.desconectado size={14} color="#8a6a1f" strokeWidth={ICON_STROKE} />
            <Text style={styles.warnText}>Mostrando datos guardados. {error}</Text>
          </View>
        )}

        {loading && !hayDatos ? (
          <ActivityIndicator color={colors.burdeos[600]} style={{ marginTop: 40 }} />
        ) : error && !hayDatos ? (
          <EmptyState
            icon="desconectado"
            title="No se pudo cargar"
            description={error}
            action={
              <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load() }}>
                <Text style={styles.retryText}>Reintentar</Text>
              </TouchableOpacity>
            }
          />
        ) : seccion === 'flota' ? (
          maquinas.length === 0 ? (
            <EmptyState icon="tractor" title="Sin máquinas" description={`No hay máquinas cargadas en ${finca.label}.`} />
          ) : (
            maquinas.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => router.push({ pathname: '/maquinaria/reportar', params: { maquinaId: m.id } })}
                accessibilityLabel={`${nombreMaquina(m)}, ${ESTADO_MAQUINA_LABELS[m.estado]}. Reportar falla`}
              >
                <View style={[styles.dot, { backgroundColor: SEMAFORO_COLORS[ESTADO_MAQUINA_SEMAFORO[m.estado]] }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{nombreMaquina(m)}</Text>
                  <Text style={styles.cardSub}>
                    {TIPO_MAQUINA_LABELS[m.tipo]}{m.patente_serie ? ` · ${m.patente_serie}` : ''}
                  </Text>
                  <Text style={styles.cardSub}>
                    {ESTADO_MAQUINA_LABELS[m.estado]}
                    {m.ordenes_abiertas > 0
                      ? ` · ${m.ordenes_abiertas} ${m.ordenes_abiertas === 1 ? 'orden abierta' : 'órdenes abiertas'}`
                      : ''}
                  </Text>
                </View>
                <ICONS.avance size={18} color={colors.niebla} strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
            ))
          )
        ) : ordenes.length === 0 ? (
          <EmptyState icon="completado" title="Sin órdenes abiertas" description="No hay fallas pendientes de resolver." />
        ) : (
          ordenes.map((o) => (
            <TouchableOpacity
              key={o.id}
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => router.push(`/maquinaria/orden/${o.id}`)}
            >
              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.cardTitle, { flex: 1 }]} numberOfLines={1}>{nombreMaquina(o.maquina)}</Text>
                  <View style={[styles.chip, { backgroundColor: colorEstadoOrden(o.estado) }]}>
                    <Text style={styles.chipText}>{ESTADO_ORDEN_LABELS[o.estado]}</Text>
                  </View>
                </View>
                <Text style={styles.cardSub} numberOfLines={2}>{o.descripcion}</Text>
                <Text style={styles.cardMeta}>
                  {GRAVEDAD_FALLA_LABELS[o.gravedad]} · {fmtFechaHora(o.created_at)}
                </Text>
              </View>
              <ICONS.avance size={18} color={colors.niebla} strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: 12 + insets.bottom }]}>
        <TouchableOpacity
          style={styles.reportBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/maquinaria/reportar')}
        >
          <ICONS.alerta size={20} color={colors.blanco} strokeWidth={ICON_STROKE} />
          <Text style={styles.reportText}>Reportar falla</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.hueso, padding: 24 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  content: { padding: 16, gap: 10 },
  segment: {
    flexDirection: 'row', margin: 16, marginBottom: 0, padding: 4, gap: 4,
    backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.borde,
  },
  segBtn: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segBtnActive: { backgroundColor: colors.burdeos[600] },
  segText: { fontSize: 13, fontWeight: '700', color: colors.ink60 },
  segTextActive: { color: colors.blanco },
  fincaLabel: { fontSize: 11, fontWeight: '700', color: colors.niebla, letterSpacing: 0.8, textTransform: 'uppercase' },
  warn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 10, backgroundColor: '#f7edd8',
  },
  warnText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#8a6a1f' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64,
    backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.borde,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  cardSub: { fontSize: 13, color: colors.ink60 },
  cardMeta: { fontSize: 11, color: colors.niebla },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 10, fontWeight: '800', color: colors.blanco },
  retryBtn: {
    minHeight: 44, paddingHorizontal: 20, borderRadius: 10, backgroundColor: colors.burdeos[600],
    alignItems: 'center', justifyContent: 'center',
  },
  retryText: { color: colors.blanco, fontWeight: '700' },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: colors.hueso, borderTopWidth: 1, borderTopColor: colors.borde,
  },
  reportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    minHeight: 52, borderRadius: 14, backgroundColor: COLOR_REPORTAR,
  },
  reportText: { color: colors.blanco, fontSize: 16, fontWeight: '700' },
})
