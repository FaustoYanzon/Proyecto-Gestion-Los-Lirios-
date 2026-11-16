import { Alert } from 'react-native'

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

async function elegirDeGaleria(opciones: Opciones): Promise<string | null> {
  const ImagePicker = await cargarPicker()
  if (!ImagePicker) return null
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (status !== 'granted') {
    Alert.alert('Permiso requerido', 'Se necesita acceso a la galería para adjuntar una foto.')
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
}

async function tomarFoto(opciones: Opciones): Promise<string | null> {
  const ImagePicker = await cargarPicker()
  if (!ImagePicker) return null
  const { status } = await ImagePicker.requestCameraPermissionsAsync()
  if (status !== 'granted') {
    Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para sacar una foto.')
    return null
  }
  try {
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
export function elegirImagen(opciones: Opciones = {}): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.alert(
      'Agregar foto',
      undefined,
      [
        { text: 'Tomar foto', onPress: () => tomarFoto(opciones).then(resolve, () => resolve(null)) },
        { text: 'Galería', onPress: () => elegirDeGaleria(opciones).then(resolve, () => resolve(null)) },
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    )
  })
}
