import { useEffect, useRef } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useFonts } from 'expo-font'
import {
  PublicSans_400Regular,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
} from '@expo-google-fonts/public-sans'
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces'
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono'
import * as SplashScreen from 'expo-splash-screen'
import { useAuthStore } from '../store/authStore'
import { registerForPushNotifications } from '../lib/notifications'
import { initOfflineSync } from '../lib/offlineSync'
import { puedeVerMaquinaria } from '../lib/maquinaria'
import { colors } from '../lib/theme'
import { ErrorBoundary } from '../components/ErrorBoundary'

SplashScreen.preventAutoHideAsync()

function AuthGuard() {
  const user = useAuthStore((s) => s.user)
  const isLoading = useAuthStore((s) => s.isLoading)
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return
    const inAuth = segments[0] === '(auth)'
    if (!user && !inAuth) {
      router.replace('/(auth)/login')
    } else if (user && inAuth) {
      router.replace('/(tabs)')
    }
  }, [user, isLoading, segments])

  return null
}

// Opens the order when the user taps a maquinaria push. Data keys come from
// backend services/maquinaria.py _notificar: { tipo: 'maquinaria_orden', orden_id, estado }.
// Other pushes are ignored. Navigation waits until the tabs are mounted so a
// cold start from a notification does not race the AuthGuard redirect.
function ordenIdFromResponse(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification.request.content.data as Record<string, unknown> | undefined
  if (!data || data.tipo !== 'maquinaria_orden') return null
  return typeof data.orden_id === 'string' && data.orden_id ? data.orden_id : null
}

function PushNavigator() {
  const user = useAuthStore((s) => s.user)
  const segments = useSegments()
  const router = useRouter()
  const pendingOrden = useRef<string | null>(null)
  const handled = useRef<Set<string>>(new Set())
  const readyRef = useRef(false)
  const flushRef = useRef<(() => void) | null>(null)

  const ready = !!user && segments[0] === '(tabs)'

  useEffect(() => {
    if (!user) return
    const consume = (response: Notifications.NotificationResponse | null) => {
      const ordenId = ordenIdFromResponse(response)
      const key = response?.notification.request.identifier
      if (!ordenId || !key || handled.current.has(key)) return
      handled.current.add(key)
      pendingOrden.current = ordenId
      flush()
    }
    function flush() {
      if (!readyRef.current || !pendingOrden.current) return
      const id = pendingOrden.current
      pendingOrden.current = null
      if (puedeVerMaquinaria(useAuthStore.getState().user?.role)) {
        router.push(`/maquinaria/orden/${id}`)
      }
    }
    flushRef.current = flush
    // App opened from a killed state by tapping the notification.
    consume(Notifications.getLastNotificationResponse())
    const sub = Notifications.addNotificationResponseReceivedListener(consume)
    return () => { sub.remove(); flushRef.current = null }
  }, [user, router])

  useEffect(() => {
    readyRef.current = ready
    if (ready) flushRef.current?.()
  }, [ready])

  return null
}

export default function RootLayout() {
  const initAuth = useAuthStore((s) => s.initAuth)
  const user = useAuthStore((s) => s.user)

  const [fontsLoaded] = useFonts({
    PublicSans_400Regular,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
    Fraunces_600SemiBold,
    JetBrainsMono_500Medium,
  })

  useEffect(() => { initAuth() }, [])

  useEffect(() => initOfflineSync(), [])

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync()
  }, [fontsLoaded])

  useEffect(() => {
    if (user) registerForPushNotifications()
  }, [user])

  if (!fontsLoaded) return null

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <AuthGuard />
        <PushNavigator />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="estado-campana"
            options={{
              headerShown: true,
              title: 'Estado Fenológico',
              headerStyle: { backgroundColor: colors.burdeos[600] },
              headerTintColor: colors.blanco,
              headerTitleStyle: { fontWeight: 'bold' },
            }}
          />
          <Stack.Screen
            name="fito"
            options={{
              headerShown: true,
              title: 'Aplicación Fitosanitaria',
              headerStyle: { backgroundColor: colors.burdeos[600] },
              headerTintColor: colors.blanco,
              headerTitleStyle: { fontWeight: 'bold' },
            }}
          />
          <Stack.Screen
            name="alta-produccion/pasero"
            options={{
              headerShown: true,
              title: 'Ingresos al pasero',
              headerStyle: { backgroundColor: colors.burdeos[600] },
              headerTintColor: colors.blanco,
              headerTitleStyle: { fontWeight: 'bold' },
            }}
          />
          <Stack.Screen
            name="alta-produccion/levantada"
            options={{
              headerShown: true,
              title: 'Levantar pasa',
              headerStyle: { backgroundColor: colors.burdeos[600] },
              headerTintColor: colors.blanco,
              headerTitleStyle: { fontWeight: 'bold' },
            }}
          />
          <Stack.Screen
            name="alta-produccion/lotes"
            options={{
              headerShown: true,
              title: 'Lotes de pasa',
              headerStyle: { backgroundColor: colors.burdeos[600] },
              headerTintColor: colors.blanco,
              headerTitleStyle: { fontWeight: 'bold' },
            }}
          />
          <Stack.Screen
            name="alta-produccion/entrega"
            options={{
              headerShown: true,
              title: 'Entregar pasa',
              headerStyle: { backgroundColor: colors.burdeos[600] },
              headerTintColor: colors.blanco,
              headerTitleStyle: { fontWeight: 'bold' },
            }}
          />
          <Stack.Screen
            name="maquinaria/index"
            options={{
              headerShown: true,
              title: 'Maquinaria',
              headerStyle: { backgroundColor: colors.burdeos[600] },
              headerTintColor: colors.blanco,
              headerTitleStyle: { fontWeight: 'bold' },
            }}
          />
          <Stack.Screen
            name="maquinaria/reportar"
            options={{
              headerShown: true,
              title: 'Reportar falla',
              headerStyle: { backgroundColor: colors.burdeos[600] },
              headerTintColor: colors.blanco,
              headerTitleStyle: { fontWeight: 'bold' },
            }}
          />
          <Stack.Screen
            name="maquinaria/orden/[id]"
            options={{
              headerShown: true,
              title: 'Orden de maquinaria',
              headerStyle: { backgroundColor: colors.burdeos[600] },
              headerTintColor: colors.blanco,
              headerTitleStyle: { fontWeight: 'bold' },
            }}
          />
        </Stack>
      </ErrorBoundary>
    </GestureHandlerRootView>
  )
}
