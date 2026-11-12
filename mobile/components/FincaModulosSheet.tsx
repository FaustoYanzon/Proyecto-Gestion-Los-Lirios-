import { useCallback, useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ICONS, ICON_STROKE } from '../lib/icons'
import Badge from './ui/Badge'
import { colors, space, radius, text } from '../lib/theme'
import { useAuthStore } from '../store/authStore'
import { useFincaStore, FINCAS } from '../store/fincaStore'
import { puedeVerMaquinaria } from '../lib/maquinaria'
import { contarOrdenesPendientesDeAccion } from '../lib/maquinariaUi'

type SheetView = 'main' | 'finca'

// Pin button for the app header + bottom sheet "Finca y módulos". Only rendered
// for roles with access to at least one module (hoy: Maquinaria).
export function FincaModulosButton() {
  const role = useAuthStore((s) => s.user?.role)
  const [open, setOpen] = useState(false)

  if (!puedeVerMaquinaria(role)) return null

  return (
    <>
      <TouchableOpacity
        accessibilityLabel="Finca y módulos"
        onPress={() => setOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.pinBtn}
      >
        <ICONS.ubicacion size={18} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />
      </TouchableOpacity>
      <FincaModulosSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function FincaModulosSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const [view, setView] = useState<SheetView>('main')

  // Always reopen on the main view.
  useEffect(() => { if (!open) setView('main') }, [open])

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: space.s5 + insets.bottom }]}>
        <View style={styles.handle} />
        {view === 'main' && <MainView onNav={setView} onClose={onClose} visible={open} />}
        {view === 'finca' && <FincaView onBack={() => setView('main')} />}
      </View>
    </Modal>
  )
}

function MainView({ onNav, onClose, visible }: {
  onNav: (v: SheetView) => void
  onClose: () => void
  visible: boolean
}) {
  const router = useRouter()
  const role = useAuthStore((s) => s.user?.role)
  const { active } = useFincaStore()
  const [pendientes, setPendientes] = useState(0)
  // encargado ve la finca fija asignada; solo gerencial+ puede cambiarla.
  const puedeCambiarFinca = role === 'gerencial' || role === 'super_admin'

  const cargarPendientes = useCallback(async () => {
    try {
      setPendientes(await contarOrdenesPendientesDeAccion(role, active.key))
    } catch {
      // Offline or server error: no badge instead of a wrong number.
      setPendientes(0)
    }
  }, [role, active.key])

  useEffect(() => { if (visible) cargarPendientes() }, [visible, cargarPendientes])

  return (
    <>
      <Text style={styles.sectionHeader}>FINCA ACTIVA</Text>
      <TouchableOpacity
        style={styles.fincaCard}
        onPress={puedeCambiarFinca ? () => onNav('finca') : undefined}
        disabled={!puedeCambiarFinca}
        activeOpacity={0.7}
      >
        <ICONS.ubicacion size={18} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />
        <Text style={styles.fincaName}>{active.label}</Text>
        {puedeCambiarFinca && <Text style={styles.fincaChevron}>cambiar ▾</Text>}
      </TouchableOpacity>

      <Text style={styles.sectionHeader}>MÓDULOS</Text>
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
    </>
  )
}

function FincaView({ onBack }: { onBack: () => void }) {
  const { active, setFinca } = useFincaStore()

  return (
    <>
      <View style={styles.subHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} accessibilityLabel="Volver">
          <ICONS.atras size={20} color={colors.ink} strokeWidth={ICON_STROKE} />
        </TouchableOpacity>
        <Text style={styles.subTitle}>Cambiar Finca</Text>
      </View>

      <Text style={styles.sectionHeader}>FINCAS DISPONIBLES</Text>

      {FINCAS.map((f) => {
        const isActive = f.key === active.key
        return (
          <TouchableOpacity
            key={f.key}
            style={[styles.fincaOption, isActive && styles.fincaOptionActive]}
            onPress={() => { setFinca(f.key); onBack() }}
            activeOpacity={0.7}
          >
            <View style={[styles.fincaOptionDot, isActive && styles.fincaOptionDotActive]} />
            <Text style={[styles.fincaOptionLabel, isActive && styles.fincaOptionLabelActive]}>
              {f.label}
            </Text>
            {isActive && (
              <ICONS.check size={18} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />
            )}
          </TouchableOpacity>
        )
      })}

      <Text style={styles.footerText}>El cambio de finca actualiza los datos al recargar</Text>
    </>
  )
}

const styles = StyleSheet.create({
  // 44pt target around the 18px glyph.
  pinBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', marginLeft: -12 },

  overlay: { flex: 1, backgroundColor: 'rgba(31,26,23,0.4)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.blanco, paddingHorizontal: space.s5, paddingTop: space.s3,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.borde, marginBottom: space.s2,
  },

  sectionHeader: { ...text.micro, color: colors.ink60, marginTop: space.s4, marginBottom: space.s2 },
  fincaCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.s2, minHeight: 48,
    paddingHorizontal: space.s3, paddingVertical: space.s3,
    borderWidth: 1.5, borderColor: colors.burdeos[600], borderRadius: radius.md,
    backgroundColor: colors.crema,
  },
  fincaName: { flex: 1, ...text.body, fontWeight: '700', color: colors.ink },
  fincaChevron: { ...text.small, color: colors.ink60 },

  moduleItem: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: 48,
    paddingVertical: space.s3, paddingHorizontal: space.s3,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.hueso,
    backgroundColor: colors.blanco,
  },
  moduleLabel: { flex: 1, ...text.body, color: colors.ink, fontWeight: '600' },

  subHeader: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    paddingBottom: space.s3, borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.hueso, justifyContent: 'center', alignItems: 'center',
  },
  subTitle: { flex: 1, ...text.h3, color: colors.ink },

  fincaOption: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: 48,
    paddingVertical: space.s3, paddingHorizontal: space.s3,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.hueso,
    backgroundColor: colors.blanco, marginBottom: space.s2,
  },
  fincaOptionActive: { borderColor: colors.burdeos[600], backgroundColor: colors.crema },
  fincaOptionDot: {
    width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.niebla,
  },
  fincaOptionDotActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  fincaOptionLabel: { flex: 1, ...text.body, color: colors.ink, fontWeight: '600' },
  fincaOptionLabelActive: { color: colors.burdeos[600] },
  footerText: { ...text.small, color: colors.ink60, fontSize: 11, marginTop: space.s3 },
})
