import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, Pressable, StyleSheet, Switch, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, space, radius, text, getInitials, ROLE_LABELS } from '../lib/theme';
import { useAuthStore } from '../store/authStore';
import { useFincaStore, FINCAS, loadFinca } from '../store/fincaStore';
import { logout } from '../lib/auth';

// Drawer "views" — navigate within the drawer without stacking Modals
type DrawerView = 'main' | 'finca' | 'notif' | 'pref'

export function UserBadge() {
  const user = useAuthStore(s => s.user);
  const [open, setOpen] = useState(false);

  // Load persisted finca selection on mount
  useEffect(() => { loadFinca() }, []);

  return (
    <>
      <TouchableOpacity
        accessibilityLabel="Cuenta y opciones"
        onPress={() => setOpen(true)}
        style={styles.badge}
        hitSlop={10}
      >
        <Text style={styles.badgeText}>{getInitials(user?.full_name)}</Text>
      </TouchableOpacity>

      <UserDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function UserDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  const clearUser = useAuthStore(s => s.clearUser);
  const [view, setView] = useState<DrawerView>('main');

  // Reset to main whenever drawer reopens
  useEffect(() => { if (!open) setView('main') }, [open]);

  const handleLogout = async () => {
    onClose();
    await logout();
    clearUser();
    router.replace('/(auth)/login');
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={styles.drawer}>
        {view === 'main' && (
          <MainView
            user={user}
            onNav={setView}
            onClose={onClose}
            onLogout={handleLogout}
            router={router}
          />
        )}
        {view === 'finca' && <FincaView onBack={() => setView('main')} />}
        {view === 'notif' && <NotifView onBack={() => setView('main')} />}
        {view === 'pref'  && <PrefView  onBack={() => setView('main')} />}
      </View>
    </Modal>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

function MainView({ user, onNav, onClose, onLogout, router }: {
  user: ReturnType<typeof useAuthStore.getState>['user']
  onNav: (v: DrawerView) => void
  onClose: () => void
  onLogout: () => void
  router: ReturnType<typeof useRouter>
}) {
  const { active } = useFincaStore();

  return (
    <>
      {/* User card */}
      <View style={styles.userCard}>
        <View style={styles.bigBadge}>
          <Text style={styles.bigBadgeText}>{getInitials(user?.full_name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.userName}>{user?.full_name ?? '—'}</Text>
          <Text style={styles.userRole}>
            {user?.role ? ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role : ''}
          </Text>
        </View>
      </View>

      <SectionHeader>FINCA ACTIVA</SectionHeader>
      <TouchableOpacity style={styles.fincaCard} onPress={() => onNav('finca')}>
        <Ionicons name="location" size={18} color={colors.burdeos[600]} />
        <Text style={styles.fincaName}>{active.label}</Text>
        <Text style={styles.fincaChevron}>cambiar ▾</Text>
      </TouchableOpacity>

      <SectionHeader>CAMPAÑA</SectionHeader>
      <TouchableOpacity
        style={styles.campRow}
        onPress={() =>
          Alert.alert('Campaña', 'La gestión de campaña se realiza desde el sistema web.')
        }
      >
        <Ionicons name="calendar" size={18} color={colors.ink60} />
        <Text style={styles.campText}>Campaña 25/26 · día 27</Text>
        <Text style={styles.fincaChevron}>▾</Text>
      </TouchableOpacity>

      <View style={styles.divider} />

      <DrawerItem icon="person-outline" label="Mi perfil" onPress={() => { onClose(); router.push('/(tabs)/perfil') }} />
      <DrawerItem icon="notifications-outline" label="Notificaciones" badge="3" onPress={() => onNav('notif')} />
      <DrawerItem icon="settings-outline" label="Preferencias" onPress={() => onNav('pref')} />
      <DrawerItem
        icon="cloud-offline-outline"
        label="Modo offline"
        badge="SINCR."
        onPress={() => {}}
      />
      <DrawerItem icon="log-out-outline" label="Cerrar sesión" danger onPress={onLogout} />

      <View style={styles.footer}>
        <Text style={styles.footerText}>Los Lirios SA · v1.0.0</Text>
        <Text style={styles.footerText}>última sync · hace 2 min</Text>
      </View>
    </>
  );
}

// ─── Finca picker view ────────────────────────────────────────────────────────

function FincaView({ onBack }: { onBack: () => void }) {
  const { active, setFinca } = useFincaStore();

  return (
    <>
      <View style={styles.subHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.subTitle}>Cambiar Finca</Text>
      </View>

      <Text style={[styles.sectionHeader, { marginTop: space.s4 }]}>FINCAS DISPONIBLES</Text>

      {FINCAS.map((f) => {
        const isActive = f.key === active.key
        return (
          <TouchableOpacity
            key={f.key}
            style={[styles.fincaOption, isActive && styles.fincaOptionActive]}
            onPress={() => { setFinca(f.key); onBack() }}
            activeOpacity={0.7}
          >
            <View style={[styles.fincaOptionDot, isActive && styles.fincaOptionDotActive]} />
            <Text style={[styles.fincaOptionLabel, isActive && styles.fincaOptionLabelActive]}>
              {f.label}
            </Text>
            {isActive && (
              <Ionicons name="checkmark" size={18} color={colors.burdeos[600]} />
            )}
          </TouchableOpacity>
        )
      })}

      <View style={styles.footer}>
        <Text style={styles.footerText}>El cambio de finca actualiza los datos al recargar</Text>
      </View>
    </>
  );
}

// ─── Notificaciones view ──────────────────────────────────────────────────────

const NOTIFS = [
  { id: '1', icon: 'water-outline' as const, title: 'Riego programado', body: 'Cabezal 2 — hoy 14:00', time: 'hace 10 min' },
  { id: '2', icon: 'leaf-outline' as const, title: 'Campaña actualizada', body: 'Parral 5 — Floración registrada', time: 'hace 1 h' },
  { id: '3', icon: 'flask-outline' as const, title: 'Carencia vencida', body: 'Karate — Parral 2 habilitado', time: 'hoy 08:00' },
]

function NotifView({ onBack }: { onBack: () => void }) {
  const [read, setRead] = useState<Set<string>>(new Set())

  return (
    <>
      <View style={styles.subHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.subTitle}>Notificaciones</Text>
        <TouchableOpacity onPress={() => setRead(new Set(NOTIFS.map(n => n.id)))}>
          <Text style={styles.subAction}>Leer todas</Text>
        </TouchableOpacity>
      </View>

      {NOTIFS.map((n) => {
        const isRead = read.has(n.id)
        return (
          <TouchableOpacity
            key={n.id}
            style={[styles.notifRow, isRead && styles.notifRowRead]}
            onPress={() => setRead((prev) => new Set([...prev, n.id]))}
            activeOpacity={0.7}
          >
            <View style={[styles.notifIconWrap, isRead && { backgroundColor: colors.hueso }]}>
              <Ionicons name={n.icon} size={16} color={isRead ? colors.niebla : colors.burdeos[600]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.notifTitle, isRead && { color: colors.ink60 }]}>{n.title}</Text>
              <Text style={styles.notifBody}>{n.body}</Text>
            </View>
            <Text style={styles.notifTime}>{n.time}</Text>
          </TouchableOpacity>
        )
      })}

      <View style={styles.footer}>
        <Text style={styles.footerText}>Notificaciones de los últimos 7 días</Text>
      </View>
    </>
  );
}

// ─── Preferencias view ────────────────────────────────────────────────────────

function PrefView({ onBack }: { onBack: () => void }) {
  const [pushEnabled, setPushEnabled] = useState(true)
  const [offlineSync, setOfflineSync] = useState(true)

  return (
    <>
      <View style={styles.subHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.subTitle}>Preferencias</Text>
      </View>

      <Text style={[styles.sectionHeader, { marginTop: space.s4 }]}>NOTIFICACIONES</Text>

      <View style={styles.prefRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.prefLabel}>Notificaciones push</Text>
          <Text style={styles.prefSub}>Alertas de riego y carencia</Text>
        </View>
        <Switch
          value={pushEnabled}
          onValueChange={setPushEnabled}
          trackColor={{ true: colors.burdeos[600], false: colors.niebla }}
          thumbColor={colors.blanco}
        />
      </View>

      <Text style={[styles.sectionHeader, { marginTop: space.s4 }]}>DATOS</Text>

      <View style={styles.prefRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.prefLabel}>Sincronización automática</Text>
          <Text style={styles.prefSub}>Cuando hay conexión disponible</Text>
        </View>
        <Switch
          value={offlineSync}
          onValueChange={setOfflineSync}
          trackColor={{ true: colors.burdeos[600], false: colors.niebla }}
          thumbColor={colors.blanco}
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Las preferencias se guardan localmente</Text>
      </View>
    </>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionHeader}>{children}</Text>;
}

function DrawerItem({ icon, label, badge, danger, onPress }: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  badge?: string
  danger?: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity style={styles.drawerItem} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={danger ? colors.sangre : colors.ink60} />
      <Text style={[styles.drawerItemLabel, danger && { color: colors.sangre, fontWeight: '700' }]}>
        {label}
      </Text>
      {badge && <Text style={styles.badgeSmall}>{badge}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.oro, justifyContent: 'center', alignItems: 'center',
  },
  badgeText: { color: colors.burdeos[600], fontWeight: '800', fontSize: 11 },

  overlay: { flex: 1, backgroundColor: 'rgba(31,26,23,0.4)' },
  drawer: {
    position: 'absolute', top: 0, bottom: 0, right: 0, width: '82%',
    backgroundColor: colors.blanco, padding: space.s5,
    borderTopLeftRadius: radius.lg, borderBottomLeftRadius: radius.lg,
  },

  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    paddingBottom: space.s4, borderBottomWidth: 1, borderBottomColor: colors.hueso,
    marginTop: space.s8,
  },
  bigBadge: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.burdeos[600], justifyContent: 'center', alignItems: 'center',
  },
  bigBadgeText: { color: colors.oro, fontSize: 17, fontWeight: '800' },
  userName: { ...text.h3, color: colors.ink },
  userRole: { ...text.small, color: colors.ink60 },

  sectionHeader: { ...text.micro, color: colors.ink60, marginTop: space.s4, marginBottom: space.s2 },
  fincaCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.s2,
    paddingHorizontal: space.s3, paddingVertical: space.s3,
    borderWidth: 1.5, borderColor: colors.burdeos[600], borderRadius: radius.md,
    backgroundColor: colors.crema,
  },
  fincaName: { flex: 1, ...text.body, fontWeight: '700', color: colors.ink },
  fincaChevron: { ...text.small, color: colors.ink60 },
  campRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.s2,
    paddingHorizontal: space.s3, paddingVertical: space.s3,
    borderWidth: 1, borderColor: colors.hueso, borderRadius: radius.md,
    backgroundColor: colors.blanco,
  },
  campText: { flex: 1, ...text.body, color: colors.ink, fontWeight: '600' },

  divider: { height: 1, backgroundColor: colors.hueso, marginVertical: space.s4 },
  drawerItem: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    paddingVertical: space.s3, paddingHorizontal: space.s2,
    borderRadius: radius.sm,
  },
  drawerItemLabel: { flex: 1, ...text.body, color: colors.ink, fontWeight: '500' },
  badgeSmall: {
    ...text.micro,
    backgroundColor: colors.burdeos[200], color: colors.burdeos[700],
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill,
  },

  footer: { marginTop: 'auto', paddingTop: space.s3, borderTopWidth: 1, borderTopColor: colors.hueso },
  footerText: { ...text.small, color: colors.ink60, fontSize: 11 },

  // Sub-views shared
  subHeader: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    paddingBottom: space.s4, borderBottomWidth: 1, borderBottomColor: colors.hueso,
    marginTop: space.s8,
  },
  backBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.hueso, justifyContent: 'center', alignItems: 'center',
  },
  subTitle: { flex: 1, ...text.h3, color: colors.ink },
  subAction: { ...text.small, color: colors.burdeos[600], fontWeight: '700' },

  // Finca picker
  fincaOption: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    paddingVertical: space.s3, paddingHorizontal: space.s3,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.hueso,
    backgroundColor: colors.blanco, marginBottom: space.s2,
  },
  fincaOptionActive: {
    borderColor: colors.burdeos[600], backgroundColor: colors.crema,
  },
  fincaOptionDot: {
    width: 10, height: 10, borderRadius: 5,
    borderWidth: 2, borderColor: colors.niebla,
  },
  fincaOptionDotActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  fincaOptionLabel: { flex: 1, ...text.body, color: colors.ink, fontWeight: '600' },
  fincaOptionLabelActive: { color: colors.burdeos[600] },

  // Notifications
  notifRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.s3,
    paddingVertical: space.s3, borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  notifRowRead: { opacity: 0.6 },
  notifIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#fef0f2', justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  notifTitle: { ...text.body, color: colors.ink, fontWeight: '700', marginBottom: 2 },
  notifBody: { ...text.small, color: colors.ink60 },
  notifTime: { ...text.micro, color: colors.niebla, flexShrink: 0, marginTop: 2 },

  // Preferences
  prefRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    paddingVertical: space.s3, borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  prefLabel: { ...text.body, color: colors.ink, fontWeight: '600' },
  prefSub: { ...text.small, color: colors.ink60, marginTop: 1 },
});
