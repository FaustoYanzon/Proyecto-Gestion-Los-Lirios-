import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { login } from '../../lib/auth'
import { useAuthStore } from '../../store/authStore'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const setUser = useAuthStore((s) => s.setUser)

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Ingresá email y contraseña.')
      return
    }
    try {
      setLoading(true)
      const user = await login(email.trim(), password)
      setUser(user)
      router.replace('/(tabs)')
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status
      const msg = status === 401
        ? 'Email o contraseña incorrectos.'
        : 'No se pudo conectar al servidor. Verificá la red.'
      Alert.alert('Error de acceso', msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Logo / Header */}
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>LL</Text>
          </View>
          <Text style={styles.brand}>Los Lirios SA</Text>
          <Text style={styles.subtitle}>Sistema de gestión agrícola</Text>
        </View>

        {/* Form */}
        <View style={styles.card}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="usuario@loslirios.com"
            placeholderTextColor="#9ca3af"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            returnKeyType="next"
          />

          <Text style={[styles.label, { marginTop: 16 }]}>Contraseña</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor="#9ca3af"
            secureTextEntry
            autoComplete="password"
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Ingresar</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.version}>v1.0.0</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#16a34a',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#16a34a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  logoText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 1,
  },
  brand: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  btn: {
    height: 50,
    backgroundColor: '#16a34a',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  version: {
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 24,
  },
})
