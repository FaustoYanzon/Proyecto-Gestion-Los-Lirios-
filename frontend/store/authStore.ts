import { create } from 'zustand'
import { getMe, getToken, logout } from '@/lib/auth'
import type { User } from '@/lib/auth'

interface AuthState {
  user: User | null
  isLoading: boolean
  setUser: (user: User) => void
  clearUser: () => void
  initAuth: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  setUser: (user) => set({ user, isLoading: false }),
  clearUser: () => set({ user: null, isLoading: false }),
  initAuth: async () => {
    if (!getToken()) {
      set({ user: null, isLoading: false })
      return
    }
    try {
      const user = await getMe()
      set({ user, isLoading: false })
    } catch {
      logout()
      set({ user: null, isLoading: false })
    }
  },
}))
