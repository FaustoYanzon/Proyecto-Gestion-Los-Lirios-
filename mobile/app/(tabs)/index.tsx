import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuthStore } from '../../store/authStore'
import api from '../../lib/api'
import { colors, fonts } from '../../lib/theme'
import type { RegistroTrabajo } from '../../lib/types'

function isoToday() { return new Date().toISOString().split('T')[0] }

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

export default function InicioScreen() {
  const user = useAuthStore((s) => s.user)
  const router = useRouter()
  const [registros, setRegistros] = useState<RegistroTrabajo[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [offline, setOffline] = useState(false)

  const loadRegistros = useCallback(async () => {
    const today = isoToday()
    try {
      setOffline(false)
      const { data } = await api.get<RegistroTrabajo[]>(
        `/produccion/trabajo/?fecha_desde=${today}&fecha_hasta=${today}&limit=3`,
      )
      setRegistros(data)
    } catch {
      setOffline(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { loadRegistros() }, [loadRegistros])

  function onRefresh() { setRefreshing(true); loadRegistros() }

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
      {offline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#92400e" />
          <Text style={styles.offlineText}>Sin conexión</Text>
        </View>
      )}

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

      {/* ── 3 action buttons ── */}
      <View style={styles.actionsGrid}>
        <ActionButton
          label="Registrar tarea"
          icon="clipboard-outline"
          bg={colors.burdeos[600]}
          onPress={() => router.push('/(tabs)/tareas')}
        />
        <ActionButton
          label="Registrar riego"
          icon="water-outline"
          bg={colors.cielo}
          onPress={() => router.push('/(tabs)/riego')}
        />
        <ActionButton
          label="Aplicación fito"
          icon="flask-outline"
          bg={colors.verdeCampo}
          onPress={() => router.push('/fito')}
        />
        <ActionButton
          label="Registrar cosecha"
          icon="basket-outline"
          bg="#16a34a"
          onPress={() => router.push('/(tabs)/cosecha')}
        />
      </View>

      {/* ── Climate mini ── */}
      <ClimateCardMini />

      {/* ── Hoy ya registraste ── */}
      <Text style={styles.sectionLabel}>HOY YA REGISTRASTE</Text>
      {loading ? (
        <ActivityIndicator color={colors.burdeos[600]} style={{ marginTop: 16 }} />
      ) : registros.length === 0 ? (
        <Text style={styles.emptyText}>Sin registros hoy todavía</Text>
      ) : (
        registros.map((r) => (
          <View key={r.id} style={styles.registroRow}>
            <View style={styles.registroDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.registroNombre}>{r.trabajador_nombre}</Text>
              <Text style={styles.registroSub}>{r.tarea}</Text>
            </View>
            <Text style={styles.registroMonto}>
              {Number(r.monto_total).toLocaleString('es-AR', {
                style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
              })}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  content: { padding: 16, paddingBottom: 32 },
  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fef3c7', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    marginBottom: 14, borderWidth: 1, borderColor: '#fbbf24',
  },
  offlineText: { color: '#92400e', fontSize: 13, fontWeight: '500' },
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
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.crema, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    marginBottom: 24,
    borderWidth: 1, borderColor: colors.hueso,
  },
  climateTemp: { fontSize: 15, fontWeight: '700', color: colors.ink },
  climateSub: { fontSize: 12, color: colors.niebla, marginTop: 1 },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 12,
  },
  emptyText: { fontSize: 14, color: colors.niebla, fontStyle: 'italic' },
  registroRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.blanco, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  registroDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.burdeos[600], flexShrink: 0,
  },
  registroNombre: { fontSize: 14, fontWeight: '600', color: colors.ink },
  registroSub: { fontSize: 12, color: colors.ink60, marginTop: 1 },
  registroMonto: { fontSize: 13, fontWeight: '700', color: colors.burdeos[600] },
})
