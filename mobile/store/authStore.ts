import { create } from 'zustand'
import { fetchCurrentUser, logout as authLogout } from '../lib/auth'
import type { User } from '../lib/types'
import { useFincaStore, FINCAS } from './fincaStore'

interface AuthState {
  user: User | null
  isLoading: boolean
  setUser: (user: User | null) => void
  clearUser: () => void
  initAuth: () => Promise<void>
  logout: () => Promise<void>
}

// encargado/regador/obrero ven la finca fija que les asignó el gerencial al
// crearlos (User.finca) — no tienen selector propio en mobile, así que en
// cada login se fuerza su finca asignada por si quedó otra cosa guardada en
// AsyncStorage de una sesión previa. Gerencial y super_admin no se tocan acá
// — mantienen lo que ya haya restaurado loadFinca() (su última elección
// manual), User.finca es solo el default inicial de esa restauración.
function seedFincaFromUser(user: User) {
  if (user.role === 'gerencial' || user.role === 'super_admin') return
  const finca = FINCAS.find((f) => f.key === user.finca) ?? FINCAS[0]
  useFincaStore.setState({ active: finca })
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
  initAuth: async () => {
    set({ isLoading: true })
    const user = await fetchCurrentUser()
    if (user) seedFincaFromUser(user)
    set({ user, isLoading: false })
  },
  logout: async () => {
    await authLogout()
    set({ user: null, isLoading: false })
  },
}))
