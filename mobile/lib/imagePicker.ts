import { Alert } from 'react-native'

// expo-image-picker NO está en el build nativo instalado hoy (1.0.0, builds
// de agosto): importarlo arriba de un archivo tira "Cannot find native
// module 'ExponentImagePicker'" apenas se carga la pantalla y cierra la app
// (pasó con Fito el 2026-09-24). Por eso se carga recién al tocar el botón y,
// si falta, se avisa en vez de romper. Cuando salga un build nativo nuevo con
// el módulo, esto sigue funcionando igual sin cambios.
type Opciones = { aspect?: [number, number] }

export async function elegirImagenDeGaleria(opciones: Opciones = {}): Promise<string | null> {
  let ImagePicker: typeof import('expo-image-picker')
  try {
    ImagePicker = await import('expo-image-picker')
  } catch {
    Alert.alert(
      'Fotos no disponibles',
      'Esta versión de la app todavía no permite adjuntar fotos. Va a estar disponible en la próxima actualización de la tienda.',
    )
    return null
  }

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
