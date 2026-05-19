import { useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  Image,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import * as SecureStore from 'expo-secure-store'
import { useRouter } from 'expo-router'
import { useAuthStore } from '../../store/authStore'
import api from '../../lib/api'

const AVATAR_KEY = 'loslirios_avatar'

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  gerencial: 'Gerencial',
  encargado: 'Encargado',
  regador: 'Regador',
  obrero: 'Obrero',
}

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  super_admin: { bg: '#fef3c7', text: '#92400e' },
  gerencial:   { bg: '#ede9fe', text: '#5b21b6' },
  encargado:   { bg: '#dcfce7', text: '#166534' },
  regador:     { bg: '#dbeafe', text: '#1e40af' },
  obrero:      { bg: '#f3f4f6', text: '#374151' },
}

const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: ['Ver todo', 'Editar todo', 'Crear usuarios', 'Eliminar registros', 'Finanzas completas'],
  gerencial:   ['Ver todo', 'Editar producción', 'Ver finanzas'],
  encargado:   ['Registrar tareas', 'Registrar riego', 'Ver parcelas', 'Estado fenológico'],
  regador:     ['Registrar riego', 'Ver parcelas'],
  obrero:      ['Ver parcelas'],
}

export default function PerfilScreen() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const router = useRouter()

  const [avatarUri, setAvatarUri] = useState<string | null>(null)
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [showCurrentPwd, setShowCurrentPwd] = useState(false)
  const [showNewPwd, setShowNewPwd] = useState(false)

  useEffect(() => {
    SecureStore.getItemAsync(AVATAR_KEY).then((uri) => {
      if (uri) setAvatarUri(uri)
    })
  }, [])

  async function pickAvatar() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la galería para cambiar la foto.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    })
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri
      setAvatarUri(uri)
      await SecureStore.setItemAsync(AVATAR_KEY, uri)
    }
  }

  async function handleChangePassword() {
    if (!newPassword || !currentPassword) {
      Alert.alert('Error', 'Completá todos los campos.')
      return
    }
    if (newPassword.length < 8) {
      Alert.alert('Error', 'La nueva contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Las contraseñas nuevas no coinciden.')
      return
    }
    try {
      setSavingPassword(true)
      await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      })
      Alert.alert('Listo', 'Contraseña actualizada correctamente.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setShowPasswordForm(false)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', typeof detail === 'string' ? detail : 'No se pudo cambiar la contraseña.')
    } finally {
      setSavingPassword(false)
    }
  }

  async function handleLogout() {
    Alert.alert('Cerrar sesión', '¿Estás seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Salir', style: 'destructive',
        onPress: async () => { await logout(); router.replace('/(auth)/login') },
      },
    ])
  }

  const role = user?.role ?? ''
  const roleLabel = ROLE_LABELS[role] ?? role
  const roleColor = ROLE_COLORS[role] ?? ROLE_COLORS.obrero
  const permissions = ROLE_PERMISSIONS[role] ?? []

  const initials = user?.full_name
    ? user.full_name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
    : '?'

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Avatar + name */}
      <View style={styles.profileHeader}>
        <TouchableOpacity style={styles.avatarContainer} onPress={pickAvatar}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
          <View style={styles.cameraBtn}>
            <Ionicons name="camera" size={13} color="#fff" />
          </View>
        </TouchableOpacity>

        <Text style={styles.userName}>{user?.full_name ?? '—'}</Text>
        <Text style={styles.userEmail}>{user?.email ?? '—'}</Text>

        <View style={[styles.rolePill, { backgroundColor: roleColor.bg }]}>
          <Text style={[styles.rolePillText, { color: roleColor.text }]}>{roleLabel}</Text>
        </View>
      </View>

      {/* Info card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>INFORMACIÓN DE CUENTA</Text>
        <View style={styles.infoRow}>
          <View style={styles.infoIcon}>
            <Ionicons name="person-outline" size={16} color="#6b7280" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoLabel}>Nombre completo</Text>
            <Text style={styles.infoValue}>{user?.full_name ?? '—'}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <View style={styles.infoIcon}>
            <Ionicons name="mail-outline" size={16} color="#6b7280" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoLabel}>Email</Text>
            <Text style={styles.infoValue}>{user?.email ?? '—'}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <View style={styles.infoIcon}>
            <Ionicons name="shield-checkmark-outline" size={16} color="#6b7280" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoLabel}>Rol</Text>
            <Text style={styles.infoValue}>{roleLabel}</Text>
          </View>
        </View>
      </View>

      {/* Permissions card */}
      {permissions.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>PERMISOS</Text>
          {permissions.map((p, idx) => (
            <View key={p}>
              <View style={styles.permRow}>
                <View style={styles.permDot} />
                <Text style={styles.permText}>{p}</Text>
              </View>
              {idx < permissions.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>
      )}

      {/* Password change */}
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.pwdHeader}
          onPress={() => setShowPasswordForm(!showPasswordForm)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={styles.infoIcon}>
              <Ionicons name="lock-closed-outline" size={16} color="#6b7280" />
            </View>
            <Text style={styles.cardTitle}>CAMBIAR CONTRASEÑA</Text>
          </View>
          <Ionicons
            name={showPasswordForm ? 'chevron-up' : 'chevron-down'}
            size={16}
            color="#9ca3af"
          />
        </TouchableOpacity>

        {showPasswordForm && (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.fieldLabel}>Contraseña actual</Text>
            <View style={styles.pwdInputRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry={!showCurrentPwd}
                placeholder="••••••••"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowCurrentPwd(!showCurrentPwd)}>
                <Ionicons name={showCurrentPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Nueva contraseña</Text>
            <View style={styles.pwdInputRow}>
              <TextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry={!showNewPwd}
                placeholder="Mínimo 8 caracteres"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
              />
              <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowNewPwd(!showNewPwd)}>
                <Ionicons name={showNewPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Confirmar nueva contraseña</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              placeholder="Repetir contraseña"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={[styles.saveBtn, savingPassword && { opacity: 0.6 }]}
              onPress={handleChangePassword}
              disabled={savingPassword}
            >
              {savingPassword ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Guardar contraseña</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={18} color="#ef4444" />
        <Text style={styles.logoutBtnText}>Cerrar sesión</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  profileHeader: { alignItems: 'center', paddingVertical: 24, marginBottom: 8 },
  avatarContainer: { position: 'relative', marginBottom: 14 },
  avatar: { width: 90, height: 90, borderRadius: 45 },
  avatarPlaceholder: {
    width: 90, height: 90, borderRadius: 45, backgroundColor: '#16a34a',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#16a34a', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  avatarInitials: { fontSize: 32, fontWeight: '800', color: '#fff' },
  cameraBtn: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#374151', justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#f4f6f8',
  },
  userName: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 4 },
  userEmail: { fontSize: 14, color: '#6b7280', marginBottom: 12 },
  rolePill: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
  },
  rolePillText: { fontSize: 13, fontWeight: '700' },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  cardTitle: {
    fontSize: 11, fontWeight: '700', color: '#9ca3af',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 14,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  infoIcon: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: '#f9fafb',
    justifyContent: 'center', alignItems: 'center',
  },
  infoLabel: { fontSize: 11, color: '#9ca3af', fontWeight: '600', marginBottom: 2 },
  infoValue: { fontSize: 15, color: '#111827', fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#f3f4f6', marginVertical: 10 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  permDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#16a34a' },
  permText: { fontSize: 14, color: '#374151', fontWeight: '500' },
  pwdHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: '#6b7280',
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6,
  },
  input: {
    height: 48, backgroundColor: '#f9fafb', borderRadius: 10,
    borderWidth: 1, borderColor: '#e8eaed', paddingHorizontal: 14,
    fontSize: 15, color: '#111827', marginBottom: 0,
  },
  pwdInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyeBtn: { width: 44, height: 48, justifyContent: 'center', alignItems: 'center' },
  saveBtn: {
    height: 48, backgroundColor: '#16a34a', borderRadius: 10,
    justifyContent: 'center', alignItems: 'center', marginTop: 16,
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, borderRadius: 12,
    borderWidth: 1.5, borderColor: '#fecaca', backgroundColor: '#fff', marginTop: 4,
  },
  logoutBtnText: { color: '#ef4444', fontSize: 15, fontWeight: '700' },
})
