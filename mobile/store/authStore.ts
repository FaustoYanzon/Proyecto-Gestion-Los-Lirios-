import { create } from 'zustand'
import { fetchCurrentUser, logout as authLogout } from '../lib/auth'
import type { User } from '../lib/types'

interface AuthState {
  user: User | null
  isLoading: boolean
  setUser: (user: User | null) => void
  clearUser: () => void
  initAuth: () => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  clearUser: () => set({ user: null }),
  initAuth: async () => {
    set({ isLoading: true })
    const user = await fetchCurrentUser()
    set({ user, isLoading: false })
  },
  logout: async () => {
    await authLogout()
    set({ user: null, isLoading: false })
  },
}))
