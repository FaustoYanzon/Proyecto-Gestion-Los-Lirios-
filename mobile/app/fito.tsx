// Pestaña Fito: ya no se cargan aplicaciones libres desde el celular -- cada
// aplicación nace de una orden armada en la web (Producción → Órdenes de
// Aplicación) que el operario confirma acá. Abajo queda el historial reciente
// de lo aplicado, de solo lectura (las correcciones se hacen en la web).
import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { ICONS, ICON_STROKE } from '../lib/icons'
import api from '../lib/api'
import { getCache, setCache, CACHE_TTL } from '../lib/cache'
import { OfflineQueueBanner } from '../components/OfflineQueueBanner'
import OrdenesPendientes from '../components/OrdenesPendientes'
import { colors } from '../lib/theme'
import type { Parcela, RegistroFitosanitario } from '../lib/types'

function formatDateDisplay(iso: string) {
  const [y, mo, d] = iso.split('-')
  return `${d}/${mo}/${y}`
}

// ─── Recent registros ─────────────────────────────────────────────────────────

function RecentList({
  registros, parcelas,
}: {
  registros: RegistroFitosanitario[]
  parcelas: Parcela[]
}) {
  if (registros.length === 0) {
    return (
      <View style={styles.emptyState}>
        <ICONS.fitosanitario size={36} color={colors.hueso} strokeWidth={ICON_STROKE} />
        <Text style={styles.emptyStateTitle}>Sin aplicaciones recientes</Text>
      </View>
    )
  }

  return (
    <View>
      <Text style={styles.sectionLabel}>APLICACIONES RECIENTES</Text>
      {registros.map((r) => {
        const parcela = parcelas.find((p) => p.id === r.parcela_id)
        return (
          <View key={r.id} style={styles.registroCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.registroNombre}>{r.producto_nombre}</Text>
              <Text style={styles.registroSub}>
                {parcela?.nombre ?? 'Sin parcela'} · {formatDateDisplay(r.fecha)}
              </Text>
              <Text style={styles.registroDetalle}>{r.motivo} · {r.dosis_por_ha} {r.unidad ?? ''}/ha</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FitoScreen() {
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [registros, setRegistros] = useState<RegistroFitosanitario[]>([])
  const [loadingRegistros, setLoadingRegistros] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // Cambia en cada pull-to-refresh para que OrdenesPendientes recargue también.
  const [refreshKey, setRefreshKey] = useState(0)

  const loadParcelas = useCallback(async () => {
    const cached = await getCache<Parcela[]>('parcelas', CACHE_TTL.parcelas)
    if (cached) { setParcelas(cached); return }
    try {
      const { data } = await api.get<Parcela[]>('/parcelas/mapa')
      setParcelas(data.filter((p) => p.is_active))
    } catch { /* offline */ }
  }, [])

  const loadRegistros = useCallback(async () => {
    const cached = await getCache<RegistroFitosanitario[]>('fitosanitarios', CACHE_TTL.fitosanitarios)
    if (cached) { setRegistros(cached); setLoadingRegistros(false) }
    try {
      const { data } = await api.get<RegistroFitosanitario[]>('/produccion/fitosanitarios/?limit=10')
      setRegistros(data)
      await setCache('fitosanitarios', data)
    } catch { /* offline */ }
    finally { setLoadingRegistros(false); setRefreshing(false) }
  }, [])

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
        <OrdenesPendientes
          key={refreshKey}
          onConfirmado={() => { loadRegistros(); setToast('Aplicación confirmada ✓') }}
        />

        <OfflineQueueBanner />

        {loadingRegistros ? (
          <ActivityIndicator color={colors.tierra} style={{ marginTop: 24 }} />
        ) : (
          <RecentList registros={registros} parcelas={parcelas} />
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },

  // recent
  registroCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.blanco, borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  registroNombre: { fontSize: 15, fontWeight: '700', color: colors.ink },
  registroSub: { fontSize: 12, color: colors.ink60, marginTop: 2 },
  registroDetalle: { fontSize: 12, color: colors.tierra, fontWeight: '600', marginTop: 5 },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyStateTitle: { fontSize: 15, fontWeight: '600', color: colors.ink60, marginTop: 12 },

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
