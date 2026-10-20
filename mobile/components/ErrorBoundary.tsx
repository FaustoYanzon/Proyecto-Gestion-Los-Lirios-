import { Component, type ReactNode } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { ICONS, ICON_STROKE } from '../lib/icons'
import { router } from 'expo-router'
import { colors, fonts } from '../lib/theme'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  // Primeras líneas del componentStack: sin esto el cartel no dice qué pantalla
  // ni qué componente rompió y un reporte desde la finca no se puede diagnosticar.
  stack: string
}

// React Error Boundaries solo funcionan como class components (no hay
// equivalente en hooks). Sin esto, cualquier excepcion de render en
// cualquier pantalla tira abajo toda la app en vez de mostrar una salida.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('ErrorBoundary capturo un error:', error, info.componentStack)
    const stack = (info.componentStack ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).join(' > ')
    this.setState({ stack })
  }

  // Vuelve a Inicio antes de limpiar el error: si solo limpiara el estado,
  // la pantalla rota se volvería a montar en el mismo lugar y probablemente
  // volvería a crashear en loop.
  reset = () => {
    router.replace('/(tabs)')
    this.setState({ error: null, stack: '' })
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <View style={styles.iconCircle}>
            <ICONS.aviso size={32} color={colors.blanco} strokeWidth={ICON_STROKE} />
          </View>
          <Text style={[styles.title, { fontFamily: fonts.display }]}>Algo salió mal</Text>
          <Text style={styles.subtitle}>
            Se produjo un error inesperado en esta pantalla. Podés volver a intentar.
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={this.reset} activeOpacity={0.85}>
            <Text style={styles.retryBtnText}>Volver a intentar</Text>
          </TouchableOpacity>
          <Text style={styles.detail} selectable>
            {`${this.state.error.name}: ${this.state.error.message}`.slice(0, 240)}
            {this.state.stack ? `\n${this.state.stack}`.slice(0, 240) : ''}
          </Text>
        </View>
      )
    }
    return this.props.children
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.hueso,
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: colors.sangre, justifyContent: 'center', alignItems: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 20, color: colors.ink, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.ink60, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  retryBtn: {
    height: 48, paddingHorizontal: 28, borderRadius: 12,
    backgroundColor: colors.burdeos[600], justifyContent: 'center', alignItems: 'center',
  },
  retryBtnText: { color: colors.blanco, fontSize: 15, fontWeight: '700' },
  detail: { marginTop: 28, fontSize: 11, color: colors.ink60, textAlign: 'center', lineHeight: 16 },
})
