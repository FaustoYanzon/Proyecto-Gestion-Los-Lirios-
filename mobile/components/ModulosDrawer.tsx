import { useCallback, useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ICONS, ICON_STROKE } from '../lib/icons'
import Badge from './ui/Badge'
import { SideDrawer } from './SideDrawer'
import { colors, space, radius, text } from '../lib/theme'
import { useAuthStore } from '../store/authStore'
import { useFincaStore } from '../store/fincaStore'
import { puedeVerMaquinaria } from '../lib/maquinaria'
import { alcanceMaquinaria, contarOrdenesPendientesDeAccion } from '../lib/maquinariaUi'

// Header grape glyph. For roles with access to at least one module (hoy:
// Maquinaria) it opens the modules drawer from the left; for the rest it is
// just the logo.
export function ModulosButton() {
  const role = useAuthStore((s) => s.user?.role)
  const [open, setOpen] = useState(false)
  const glifo = <Image source={require('../assets/logo-glifo.png')} style={styles.glifo} resizeMode="contain" />

  if (!puedeVerMaquinaria(role)) return glifo

  return (
    <>
      <TouchableOpacity
        accessibilityLabel="Módulos"
        onPress={() => setOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.glifoBtn}
      >
        {glifo}
      </TouchableOpacity>
      <ModulosDrawer open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function ModulosDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const role = useAuthStore((s) => s.user?.role)
  const fincaActiva = useFincaStore((s) => s.active.key)
  const [pendientes, setPendientes] = useState(0)

  const cargarPendientes = useCallback(async () => {
    try {
      setPendientes(await contarOrdenesPendientesDeAccion(role, alcanceMaquinaria(role, fincaActiva)))
    } catch {
      // Offline or server error: no badge instead of a wrong number.
      setPendientes(0)
    }
  }, [role, fincaActiva])

  useEffect(() => { if (open) cargarPendientes() }, [open, cargarPendientes])

  return (
    <SideDrawer open={open} side="left" onClose={onClose}>
      <View style={{ paddingTop: insets.top + space.s4 }}>
        <View style={styles.titleRow}>
          <Image source={require('../assets/logo-glifo.png')} style={styles.titleGlifo} resizeMode="contain" />
          <Text style={styles.title}>Módulos</Text>
        </View>
        <TouchableOpacity
          style={styles.moduleItem}
          activeOpacity={0.7}
          onPress={() => { onClose(); router.push('/maquinaria') }}
        >
          <ICONS.tractor size={20} color={colors.ink60} strokeWidth={ICON_STROKE} />
          <Text style={styles.moduleLabel}>Maquinaria</Text>
          {pendientes > 0 && <Badge variant="count" value={pendientes} />}
          <ICONS.avance size={18} color={colors.niebla} strokeWidth={ICON_STROKE} />
        </TouchableOpacity>
      </View>
    </SideDrawer>
  )
}

const styles = StyleSheet.create({
  glifo: { width: 20, height: 20 },
  // 44pt target around the 20px glyph.
  glifoBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', marginLeft: -12, marginRight: -12 },

  titleRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.s2,
    paddingBottom: space.s4, marginBottom: space.s4,
    borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  titleGlifo: { width: 24, height: 24 },
  title: { ...text.h3, color: colors.ink },

  moduleItem: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: 48,
    paddingVertical: space.s3, paddingHorizontal: space.s3,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.hueso,
    backgroundColor: colors.blanco,
  },
  moduleLabel: { flex: 1, ...text.body, color: colors.ink, fontWeight: '600' },
})
