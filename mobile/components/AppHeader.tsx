import { forwardRef } from 'react'
import { View, TouchableOpacity, StyleSheet, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ICONS, ICON_STROKE } from '../lib/icons'
import { colors } from '../lib/theme'
import { UserBadge, type UserBadgeHandle } from './UserBadge'
import { ModulosButton } from './ModulosDrawer'
import { FincaSelector } from './FincaSelector'

// Header blanco de punta a punta — reemplaza el header burdeos por defecto
// de Tabs (headerStyle/headerTitle/headerRight en _layout.tsx). Sin título
// de pantalla: la pestaña activa ya lo dice abajo. La campanita no muestra
// un punto de aviso porque hoy no hay ninguna señal real de "hay algo
// nuevo" detrás — un aviso inventado es peor que ninguno (mismo criterio
// que el clima del topbar web).
//
// paddingTop: insets.top — sin esto el header (antes header nativo, que ya
// lo manejaba solo) queda pegado contra la barra de estado del sistema
// (reloj/batería), superpuesto en vez de debajo. onLayout reporta la altura
// real ya renderizada (fija + el inset, que varía por dispositivo — notch,
// isla dinámica) para que SyncBar (en _layout.tsx) sepa dónde anclarse.
export const AppHeader = forwardRef<
  UserBadgeHandle,
  { onHeightChange?: (height: number) => void }
>(({ onHeightChange }, ref) => {
  const insets = useSafeAreaInsets()

  function handleLayout(e: LayoutChangeEvent) {
    onHeightChange?.(e.nativeEvent.layout.height)
  }

  return (
    <View style={[styles.header, { paddingTop: insets.top }]} onLayout={handleLayout}>
      <View style={styles.row}>
        {/* Grape glyph opens the modules drawer (encargado+); center switches finca (gerencial+). */}
        <View style={styles.left}>
          <ModulosButton />
        </View>

        <FincaSelector />

        <View style={styles.right}>
          <TouchableOpacity
            accessibilityLabel="Notificaciones"
            onPress={() => (ref as React.RefObject<UserBadgeHandle>)?.current?.open('notif')}
            hitSlop={12}
            style={styles.bellBtn}
          >
            <ICONS.notificacion size={17} color={colors.ink60} strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
          <UserBadge ref={ref} />
        </View>
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.blanco,
    borderBottomWidth: 1, borderBottomColor: colors.borde,
  },
  row: {
    height: 41, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, gap: 10,
  },
  left: { flexDirection: 'row', alignItems: 'center', minWidth: 26 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bellBtn: { justifyContent: 'center', alignItems: 'center' },
})
