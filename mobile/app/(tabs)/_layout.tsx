import { View } from 'react-native'
import { Tabs } from 'expo-router'
import { colors } from '../../lib/theme'
import { ICONS, ICON_SIZE, ICON_STROKE } from '../../lib/icons'
import { UserBadge } from '../../components/UserBadge'
import { SyncBar } from '../../components/SyncBar'

// Altura del header nativo actual (headerStyle.height más abajo) — la
// barra se ancla justo debajo. Si el header cambia de alto (Fase 7:
// header blanco propio, ~41px) hay que actualizar este número.
const HEADER_HEIGHT = 64

export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.burdeos[600],
        tabBarInactiveTintColor: colors.ink60,
        tabBarStyle: {
          borderTopColor: colors.hueso,
          borderTopWidth: 1,
          backgroundColor: colors.blanco,
          shadowColor: colors.ink,
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
          elevation: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginBottom: 2 },
        headerStyle: { backgroundColor: colors.burdeos[600], height: 64 },
        headerTintColor: colors.blanco,
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
        headerShadowVisible: false,
        headerRight: () => <UserBadge />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => (
            <ICONS.inicio size={ICON_SIZE.tab} color={color} strokeWidth={ICON_STROKE} />
          ),
        }}
      />
      <Tabs.Screen
        name="mapa"
        options={{
          title: 'Mapa',
          tabBarIcon: ({ color }) => (
            <ICONS.mapa size={ICON_SIZE.tab} color={color} strokeWidth={ICON_STROKE} />
          ),
        }}
      />
      <Tabs.Screen
        name="tareas"
        options={{
          title: 'Tareas',
          tabBarIcon: ({ color }) => (
            <ICONS.tarea size={ICON_SIZE.tab} color={color} strokeWidth={ICON_STROKE} />
          ),
        }}
      />
      <Tabs.Screen
        name="riego"
        options={{
          title: 'Riego',
          tabBarIcon: ({ color }) => (
            <ICONS.riego size={ICON_SIZE.tab} color={color} strokeWidth={ICON_STROKE} />
          ),
        }}
      />
      <Tabs.Screen
        name="fitosanitario"
        options={{
          title: 'Fito',
          tabBarIcon: ({ color }) => (
            <ICONS.fitosanitario size={ICON_SIZE.tab} color={color} strokeWidth={ICON_STROKE} />
          ),
        }}
      />
      <Tabs.Screen
        name="cosecha"
        options={{
          title: 'Cosecha',
          tabBarIcon: ({ color }) => (
            <ICONS.cosecha size={ICON_SIZE.tab} color={color} strokeWidth={ICON_STROKE} />
          ),
        }}
      />
      <Tabs.Screen name="campana" options={{ href: null }} />
      <Tabs.Screen name="perfil"  options={{ href: null }} />
    </Tabs>
    <SyncBar style={{ position: 'absolute', top: HEADER_HEIGHT, left: 0, right: 0, zIndex: 10 }} />
    </View>
  )
}
