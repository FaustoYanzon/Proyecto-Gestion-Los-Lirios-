import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import api from './api'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export async function registerForPushNotifications(): Promise<void> {
  if (Platform.OS === 'web') return

  const { status: existing } = await Notifications.getPermissionsAsync()
  let finalStatus = existing

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') return

  const projectId = (Constants.expoConfig?.extra?.eas?.projectId as string | undefined)
  if (!projectId) return  // EAS project not configured yet

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    await api.post('/notificaciones/token', { token, platform: Platform.OS })
  } catch { /* non-critical — app works fine without push */ }
}
