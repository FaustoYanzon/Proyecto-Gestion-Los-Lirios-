import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useAuthStore } from '../store/authStore'

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

  useEffect(() => {
    initAuth()
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthGuard />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="estado-campana"
          options={{
            headerShown: true,
            title: 'Estado Fenológico',
            headerStyle: { backgroundColor: '#16a34a' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: 'bold' },
          }}
        />
      </Stack>
    </GestureHandlerRootView>
  )
}
