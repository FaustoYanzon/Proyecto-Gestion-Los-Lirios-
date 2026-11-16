import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

export const FINCAS = [
  { key: 'los_mimbres', label: 'Los Mimbres' },
  { key: 'media_agua',  label: 'Media Agua'  },
] as const

export type FincaKey = (typeof FINCAS)[number]['key']
export type FincaItem = (typeof FINCAS)[number]

const STORAGE_KEY = 'active_finca'

interface FincaState {
  active: FincaItem
  setFinca: (key: FincaKey) => void
}

export const useFincaStore = create<FincaState>((set) => ({
  active: FINCAS[0],
  setFinca: (key) => {
    const finca = FINCAS.find((f) => f.key === key) ?? FINCAS[0]
    set({ active: finca })
    AsyncStorage.setItem(STORAGE_KEY, key).catch(() => {})
  },
}))

// Only gerencial/super_admin pick their own finca; every other role is pinned to
// User.finca by authStore. Restoring the stored value for them would overwrite
// that assignment with whatever another user left on a shared phone.
// The role is a parameter (not read from authStore) to avoid an import cycle.
export async function loadFinca(role: string | undefined): Promise<void> {
  if (role !== 'gerencial' && role !== 'super_admin') return
  const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null)
  // Nothing stored: reset so a previous user's finca (shared phone) is not inherited.
  const finca = FINCAS.find((f) => f.key === stored) ?? FINCAS[0]
  useFincaStore.setState({ active: finca })
}
