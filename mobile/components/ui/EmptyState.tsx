import { View, Text, StyleSheet, type ViewStyle } from 'react-native'
import type { IconKey } from '../../lib/icons'
import { ICONS, ICON_STROKE } from '../../lib/icons'

// Sin ilustraciones ni emojis — ícono 24, título 15, descripción 13.
export default function EmptyState({
  icon,
  title,
  description,
  action,
  style,
}: {
  icon: IconKey
  title: string
  description?: string
  action?: React.ReactNode
  style?: ViewStyle
}) {
  const Icon = ICONS[icon]
  return (
    <View style={[styles.container, style]}>
      <Icon size={24} color="#a09584" strokeWidth={ICON_STROKE} />
      <Text style={styles.title}>{title}</Text>
      {description && <Text style={styles.description}>{description}</Text>}
      {action && <View style={{ marginTop: 16 }}>{action}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 16 },
  title: { fontSize: 15, fontWeight: '700', color: '#1f1a17', marginTop: 12, textAlign: 'center' },
  description: { fontSize: 13, color: '#5a544c', marginTop: 4, textAlign: 'center' },
})
