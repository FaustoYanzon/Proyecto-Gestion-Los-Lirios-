import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { ICONS, ICON_STROKE } from '../lib/icons'
import { colors, space, text } from '../lib/theme'

// Burgundy top bar shared by every "new record" form: back arrow + title.
export function FormHeader({ title, onBack, color = colors.burdeos[600] }: {
  title: string; onBack: () => void; color?: string
}) {
  return (
    <View style={[styles.header, { backgroundColor: color }]}>
      <TouchableOpacity onPress={onBack} style={styles.back} hitSlop={12} accessibilityLabel="Volver">
        <ICONS.atras size={22} color={colors.blanco} strokeWidth={ICON_STROKE} />
      </TouchableOpacity>
      <Text style={styles.title}>{title}</Text>
      <View style={{ width: 22 }} />
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    height: 48,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.s4,
  },
  back: { padding: space.s1 },
  title: { ...text.h3, color: colors.blanco },
})
