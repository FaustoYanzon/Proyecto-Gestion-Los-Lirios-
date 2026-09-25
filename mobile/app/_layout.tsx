import { useEffect } from 'react'
import { Alert } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
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
import { colors } from '../lib/theme'
import { ErrorBoundary } from '../components/ErrorBoundary'

SplashScreen.preventAutoHideAsync()

// Diagnóstico (2026-09-24): un error JS fatal fuera del render (no lo atrapa
// el ErrorBoundary) cerraba la app al entrar a Fito, y el crash report de
// iOS no trae el mensaje. En vez de cerrar, mostramos el error en pantalla
// para poder leerlo. Los no fatales siguen por el handler normal.
const handlerOriginal = ErrorUtils.getGlobalHandler()
ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
  if (!isFatal) {
    handlerOriginal(error, isFatal)
    return
  }
  const detalle = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}\n\n${(error?.stack ?? '').slice(0, 900)}`
  Alert.alert('Error (mandale captura a Fausto)', detalle)
})

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
        </Stack>
      </ErrorBoundary>
    </GestureHandlerRootView>
  )
}
