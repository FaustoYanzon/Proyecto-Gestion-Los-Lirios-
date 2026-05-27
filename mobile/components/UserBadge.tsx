// mobile/components/UserBadge.tsx
// Círculo de iniciales arriba a la derecha del header. Al tocarlo abre el drawer.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, space, radius, text, getInitials, ROLE_LABELS } from '../lib/theme';
import { useAuthStore } from '../store/authStore';
// Si tenés un store de finca activa, importarlo aquí:
// import { useFincaStore } from '../store/fincaStore';
import { logout } from '../lib/auth';

export function UserBadge() {
  const user = useAuthStore(s => s.user);
  const [open, setOpen] = useState(false);

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
        <TouchableOpacity style={styles.fincaCard} onPress={() => { /* TODO: open finca switcher */ }}>
          <Ionicons name="location" size={18} color={colors.burdeos[600]} />
          <Text style={styles.fincaName}>Los Mimbres</Text>
          <Text style={styles.fincaChevron}>cambiar ▾</Text>
        </TouchableOpacity>

        <SectionHeader>CAMPAÑA</SectionHeader>
        <TouchableOpacity style={styles.campRow}>
          <Ionicons name="calendar" size={18} color={colors.ink60} />
          <Text style={styles.campText}>Campaña 25/26 · día 27</Text>
          <Text style={styles.fincaChevron}>▾</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <DrawerItem icon="person-outline" label="Mi perfil" onPress={() => { onClose(); router.push('/(tabs)/perfil'); }} />
        <DrawerItem icon="notifications-outline" label="Notificaciones" badge="3" onPress={() => {}} />
        <DrawerItem icon="settings-outline" label="Preferencias" onPress={() => {}} />
        <DrawerItem icon="cloud-offline-outline" label="Modo offline" badge="sincr." onPress={() => {}} />
        <DrawerItem icon="log-out-outline" label="Cerrar sesión" danger onPress={handleLogout} />

        <View style={styles.footer}>
          <Text style={styles.footerText}>Los Lirios SA · v1.0.0</Text>
          <Text style={styles.footerText}>última sync · hace 2 min</Text>
        </View>
      </View>
    </Modal>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionHeader}>{children}</Text>;
}

function DrawerItem({ icon, label, badge, danger, onPress }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  badge?: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.drawerItem} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={danger ? colors.sangre : colors.ink60} />
      <Text style={[styles.drawerItemLabel, danger && { color: colors.sangre, fontWeight: '700' }]}>{label}</Text>
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
});
