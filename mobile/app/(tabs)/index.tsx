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
  potrero: '#2563eb',
  pasero: '#ea580c',
  cabezal: '#0891b2',
}

const TIPO_LABELS: Record<TipoParcela, string> = {
  parral: 'Parrales',
  potrero: 'Potreros',
  pasero: 'Paseros',
  cabezal: 'Cabezales',
}

const TIPO_ORDER: TipoParcela[] = ['parral', 'potrero', 'pasero', 'cabezal']

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  gerencial: 'Gerencial',
  encargado: 'Encargado',
  regador: 'Regador',
  obrero: 'Obrero',
}

export default function InicioScreen() {
  const user = useAuthStore((s) => s.user)
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

  useEffect(() => { loadData() }, [loadData])

  const onRefresh = useCallback(() => { setRefreshing(true); loadData() }, [loadData])

  const parcelasPorTipo = TIPO_ORDER.reduce<Record<TipoParcela, Parcela[]>>(
    (acc, tipo) => { acc[tipo] = parcelas.filter((p) => p.tipo === tipo); return acc },
    { parral: [], potrero: [], pasero: [], cabezal: [] }
  )

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Buenos días'
    if (h < 18) return 'Buenas tardes'
    return 'Buenas noches'
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
    >
      {offline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#92400e" />
          <Text style={styles.offlineText}>Sin conexión — datos no disponibles</Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>{greeting()},</Text>
          <Text style={styles.userName}>{user?.full_name?.split(' ')[0] ?? '—'}</Text>
        </View>
        <View style={[styles.rolePill, { backgroundColor: '#f0fdf4' }]}>
          <Text style={[styles.rolePillText, { color: '#166534' }]}>
            {ROLE_LABELS[user?.role ?? ''] ?? user?.role}
          </Text>
        </View>
      </View>

      {/* KPI Cards */}
      {loading ? (
        <ActivityIndicator color="#16a34a" style={{ marginVertical: 24 }} />
      ) : (
        <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#f0fdf4' }]}>
              <Ionicons name="grid-outline" size={18} color="#16a34a" />
            </View>
            <Text style={[styles.kpiValue, { color: '#16a34a' }]}>{parcelas.length}</Text>
            <Text style={styles.kpiLabel}>Parcelas activas</Text>
          </View>

          <View style={styles.kpiCard}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#eff6ff' }]}>
              <Ionicons name="clipboard-outline" size={18} color="#2563eb" />
            </View>
            <Text style={[styles.kpiValue, { color: '#2563eb' }]}>{tareasHoy.length}</Text>
            <Text style={styles.kpiLabel}>Registros hoy</Text>
          </View>

          <View style={styles.kpiCard}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#f0f9ff' }]}>
              <Ionicons name="water-outline" size={18} color="#0891b2" />
            </View>
            <Text style={[styles.kpiValue, { color: '#0891b2', fontSize: 15 }]}>
              {ultimoRiego ? ultimoRiego.fecha : '—'}
            </Text>
            <Text style={styles.kpiLabel}>Último riego</Text>
          </View>
        </View>
      )}

      {/* Quick actions */}
      <View style={styles.quickRow}>
        <TouchableOpacity
          style={[styles.quickBtn, { backgroundColor: '#16a34a' }]}
          onPress={() => router.push('/estado-campana')}
          activeOpacity={0.85}
        >
          <Ionicons name="leaf-outline" size={17} color="#fff" />
          <Text style={styles.quickBtnText}>Estado Fenológico</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.quickBtn, { backgroundColor: '#2563eb' }]}
          onPress={() => router.push('/(tabs)/mapa')}
          activeOpacity={0.85}
        >
          <Ionicons name="map-outline" size={17} color="#fff" />
          <Text style={styles.quickBtnText}>Ver Mapa</Text>
        </TouchableOpacity>
      </View>

      {/* Parcelas accordion */}
      {!loading && (
        <View>
          <Text style={styles.sectionLabel}>PARCELAS</Text>
          {TIPO_ORDER.filter((tipo) => parcelasPorTipo[tipo].length > 0).map((tipo) => {
            const isOpen = expandedTipo === tipo
            const grupo = parcelasPorTipo[tipo]
            const color = TIPO_COLORS[tipo]
            return (
              <View key={tipo} style={styles.acordeonCard}>
                <TouchableOpacity
                  style={styles.acordeonHeader}
                  onPress={() => setExpandedTipo(isOpen ? null : tipo)}
                  activeOpacity={0.7}
                >
                  <View style={styles.acordeonLeft}>
                    <View style={[styles.tipoDot, { backgroundColor: color }]} />
                    <Text style={styles.acordeonTitle}>{TIPO_LABELS[tipo]}</Text>
                    <View style={[styles.countBadge, { backgroundColor: `${color}18` }]}>
                      <Text style={[styles.countText, { color }]}>{grupo.length}</Text>
                    </View>
                  </View>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#9ca3af" />
                </TouchableOpacity>

                {isOpen && (
                  <View style={styles.acordeonBody}>
                    {grupo.map((p, idx) => (
                      <View
                        key={p.id}
                        style={[styles.parcelaRow, idx < grupo.length - 1 && styles.parcelaRowBorder]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.parcelaNombre}>{p.nombre}</Text>
                          {p.variedad && (
                            <Text style={styles.parcelaSub}>{p.variedad.replace('_', ' ')}</Text>
                          )}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          {p.superficie_ha != null && (
                            <Text style={styles.parcelaHa}>{p.superficie_ha.toFixed(2)} ha</Text>
                          )}
                          {p.cabezal_riego && p.cabezal_riego !== 'MANTO' && (
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
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  content: { padding: 16, paddingBottom: 32 },
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fef3c7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    marginBottom: 14, borderWidth: 1, borderColor: '#fbbf24',
  },
  offlineText: { color: '#92400e', fontSize: 13, fontWeight: '500' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  greeting: { fontSize: 14, color: '#6b7280', fontWeight: '500' },
  userName: { fontSize: 24, fontWeight: '800', color: '#111827' },
  rolePill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  rolePillText: { fontSize: 12, fontWeight: '700' },
  kpiGrid: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  kpiCard: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  kpiIconBox: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  kpiValue: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 2 },
  kpiLabel: { fontSize: 10, color: '#9ca3af', fontWeight: '600', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.3 },
  quickRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  quickBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, borderRadius: 12, paddingVertical: 13,
    shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 3,
  },
  quickBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  acordeonCard: {
    backgroundColor: '#fff', borderRadius: 14, marginBottom: 8, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  acordeonHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 14,
  },
  acordeonLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tipoDot: { width: 10, height: 10, borderRadius: 5 },
  acordeonTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  countText: { fontSize: 12, fontWeight: '800' },
  acordeonBody: { borderTopWidth: 1, borderTopColor: '#f4f6f8' },
  parcelaRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  parcelaRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f4f6f8' },
  parcelaNombre: { fontSize: 14, fontWeight: '600', color: '#111827' },
  parcelaSub: { fontSize: 12, color: '#6b7280', marginTop: 1, textTransform: 'capitalize' },
  parcelaHa: { fontSize: 13, color: '#374151', fontWeight: '700' },
  parcelaCabezal: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
})
