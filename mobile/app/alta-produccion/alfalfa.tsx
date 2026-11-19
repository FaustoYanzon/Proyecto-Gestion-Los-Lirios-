// Alfalfa: pantalla suelta (acceso desde Depósitos). El contenido vive en AlfalfaPanel,
// que Cosecha también muestra como pestaña. Solo encargado o superior.
import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../../lib/theme'
import { useAuthStore } from '../../store/authStore'
import AlfalfaPanel from '../../components/AlfalfaPanel'
import { puedeAltaProduccion } from '../../lib/altaProduccion'

export default function AlfalfaScreen() {
  const role = useAuthStore((s) => s.user?.role)

  if (!puedeAltaProduccion(role)) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No tenés acceso a esta sección</Text>
      </View>
    )
  }
  return <AlfalfaPanel />
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.hueso },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.ink60 },
})
