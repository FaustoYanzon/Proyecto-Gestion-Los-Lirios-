'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Map, Sprout, DollarSign,
  Settings, Bell, LogOut,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { logout } from '@/lib/auth'
import type { Role } from '@/lib/theme'
import FincaSwitcher from '@/components/FincaSwitcher'
import CampanaSwitcher from '@/components/CampanaSwitcher'
import UserBadge from '@/components/UserBadge'
import CommandPalette from '@/components/CommandPalette'

type LucideIcon = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; color?: string }>

type NavItem = {
  href: string
  label: string
  short: string
  icon: LucideIcon
  matchFn: (path: string) => boolean
  allowedRoles?: Role[]
}

const ALL_NAV: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Inicio',
    short: 'Inicio',
    icon: LayoutDashboard,
    matchFn: (p) => p === '/dashboard',
  },
  {
    href: '/dashboard/mapa',
    label: 'Mapa',
    short: 'Mapa',
    icon: Map,
    matchFn: (p) => p.startsWith('/dashboard/mapa'),
  },
  {
    href: '/dashboard/produccion/tareas',
    label: 'Producción',
    short: 'Prod.',
    icon: Sprout,
    matchFn: (p) =>
      p.startsWith('/dashboard/produccion') &&
      !p.startsWith('/dashboard/produccion/dashboard'),
  },
  {
    href: '/dashboard/finanzas/egresos',
    label: 'Finanzas',
    short: 'Finanzas',
    icon: DollarSign,
    matchFn: (p) => p.startsWith('/dashboard/finanzas'),
    allowedRoles: ['super_admin', 'gerencial'],
  },
  {
    href: '/dashboard/admin/usuarios',
    label: 'Admin',
    short: 'Admin',
    icon: Settings,
    matchFn: (p) => p.startsWith('/dashboard/admin'),
    allowedRoles: ['super_admin', 'gerencial'],
  },
]

type SubNav = { prefix: string; items: { href: string; label: string }[] }

const SUB_NAVS: SubNav[] = [
  {
    prefix: '/dashboard/produccion',
    items: [
      { href: '/dashboard/produccion/tareas',         label: 'Tareas'         },
      { href: '/dashboard/produccion/riego',          label: 'Riego'          },
      { href: '/dashboard/produccion/fitosanitarios', label: 'Fitosanitarios' },
      { href: '/dashboard/produccion/campana',        label: 'Campaña'        },
      { href: '/dashboard/produccion/cosecha',        label: 'Cosecha'        },
      { href: '/dashboard/produccion/metas',          label: 'Metas'          },
      { href: '/dashboard/produccion/dashboard',      label: 'Dashboard Producción' },
    ],
  },
  {
    prefix: '/dashboard/finanzas',
    items: [
      { href: '/dashboard/finanzas/egresos',     label: 'Egresos'     },
      { href: '/dashboard/finanzas/ingresos',    label: 'Ingresos'    },
      { href: '/dashboard/finanzas/presupuesto',  label: 'Presupuesto'  },
      { href: '/dashboard/finanzas/dashboard',    label: 'Dashboard'    },
      { href: '/dashboard/finanzas/mano-de-obra', label: 'Mano de Obra' },
      { href: '/dashboard/finanzas/flujo',        label: 'Flujo Anual'  },
    ],
  },
  {
    prefix: '/dashboard/admin',
    items: [
      { href: '/dashboard/admin/usuarios', label: 'Usuarios' },
      { href: '/dashboard/admin/parcelas', label: 'Parcelas' },
    ],
  },
]

function SidebarItem({ item, isActive }: { item: NavItem; isActive: boolean }) {
  const iconColor  = isActive ? '#FFFFFF' : 'rgba(255,255,255,0.55)'
  const labelColor = isActive ? '#FFFFFF' : 'rgba(255,255,255,0.55)'

  return (
    <Link
      href={item.href}
      title={item.label}
      className={`flex flex-col items-center justify-center gap-1 w-14 py-2.5 rounded-xl mx-auto
                  transition-colors duration-150 ${
                    isActive ? 'hover:bg-white/20' : 'hover:bg-white/10'
                  }`}
      style={{ backgroundColor: isActive ? 'rgba(255,255,255,0.12)' : undefined }}
    >
      <item.icon size={20} strokeWidth={1.5} color={iconColor} />
      <span
        className="text-[9px] font-bold uppercase tracking-wide leading-none"
        style={{ color: labelColor }}
      >
        {item.short}
      </span>
    </Link>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname()
  const router    = useRouter()
  const user      = useAuthStore((s) => s.user)
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

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* Sidebar 68px */}
      <aside
        className="flex flex-col w-[68px] flex-shrink-0 py-3 items-center gap-1"
        style={{ backgroundColor: '#7a1f2c' }}
      >
        {/* Logo mark */}
        <Link
          href="/dashboard"
          className="flex items-center justify-center w-14 h-11 mb-3"
          aria-label="Inicio"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-mark.svg"
            alt=""
            width={26}
            height={26}
            style={{ filter: 'brightness(0) invert(1)' }}
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
          className="flex flex-col items-center justify-center gap-1 w-14 py-2.5 rounded-xl
                     hover:bg-white/10 transition-colors duration-150 mb-1"
        >
          <LogOut size={20} strokeWidth={1.5} color="rgba(255,255,255,0.55)" />
          <span className="text-[9px] font-bold uppercase tracking-wide leading-none" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Salir
          </span>
        </button>
      </aside>

      {/* Right column */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Topbar 56px */}
        <header
          className="flex items-center gap-3 h-14 px-4 flex-shrink-0 border-b bg-white"
          style={{ borderColor: '#fbfaf6' }}
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
              style={{ borderColor: '#fbfaf6' }}
            >
              <span className="flex-1 text-left">Buscar...</span>
              <kbd className="text-xs font-mono border border-[#a09584]/30 rounded px-1.5 py-0.5 bg-[#fbfaf6]">
                ⌘K
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-[#5a544c]" aria-label="Clima">☀ 22°</span>
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
            style={{ borderColor: '#fbfaf6', backgroundColor: '#ffffff' }}
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
