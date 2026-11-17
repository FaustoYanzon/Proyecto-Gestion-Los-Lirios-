'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'

// Index of Inventarios: each role lands on the tab it can use.
export default function InventariosIndexPage() {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const isLoading = useAuthStore((s) => s.isLoading)

  useEffect(() => {
    // Wait for the store: an undefined role must not send everyone to Insumos.
    if (isLoading || !user) return
    router.replace(
      user.role === 'encargado'
        ? '/dashboard/inventarios/alfalfa'
        : '/dashboard/inventarios/insumos'
    )
  }, [isLoading, user, router])

  return null
}
