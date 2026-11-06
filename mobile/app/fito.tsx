// Pestaña Fito: ya no se cargan aplicaciones libres desde el celular -- cada
// aplicación nace de una orden armada en la web (Producción → Órdenes de
// Aplicación) que el operario confirma acá. Abajo queda el historial reciente
// de lo aplicado en la campaña (agrupado por orden/parcela/válvula), de solo lectura (las correcciones se hacen en la web).
import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native'
import { ICONS, ICON_STROKE } from '../lib/icons'
import api, { getRegistrosCampania, getOrdenesCampania } from '../lib/api'
import { getCache, setCache, CACHE_TTL } from '../lib/cache'
import { OfflineQueueBanner } from '../components/OfflineQueueBanner'
import OrdenesPendientes from '../components/OrdenesPendientes'
import AplicacionesAgrupadas from '../components/AplicacionesAgrupadas'
import EmptyState from '../components/ui/EmptyState'
import { useAuthStore } from '../store/authStore'
import { hoyLocalISO } from '../lib/fitosanitariosAgrupar'
import { colors } from '../lib/theme'
import type { OrdenAplicacion, Parcela, RegistroFitosanitario } from '../lib/types'

// Campaign runs May -> April, so Jan-Apr still belong to the previous year's.
function temporadaActual(now: Date = new Date()): number {
  return now.getMonth() + 1 >= 5 ? now.getFullYear() : now.getFullYear() - 1
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FitoScreen() {
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [registros, setRegistros] = useState<RegistroFitosanitario[]>([])
  const [ordenes, setOrdenes] = useState<OrdenAplicacion[]>([])
  const [sinPermiso, setSinPermiso] = useState(false)
  const role = useAuthStore((s) => s.user?.role)
  // Same roles as the Deshacer check: below encargado the backend refuses the list.
  const esEncargado = role === 'super_admin' || role === 'gerencial' || role === 'encargado'
  const [loadingRegistros, setLoadingRegistros] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // Cambia en cada pull-to-refresh para que OrdenesPendientes recargue también.
  const [refreshKey, setRefreshKey] = useState(0)
  const [tab, setTab] = useState<'pendientes' | 'realizadas'>('pendientes')

  const loadParcelas = useCallback(async () => {
    const cached = await getCache<Parcela[]>('parcelas', CACHE_TTL.parcelas)
    if (cached) { setParcelas(cached); return }
    try {
      const { data } = await api.get<Parcela[]>('/parcelas/mapa')
      setParcelas(data.filter((p) => p.is_active))
    } catch { /* offline */ }
  }, [])

  const loadRegistros = useCallback(async () => {
    if (!esEncargado) { setLoadingRegistros(false); setRefreshing(false); return }
    const temporada = temporadaActual()
    const cacheKey = `fitosanitarios:${temporada}`
    const cacheKeyOrdenes = `ordenes-campania:${temporada}`
    const [cachedReg, cachedOrd] = await Promise.all([
      getCache<RegistroFitosanitario[]>(cacheKey, CACHE_TTL.fitosanitarios),
      getCache<OrdenAplicacion[]>(cacheKeyOrdenes, CACHE_TTL.fitosanitarios),
    ])
    if (cachedReg && cachedOrd) { setRegistros(cachedReg); setOrdenes(cachedOrd); setLoadingRegistros(false) }
    try {
      const [regs, ords] = await Promise.all([
        getRegistrosCampania(temporada),
        getOrdenesCampania(temporada),
      ])
      setRegistros(regs)
      setOrdenes(ords)
      setSinPermiso(false)
      await Promise.all([setCache(cacheKey, regs), setCache(cacheKeyOrdenes, ords)])
    } catch (e) {
      // A network error keeps whatever is on screen (stale cache); only a 403 is shown.
      if ((e as { response?: { status?: number } })?.response?.status === 403) setSinPermiso(true)
    } finally { setLoadingRegistros(false); setRefreshing(false) }
  }, [esEncargado])

  useEffect(() => {
    loadParcelas(); loadRegistros()
  }, [loadParcelas, loadRegistros])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  function onRefresh() { setRefreshing(true); setRefreshKey((k) => k + 1); loadRegistros() }

  return (
    <View style={{ flex: 1 }}>
      {toast && (
        <View style={styles.toast} pointerEvents="none">
          <ICONS.completado size={18} color={colors.blanco} strokeWidth={ICON_STROKE} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tierra} />
        }
      >
        <View style={styles.segment}>
          {([['pendientes', 'Pendientes'], ['realizadas', 'Realizadas']] as const).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.segmentBtn, tab === key && styles.segmentBtnActive]}
              onPress={() => setTab(key)}
              activeOpacity={0.75}
            >
              <Text style={[styles.segmentText, tab === key && styles.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <OfflineQueueBanner />

        {tab === 'pendientes' ? (
          <OrdenesPendientes
            key={refreshKey}
            onConfirmado={() => { loadRegistros(); setToast('Aplicación confirmada ✓') }}
          />
        ) : !esEncargado || sinPermiso ? (
          <EmptyState icon="candado" title="Esta vista es para encargados." />
        ) : loadingRegistros ? (
          <ActivityIndicator color={colors.tierra} style={{ marginTop: 24 }} />
        ) : (
          <AplicacionesAgrupadas
            registros={registros}
            ordenes={ordenes}
            parcelas={parcelas}
            hoy={hoyLocalISO()}
          />
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },

  // segmented tabs
  segment: {
    flexDirection: 'row', backgroundColor: colors.blanco, borderRadius: 12,
    padding: 4, marginBottom: 16, borderWidth: 1, borderColor: colors.borde,
  },
  segmentBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: colors.tierra },
  segmentText: { fontSize: 14, fontWeight: '700', color: colors.ink60 },
  segmentTextActive: { color: colors.blanco },

  // toast
  toast: {
    position: 'absolute', top: 16, left: 20, right: 20, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.tierra, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 16,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
  },
  toastText: { color: colors.blanco, fontSize: 14, fontWeight: '700' },
})
