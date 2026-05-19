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
import { Ionicons } from '@expo/vector-icons'
import { login } from '../../lib/auth'
import { useAuthStore } from '../../store/authStore'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>LL</Text>
          </View>
          <Text style={styles.brand}>Los Lirios SA</Text>
          <Text style={styles.subtitle}>Sistema de gestión agrícola</Text>
        </View>

        {/* Form card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Iniciar sesión</Text>

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

          <Text style={[styles.label, { marginTop: 14 }]}>Contraseña</Text>
          <View style={styles.pwdRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#9ca3af"
              secureTextEntry={!showPassword}
              autoComplete="password"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={19}
                color="#9ca3af"
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && { opacity: 0.6 }]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Ingresar</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.version}>Los Lirios SA · v1.0.0</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  header: { alignItems: 'center', marginBottom: 36 },
  logoCircle: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: '#16a34a',
    justifyContent: 'center', alignItems: 'center', marginBottom: 18,
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  logoText: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: 1 },
  brand: { fontSize: 28, fontWeight: '800', color: '#111827', letterSpacing: 0.3 },
  subtitle: { fontSize: 14, color: '#6b7280', marginTop: 5, fontWeight: '500' },
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '700', color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  input: {
    height: 50, borderWidth: 1.5, borderColor: '#e8eaed', borderRadius: 12,
    paddingHorizontal: 14, fontSize: 15, color: '#111827', backgroundColor: '#f9fafb',
    marginBottom: 0,
  },
  pwdRow: { flexDirection: 'row', alignItems: 'center', gap: 0, marginBottom: 0 },
  eyeBtn: { width: 48, height: 50, justifyContent: 'center', alignItems: 'center', marginLeft: 4 },
  btn: {
    height: 52, backgroundColor: '#16a34a', borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', marginTop: 24,
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  version: { textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 28 },
})
