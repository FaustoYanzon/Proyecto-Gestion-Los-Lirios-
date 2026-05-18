import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../../store/authStore'
import api from '../../lib/api'
import type { Parcela, RegistroTrabajo, RegistroRiego, TipoParcela } from '../../lib/types'

const TIPO_COLORS: Record<TipoParcela, string> = {
  parral: '#16a34a',
  potrero: '#ca8a04',
  pasero: '#ea580c',
  cabezal: '#2563eb',
}

const TIPO_BG: Record<TipoParcela, string> = {
  parral: '#f0fdf4',
  potrero: '#fefce8',
  pasero: '#fff7ed',
  cabezal: '#eff6ff',
}

const TIPO_LABELS: Record<TipoParcela, string> = {
  parral: 'Parrales',
  potrero: 'Potreros',
  pasero: 'Paseros',
  cabezal: 'Cabezales',
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  gerencial: 'Gerencial',
  encargado: 'Encargado',
  regador: 'Regador',
  obrero: 'Obrero',
}

const TIPO_ORDER: TipoParcela[] = ['parral', 'potrero', 'pasero', 'cabezal']

export default function InicioScreen() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const router = useRouter()

  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [tareasHoy, setTareasHoy] = useState<RegistroTrabajo[]>([])
  const [ultimoRiego, setUltimoRiego] = useState<RegistroRiego | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [offline, setOffline] = useState(false)
  const [expandedTipo, setExpandedTipo] = useState<TipoParcela | null>('parral')

  const loadData = useCallback(async () => {
    try {
      setOffline(false)
      const today = new Date().toISOString().split('T')[0]

      const [parcelasRes, trabajosRes, riegosRes] = await Promise.all([
        api.get<Parcela[]>('/parcelas/mapa'),
        api.get<RegistroTrabajo[]>(`/produccion/trabajo/?fecha_desde=${today}&fecha_hasta=${today}&limit=50`),
        api.get<RegistroRiego[]>('/produccion/riego/?limit=1'),
      ])

      setParcelas(parcelasRes.data.filter((p) => p.is_active))
      setTareasHoy(trabajosRes.data)
      setUltimoRiego(riegosRes.data[0] ?? null)
    } catch {
      setOffline(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    loadData()
  }, [loadData])

  async function handleLogout() {
    await logout()
    router.replace('/(auth)/login')
  }

  // Group parcelas by tipo
  const parcelasPorTipo = TIPO_ORDER.reduce<Record<TipoParcela, Parcela[]>>(
    (acc, tipo) => {
      acc[tipo] = parcelas.filter((p) => p.tipo === tipo)
      return acc
    },
    { parral: [], potrero: [], pasero: [], cabezal: [] }
  )

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
    >
      {offline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>Sin conexión — datos no disponibles</Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.welcome}>Bienvenido,</Text>
          <Text style={styles.userName}>{user?.full_name ?? '—'}</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{ROLE_LABELS[user?.role ?? ''] ?? user?.role}</Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>Salir</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* KPI Cards */}
      {loading ? (
        <ActivityIndicator color="#16a34a" style={{ marginVertical: 24 }} />
      ) : (
        <View style={styles.kpiRow}>
          <View style={[styles.kpiCard, { borderLeftColor: '#16a34a' }]}>
            <Text style={styles.kpiValue}>{parcelas.length}</Text>
            <Text style={styles.kpiLabel}>Parcelas activas</Text>
          </View>

          <View style={[styles.kpiCard, { borderLeftColor: '#2563eb' }]}>
            <Text style={[styles.kpiValue, { color: '#2563eb' }]}>{tareasHoy.length}</Text>
            <Text style={styles.kpiLabel}>Registros hoy</Text>
          </View>

          <View style={[styles.kpiCard, { borderLeftColor: '#0891b2' }]}>
            <Text style={[styles.kpiValue, { color: '#0891b2', fontSize: 14 }]}>
              {ultimoRiego ? ultimoRiego.fecha : '—'}
            </Text>
            <Text style={styles.kpiLabel}>Último riego</Text>
          </View>
        </View>
      )}

      {/* Acceso rápido */}
      <TouchableOpacity
        style={styles.campanaBtn}
        onPress={() => router.push('/estado-campana')}
        activeOpacity={0.8}
      >
        <Ionicons name="leaf-outline" size={18} color="#fff" />
        <Text style={styles.campanaBtnText}>Ver Estado Fenológico</Text>
      </TouchableOpacity>

      {/* Parcelas por tipo (acordeón) */}
      {!loading && (
        <View>
          <Text style={styles.sectionTitle}>Parcelas</Text>
          {TIPO_ORDER.filter((tipo) => parcelasPorTipo[tipo].length > 0).map((tipo) => {
            const isOpen = expandedTipo === tipo
            const grupo = parcelasPorTipo[tipo]
            return (
              <View key={tipo} style={styles.acordeonCard}>
                <TouchableOpacity
                  style={styles.acordeonHeader}
                  onPress={() => setExpandedTipo(isOpen ? null : tipo)}
                  activeOpacity={0.7}
                >
                  <View style={styles.acordeonLeft}>
                    <View style={[styles.tipoDot, { backgroundColor: TIPO_COLORS[tipo] }]} />
                    <Text style={styles.acordeonTitle}>{TIPO_LABELS[tipo]}</Text>
                    <View style={[styles.countBadge, { backgroundColor: TIPO_BG[tipo] }]}>
                      <Text style={[styles.countText, { color: TIPO_COLORS[tipo] }]}>{grupo.length}</Text>
                    </View>
                  </View>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#9ca3af"
                  />
                </TouchableOpacity>

                {isOpen && (
                  <View style={styles.acordeonBody}>
                    {grupo.map((p, idx) => (
                      <View
                        key={p.id}
                        style={[
                          styles.parcelaRow,
                          idx < grupo.length - 1 && styles.parcelaRowBorder,
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.parcelaNombre}>{p.nombre}</Text>
                          {p.variedad && (
                            <Text style={styles.parcelaSub}>Var: {p.variedad}</Text>
                          )}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          {p.superficie_ha != null && (
                            <Text style={styles.parcelaHa}>{p.superficie_ha.toFixed(2)} ha</Text>
                          )}
                          {p.cabezal_riego && (
                            <Text style={styles.parcelaCabezal}>Cab. {p.cabezal_riego}</Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )
          })}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 32 },
  offlineBanner: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fbbf24',
  },
  offlineText: { color: '#92400e', fontSize: 13, textAlign: 'center' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  welcome: { fontSize: 14, color: '#6b7280' },
  userName: { fontSize: 20, fontWeight: '700', color: '#111827' },
  headerRight: { alignItems: 'flex-end', gap: 6 },
  roleBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  roleText: { color: '#166534', fontSize: 12, fontWeight: '600' },
  logoutBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  logoutText: { color: '#6b7280', fontSize: 12 },
  kpiRow: { gap: 10, marginBottom: 16 },
  kpiCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  kpiValue: { fontSize: 24, fontWeight: '800', color: '#16a34a' },
  kpiLabel: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  campanaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingVertical: 14,
    marginBottom: 20,
  },
  campanaBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  acordeonCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  acordeonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  acordeonLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tipoDot: { width: 10, height: 10, borderRadius: 5 },
  acordeonTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  countText: { fontSize: 12, fontWeight: '700' },
  acordeonBody: { borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  parcelaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  parcelaRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  parcelaNombre: { fontSize: 14, fontWeight: '600', color: '#111827' },
  parcelaSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  parcelaHa: { fontSize: 13, color: '#374151', fontWeight: '600' },
  parcelaCabezal: { fontSize: 11, color: '#6b7280', marginTop: 2 },
})
