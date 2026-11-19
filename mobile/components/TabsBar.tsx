// Horizontal pill tabs: one panel visible at a time (Depósitos, Cosecha).
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native'
import { colors } from '../lib/theme'

interface Props<T extends string> {
  tabs: { key: T; label: string }[]
  active: T
  onChange: (key: T) => void
}

export default function TabsBar<T extends string>({ tabs, active, onChange }: Props<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {tabs.map((t) => {
        const selected = t.key === active
        return (
          <TouchableOpacity
            key={t.key}
            style={[styles.pill, selected && styles.pillActive]}
            onPress={() => onChange(t.key)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.label, selected && styles.labelActive]}>{t.label}</Text>
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, backgroundColor: colors.hueso },
  content: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  pill: {
    minHeight: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: 'center',
    backgroundColor: colors.blanco, borderWidth: 1, borderColor: colors.borde,
  },
  pillActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  label: { fontSize: 14, fontWeight: '700', color: colors.ink60 },
  labelActive: { color: colors.blanco },
})
