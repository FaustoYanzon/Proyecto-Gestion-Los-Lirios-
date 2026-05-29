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
import { colors, fonts } from '../../lib/theme'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
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
      Alert.alert(
        'Error de acceso',
        status === 401
          ? 'Email o contraseña incorrectos.'
          : 'No se pudo conectar al servidor. Verificá la red.',
      )
    } finally {
      setLoading(false)
    }
  }

  function handleFaceId() {
    Alert.alert('Face ID', 'Autenticación biométrica disponible en próxima versión.')
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.crema }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ── */}
        <View style={styles.hero}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoInitials}>LL</Text>
          </View>
          <Text style={[styles.brand, { fontFamily: fonts.display }]}>
            Los Lirios SA
          </Text>
          <Text style={styles.heroSub}>Gestión integral de la finca</Text>
        </View>

        {/* ── Form card ── */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { fontFamily: fonts.display }]}>
            Bienvenido
          </Text>

          <Text style={styles.label}>EMAIL</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="usuario@losliriossa.com"
            placeholderTextColor={colors.niebla}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            returnKeyType="next"
          />

          <Text style={[styles.label, { marginTop: 14 }]}>CONTRASEÑA</Text>
          <View style={styles.pwdRow}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.niebla}
              secureTextEntry={!showPwd}
              autoComplete="password"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />
            <TouchableOpacity
              style={styles.eyeBtn}
              onPress={() => setShowPwd((v) => !v)}
            >
              <Ionicons
                name={showPwd ? 'eye-off-outline' : 'eye-outline'}
                size={19}
                color={colors.niebla}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, loading && { opacity: 0.6 }]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={colors.blanco} />
            ) : (
              <Text style={styles.submitBtnText}>Ingresar</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Divider ── */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>O</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* ── Face ID ── */}
        <TouchableOpacity
          style={styles.faceIdBtn}
          onPress={handleFaceId}
          activeOpacity={0.8}
        >
          <Ionicons name="finger-print-outline" size={22} color={colors.burdeos[600]} />
          <Text style={styles.faceIdText}>Ingresar con Face ID</Text>
        </TouchableOpacity>

        {/* ── Footer ── */}
        <Text style={styles.footer}>Los Lirios SA · Desde 1991</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40,
    alignItems: 'center',
  },
  hero: { alignItems: 'center', marginBottom: 36 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.burdeos[600],
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
    shadowColor: colors.burdeos[700],
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  logoInitials: { color: colors.blanco, fontSize: 28, fontWeight: '800', letterSpacing: 1 },
  brand: { fontSize: 26, color: colors.ink, marginBottom: 6 },
  heroSub: { fontSize: 14, color: colors.ink60, fontWeight: '500' },
  card: {
    width: '100%', backgroundColor: colors.blanco, borderRadius: 20, padding: 24,
    marginBottom: 20,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 4,
  },
  cardTitle: { fontSize: 22, color: colors.ink, marginBottom: 22 },
  label: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, marginBottom: 8,
  },
  input: {
    height: 50, borderWidth: 1.5, borderColor: colors.hueso,
    borderRadius: 12, paddingHorizontal: 14, fontSize: 15,
    color: colors.ink, backgroundColor: colors.hueso, marginBottom: 0,
  },
  pwdRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 0 },
  eyeBtn: { width: 48, height: 50, justifyContent: 'center', alignItems: 'center', marginLeft: 4 },
  submitBtn: {
    height: 52, backgroundColor: colors.burdeos[600], borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', marginTop: 24,
    shadowColor: colors.burdeos[700],
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  submitBtnText: { color: colors.blanco, fontSize: 16, fontWeight: '700' },
  dividerRow: {
    flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 20,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.hueso },
  dividerText: {
    marginHorizontal: 12, fontSize: 12, fontWeight: '700',
    color: colors.niebla, letterSpacing: 1,
  },
  faceIdBtn: {
    width: '100%', height: 52, borderRadius: 12, borderWidth: 1.5,
    borderColor: colors.burdeos[200], backgroundColor: colors.blanco,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, marginBottom: 32,
  },
  faceIdText: { fontSize: 15, color: colors.burdeos[600], fontWeight: '600' },
  footer: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 1, textTransform: 'uppercase',
  },
})
