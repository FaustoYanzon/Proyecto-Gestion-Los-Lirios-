'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/store/authStore'

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  }))

  // Validate any existing token (localStorage) against the backend on first mount.
  // Without this, useAuthStore never leaves its initial { user: null, isLoading: true }
  // state on a hard reload or new tab — the dashboard guard would then be stuck loading
  // forever, or would treat a valid session as logged out.
  const initAuth = useAuthStore((state) => state.initAuth)
  const initialized = useRef(false)

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      initAuth()
    }
  }, [initAuth])

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
