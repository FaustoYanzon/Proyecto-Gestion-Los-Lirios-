import { useState } from 'react'
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ICONS, ICON_STROKE } from '../lib/icons'
import { colors, space, radius, text } from '../lib/theme'
import { useAuthStore } from '../store/authStore'
import { useFincaStore, FINCAS } from '../store/fincaStore'

// Campaña vigente (Mayo→Abril), calculada por fecha — mismo criterio que
// CampanaSwitcher en web. Es fija: la etiqueta de la campaña real actual,
// no un valor elegible.
function campanaActual(): string {
  const now = new Date()
  const base = now.getMonth() + 1 >= 5 ? now.getFullYear() : now.getFullYear() - 1
  return `${base}/${base + 1}`
}

// Centered header control: active finca + current campaña. Only gerencial and
// super_admin can switch fincas; everyone else sees their assigned finca fixed.
export function FincaSelector() {
  const insets = useSafeAreaInsets()
  const role = useAuthStore((s) => s.user?.role)
  const { active, setFinca } = useFincaStore()
  const [open, setOpen] = useState(false)
  const puedeCambiar = role === 'gerencial' || role === 'super_admin'

  const label = (
    <>
      <View style={styles.fincaRow}>
        <Text style={styles.finca} numberOfLines={1}>{active.label}</Text>
        {puedeCambiar && <ICONS.desplegar size={11} color={colors.ink60} strokeWidth={ICON_STROKE} />}
      </View>
      <Text style={styles.campana}>{campanaActual()}</Text>
    </>
  )

  if (!puedeCambiar) return <View style={styles.center}>{label}</View>

  return (
    <>
      <TouchableOpacity
        style={styles.center}
        onPress={() => setOpen(true)}
        accessibilityLabel={`Finca ${active.label}. Cambiar finca`}
        hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
        activeOpacity={0.7}
      >
        {label}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} />
        <View style={[styles.card, { top: insets.top + 41 + space.s2 }]}>
          <Text style={styles.cardHeader}>FINCA ACTIVA</Text>
          {FINCAS.map((f) => {
            const isActive = f.key === active.key
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.option, isActive && styles.optionActive]}
                onPress={() => { setFinca(f.key); setOpen(false) }}
                activeOpacity={0.7}
              >
                <View style={[styles.dot, isActive && styles.dotActive]} />
                <Text style={[styles.optionLabel, isActive && styles.optionLabelActive]}>{f.label}</Text>
                {isActive && <ICONS.check size={18} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />}
              </TouchableOpacity>
            )
          })}
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center' },
  fincaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  finca: { fontSize: 11, fontWeight: '700', color: colors.ink },
  campana: { fontSize: 8, color: colors.ink60, marginTop: 1 },

  overlay: { flex: 1, backgroundColor: 'rgba(31,26,23,0.25)' },
  card: {
    position: 'absolute', alignSelf: 'center', width: 280,
    backgroundColor: colors.blanco, borderRadius: radius.lg, padding: space.s4,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 14, elevation: 8,
  },
  cardHeader: { ...text.micro, color: colors.ink60, marginBottom: space.s2 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3, minHeight: 48,
    paddingVertical: space.s3, paddingHorizontal: space.s3,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.hueso,
    backgroundColor: colors.blanco, marginBottom: space.s2,
  },
  optionActive: { borderColor: colors.burdeos[600], backgroundColor: colors.crema },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.niebla },
  dotActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  optionLabel: { flex: 1, ...text.body, color: colors.ink, fontWeight: '600' },
  optionLabelActive: { color: colors.burdeos[600] },
})
