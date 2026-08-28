import { View, Text, StyleSheet } from 'react-native'

type BadgeVariant = 'dot' | 'count' | 'label'

/**
 * dot: hay novedad, no importa cuánta. count: conteo, hasta 9 y después "9+".
 * label: estados con nombre. Nunca "label" para conteos.
 */
export default function Badge({
  variant,
  value,
  ringColor = '#ffffff',
}: {
  variant: BadgeVariant
  value?: number | string
  ringColor?: string
}) {
  if (variant === 'dot') {
    return <View style={[styles.dot, { shadowColor: ringColor }, ringStyle(ringColor)]} />
  }

  if (variant === 'count') {
    const n = typeof value === 'number' ? value : Number(value ?? 0)
    const display = n > 9 ? '9+' : String(n)
    return (
      <View style={[styles.count, ringStyle(ringColor)]}>
        <Text style={styles.countText}>{display}</Text>
      </View>
    )
  }

  return (
    <View style={styles.label}>
      <Text style={styles.labelText}>{value}</Text>
    </View>
  )
}

// React Native no tiene box-shadow/anillo nativo — un borde del color de
// fondo simula el mismo "anillo de 2px" que en web.
function ringStyle(ringColor: string) {
  return { borderWidth: 2, borderColor: ringColor }
}

const styles = StyleSheet.create({
  dot: {
    width: 9, height: 9, borderRadius: 999, backgroundColor: '#7a1f2c',
  },
  count: {
    minHeight: 17, minWidth: 17, paddingHorizontal: 5, borderRadius: 999,
    backgroundColor: '#7a1f2c', justifyContent: 'center', alignItems: 'center',
  },
  countText: { color: '#ffffff', fontSize: 10, fontWeight: '800' },
  label: {
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2,
    backgroundColor: '#faf6ec', alignSelf: 'flex-start',
  },
  labelText: {
    fontSize: 10, fontWeight: '800', color: '#7a1f2c',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
})
