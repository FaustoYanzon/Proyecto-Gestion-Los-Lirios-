// Side drawer shared by the profile (opens from the right) and the modules menu
// (opens from the left). Horizontal slide + fading scrim; the Modal itself is not
// animated (animationType "none") because the built-in "slide" goes bottom-up.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native'
import { colors, space, radius } from '../lib/theme'

const ENTER_MS = 260
const EXIT_MS = 200

export function SideDrawer({ open, side, onClose, onClosed, widthPct = 0.82, children }: {
  open: boolean
  side: 'left' | 'right'
  onClose: () => void
  /** Fired once the exit animation has finished and the drawer is unmounted. */
  onClosed?: () => void
  widthPct?: number
  children: ReactNode
}) {
  const { width: screenWidth } = useWindowDimensions()
  const width = screenWidth * widthPct
  const progress = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
      Animated.timing(progress, {
        toValue: 1, duration: ENTER_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start()
      return
    }
    Animated.timing(progress, {
      toValue: 0, duration: EXIT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true,
    }).start(({ finished }) => {
      // An interrupted exit (reopened mid-animation) must keep the drawer mounted.
      if (finished) { setMounted(false); onClosed?.() }
    })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [side === 'left' ? -width : width, 0],
  })

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
      </Animated.View>
      <Animated.View
        style={[
          styles.drawer,
          side === 'left' ? styles.left : styles.right,
          { width, transform: [{ translateX }] },
        ]}
      >
        {children}
      </Animated.View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(31,26,23,0.4)' },
  drawer: {
    position: 'absolute', top: 0, bottom: 0,
    backgroundColor: colors.blanco, padding: space.s5,
  },
  left: { left: 0, borderTopRightRadius: radius.lg, borderBottomRightRadius: radius.lg },
  right: { right: 0, borderTopLeftRadius: radius.lg, borderBottomLeftRadius: radius.lg },
})
