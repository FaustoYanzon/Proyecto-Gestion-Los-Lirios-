import { useEffect } from 'react'
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
