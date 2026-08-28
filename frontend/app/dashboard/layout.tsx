'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { logout } from '@/lib/auth'
import type { Role } from '@/lib/theme'
import { ALL_NAV, SUB_NAVS, type NavItem } from '@/lib/navigation'
import FincaSwitcher from '@/components/FincaSwitcher'
import CampanaSwitcher from '@/components/CampanaSwitcher'
import UserBadge from '@/components/UserBadge'
import CommandPalette from '@/components/CommandPalette'
import { ClimateMini } from '@/components/ClimateWidget'

function Tooltip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="absolute left-full ml-2 px-2 py-1 rounded-md text-white text-[11px]
                 whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible
                 transition-opacity duration-150 delay-[120ms] pointer-events-none z-50"
      style={{ backgroundColor: '#1f1a17' }}
    >
      {children}
    </span>
  )
}

function SidebarItem({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const iconColor = isActive ? '#7a1f2c' : 'rgba(255,255,255,0.82)'

  return (
    <Link
      href={item.href}
      title={item.label}
      className={`group relative flex items-center justify-center w-10 h-10 rounded-[10px] mx-auto
                  transition-colors duration-150 ${isActive ? '' : 'hover:bg-white/10'}`}
      style={{ backgroundColor: isActive ? '#FFFFFF' : undefined }}
    >
      <item.icon size={20} strokeWidth={1.5} color={iconColor} />
      <Tooltip>{item.label}</Tooltip>
    </Link>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname()
  const router    = useRouter()
  const user      = useAuthStore((s) => s.user)
  const isLoading = useAuthStore((s) => s.isLoading)
  const clearUser = useAuthStore((s) => s.clearUser)
  const [cmdOpen, setCmdOpen] = useState(false)

  const role     = user?.role as Role | undefined
  const subNav   = SUB_NAVS.find((s) => pathname.startsWith(s.prefix))
  const navItems = ALL_NAV.filter(
    (item) => !item.allowedRoles || (role && item.allowedRoles.includes(role))
  )

  function handleLogout() {
    logout()
    clearUser()
    router.push('/login')
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Auth guard: without this, an expired/missing token left the user stranded
  // on the current URL with a half-rendered dashboard instead of being sent to /login.
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login')
    }
  }, [isLoading, user, router])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div
          className="h-8 w-8 rounded-full border-2 border-[#e2dbcc] animate-spin"
          style={{ borderTopColor: '#7a1f2c' }}
          role="status"
          aria-label="Cargando"
        />
      </div>
    )
  }

  if (!user) {
    // Redirect is in flight (see effect above) — render nothing to avoid a content flash.
    return null
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* Sidebar 56px */}
      <aside
        className="flex flex-col w-[56px] flex-shrink-0 py-3 items-center gap-1"
        style={{ backgroundColor: '#7a1f2c' }}
      >
        {/* Logo mark */}
        <Link
          href="/dashboard"
          className="flex items-center justify-center w-10 h-10 mb-3"
          aria-label="Inicio"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-reducido.svg"
            alt=""
            width={26}
            height={26}
          />
        </Link>

        {/* Nav items */}
        <nav className="flex flex-col gap-0.5 flex-1 w-full px-1">
          {navItems.map((item) => (
            <SidebarItem
              key={item.href}
              item={item}
              isActive={item.matchFn(pathname)}
            />
          ))}
        </nav>

        {/* Logout */}
        <button
          onClick={handleLogout}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
          className="group relative flex items-center justify-center w-10 h-10 rounded-[10px]
                     hover:bg-white/10 transition-colors duration-150 mb-1"
        >
          <LogOut size={20} strokeWidth={1.5} color="rgba(255,255,255,0.82)" />
          <Tooltip>Cerrar sesión</Tooltip>
        </button>
      </aside>

      {/* Right column */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar 56px */}
        <header
          className="flex items-center gap-3 h-14 px-4 flex-shrink-0 border-b bg-white"
          style={{ borderColor: '#e2dbcc' }}
        >
          <div className="flex items-center gap-2">
            <FincaSwitcher />
            <CampanaSwitcher />
          </div>

          <div className="flex-1 flex justify-center">
            <button
              onClick={() => setCmdOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border
                         text-sm text-[#a09584] hover:bg-[#fbfaf6]
                         transition-colors duration-150 min-w-[200px]"
              style={{ borderColor: '#e2dbcc' }}
            >
              <span className="flex-1 text-left">Buscar...</span>
              <kbd className="text-xs font-mono border border-[#a09584]/30 rounded px-1.5 py-0.5 bg-[#fbfaf6]">
                ⌘K
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <ClimateMini />
            <button
              aria-label="Notificaciones"
              className="flex items-center justify-center w-8 h-8 rounded-lg
                         text-[#5a544c] hover:bg-[#fbfaf6] transition-colors"
            >
              <Bell size={18} strokeWidth={1.75} />
            </button>
            <UserBadge />
          </div>
        </header>

        {/* Sub-nav tabs — módulos con sub-secciones */}
        {subNav && (
          <div
            className="flex items-end gap-1 px-4 border-b flex-shrink-0"
            style={{ borderColor: '#e2dbcc', backgroundColor: '#ffffff' }}
          >
            {subNav.items.map((tab) => {
              const active = pathname.startsWith(tab.href)
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`flex items-center h-10 px-3 text-sm font-medium border-b-2
                              transition-colors duration-150 whitespace-nowrap ${
                                active
                                  ? 'text-[#7a1f2c] border-[#7a1f2c]'
                                  : 'text-[#5a544c] border-transparent hover:text-[#1f1a17]'
                              }`}
                >
                  {tab.label}
                </Link>
              )
            })}
          </div>
        )}

        {/* Canvas */}
        <main className="flex-1 overflow-y-auto bg-white p-6">
          {children}
        </main>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  )
}
