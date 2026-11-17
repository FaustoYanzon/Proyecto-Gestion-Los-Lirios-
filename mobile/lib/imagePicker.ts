import { Alert, Linking, Platform } from 'react-native'

// expo-image-picker is loaded lazily on purpose: builds that predate the native
// module (or its camera plugin) throw "Cannot find native module
// 'ExponentImagePicker'" as soon as a screen imports it, which closed the app
// (Fito, 2026-09-24). Importing on tap lets us warn instead of crash.
type Opciones = { aspect?: [number, number] }
type Picker = typeof import('expo-image-picker')

async function cargarPicker(): Promise<Picker | null> {
  try {
    return await import('expo-image-picker')
  } catch {
    Alert.alert(
      'Fotos no disponibles',
      'Esta versión de la app todavía no permite adjuntar fotos. Va a estar disponible en la próxima actualización de la tienda.',
    )
    return null
  }
}

// After a denial iOS never asks again, so the only way out is the system settings.
function avisarPermisoDenegado(mensaje: string, canAskAgain: boolean) {
  const botones = canAskAgain
    ? [{ text: 'Entendido' }]
    : [{ text: 'Ahora no', style: 'cancel' as const }, { text: 'Abrir ajustes', onPress: () => { Linking.openSettings() } }]
  Alert.alert('Permiso requerido', mensaje, botones)
}

async function elegirDeGaleria(opciones: Opciones): Promise<string | null> {
  const ImagePicker = await cargarPicker()
  if (!ImagePicker) return null
  try {
    const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (permiso.status !== 'granted') {
      avisarPermisoDenegado('Se necesita acceso a la galería para adjuntar una foto.', permiso.canAskAgain)
      return null
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: opciones.aspect,
      quality: 0.7,
    })
    if (result.canceled || !result.assets[0]) return null
    return result.assets[0].uri
  } catch {
    Alert.alert('Galería no disponible', 'No se pudo abrir la galería.')
    return null
  }
}

async function tomarFoto(opciones: Opciones): Promise<string | null> {
  const ImagePicker = await cargarPicker()
  if (!ImagePicker) return null
  try {
    const permiso = await ImagePicker.requestCameraPermissionsAsync()
    if (permiso.status !== 'granted') {
      avisarPermisoDenegado('Se necesita acceso a la cámara para sacar una foto.', permiso.canAskAgain)
      return null
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: opciones.aspect,
      quality: 0.7,
    })
    if (result.canceled || !result.assets[0]) return null
    return result.assets[0].uri
  } catch {
    // Emulators and devices without a camera reject instead of returning canceled.
    Alert.alert('Cámara no disponible', 'No se pudo abrir la cámara en este dispositivo.')
    return null
  }
}

// Asks "Tomar foto" or "Galería" and resolves with the local uri, or null if the
// user cancels or a permission is denied.
// On iOS the picker is presented while the Alert is still dismissing (and often
// from inside a pageSheet Modal), which makes it fail silently; wait for the
// Alert animation to finish first.
function trasAlert(fn: () => void) {
  setTimeout(fn, Platform.OS === 'ios' ? 450 : 0)
}

export function elegirImagen(opciones: Opciones = {}): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.alert(
      'Agregar foto',
      undefined,
      [
        { text: 'Tomar foto', onPress: () => trasAlert(() => { tomarFoto(opciones).then(resolve, () => resolve(null)) }) },
        { text: 'Galería', onPress: () => trasAlert(() => { elegirDeGaleria(opciones).then(resolve, () => resolve(null)) }) },
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    )
  })
}
