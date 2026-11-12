import { Text, View, StyleSheet } from 'react-native'
import { FINCA_TAG_COLORS } from '../lib/finca'
import { FINCA_LABELS, type FincaMaquinaria } from '../lib/maquinaria'
import { colors } from '../lib/theme'

// Small colored pill saying which finca a machine / order belongs to.
export function FincaTag({ finca }: { finca: FincaMaquinaria }) {
  return (
    <View style={[styles.tag, { backgroundColor: FINCA_TAG_COLORS[finca] ?? colors.ink60 }]}>
      <Text style={styles.text} numberOfLines={1}>{FINCA_LABELS[finca] ?? finca}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  tag: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  text: { fontSize: 10, fontWeight: '800', color: colors.blanco },
})
