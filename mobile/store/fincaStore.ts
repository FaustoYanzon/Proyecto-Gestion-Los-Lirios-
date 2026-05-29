import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

export const FINCAS = [
  { key: 'los_mimbres', label: 'Los Mimbres' },
  { key: 'media_agua',  label: 'Media Agua'  },
  { key: 'caucete',     label: 'Caucete'     },
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

export async function loadFinca(): Promise<void> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null)
  if (stored) {
    const finca = FINCAS.find((f) => f.key === stored)
    if (finca) useFincaStore.setState({ active: finca })
  }
}
