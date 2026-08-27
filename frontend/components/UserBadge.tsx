'use client'

import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import PerfilModal from '@/components/PerfilModal'

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function UserBadge() {
  const user = useAuthStore((s) => s.user)
  const [open, setOpen] = useState(false)
  const initials = user ? getInitials(user.full_name) : '?'

  return (
    <>
      <button
        aria-label="Mi perfil"
        onClick={() => setOpen(true)}
        className="flex items-center justify-center w-8 h-8 rounded-full
                   text-xs font-extrabold transition-opacity hover:opacity-80 flex-shrink-0 overflow-hidden"
        style={{ backgroundColor: '#c89a3a', color: '#7a1f2c' }}
      >
        {user?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          initials
        )}
      </button>
      {open && <PerfilModal onClose={() => setOpen(false)} />}
    </>
  )
}
