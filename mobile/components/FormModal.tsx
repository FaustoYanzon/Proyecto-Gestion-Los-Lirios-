import { useRef, type ReactNode } from 'react'
import { Modal, View, StyleSheet } from 'react-native'
import { FormHeader } from './FormHeader'
import { colors } from '../lib/theme'

// Same presentation as the cosecha "+" form: page sheet sliding up, burgundy
// header with a back arrow. `children` is null when the form is closed; the
// last content is kept so it does not vanish while the sheet slides down.
export function FormModal({ title, onBack, color, children }: {
  title: string
  onBack: () => void
  /** Header color; defaults to burgundy. */
  color?: string
  children: ReactNode | null
}) {
  const last = useRef<ReactNode>(null)
  if (children) last.current = children
  return (
    <Modal visible={!!children} animationType="slide" presentationStyle="pageSheet" onRequestClose={onBack}>
      <View style={styles.root}>
        <FormHeader title={title} onBack={onBack} color={color} />
        {children ?? last.current}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.hueso },
})
