'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Map,
  DollarSign,
  TrendingDown,
  TrendingUp,
  BarChart3,
  PieChart,
  Sprout,
  ClipboardList,
  Droplets,
  FlaskConical,
  CalendarDays,
  BarChart2,
  HardHat,
  ShoppingBasket,
  Settings,
  Users,
  MapPin,
  LogOut,
  Menu,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { logout } from '@/lib/auth'

type LucideIcon = React.ComponentType<{ size?: number; className?: string }>

type NavLeaf = { href: string; label: string; icon: LucideIcon }
type NavGroup = { label: string; icon: LucideIcon; children: NavLeaf[] }
type NavItem = NavLeaf | NavGroup

function isGroup(item: NavItem): item is NavGroup {
  return 'children' in item
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
  { href: '/dashboard/mapa', label: 'Mapa de Finca', icon: Map },
  {
    label: 'Finanzas',
    icon: DollarSign,
    children: [
      { href: '/dashboard/finanzas/egresos', label: 'Egresos', icon: TrendingDown },
      { href: '/dashboard/finanzas/ingresos', label: 'Ingresos', icon: TrendingUp },
      { href: '/dashboard/finanzas/flujo', label: 'Flujo Anual', icon: BarChart3 },
      { href: '/dashboard/finanzas/dashboard', label: 'Dashboard', icon: PieChart },
    ],
  },
  {
    label: 'Producción',
    icon: Sprout,
    children: [
      { href: '/dashboard/produccion/tareas', label: 'Tarea Diaria', icon: ClipboardList },
      { href: '/dashboard/produccion/riego', label: 'Riego', icon: Droplets },
      { href: '/dashboard/produccion/fitosanitarios', label: 'Fitosanitarios', icon: FlaskConical },
      { href: '/dashboard/produccion/campana', label: 'Ciclo Campaña', icon: CalendarDays },
      { href: '/dashboard/produccion/mano-de-obra', label: 'Mano de Obra', icon: HardHat },
      { href: '/dashboard/produccion/cosecha', label: 'Cosecha', icon: ShoppingBasket },
      { href: '/dashboard/produccion/dashboard', label: 'Dashboard', icon: BarChart2 },
    ],
  },
  {
    label: 'Administración',
    icon: Settings,
    children: [
      { href: '/dashboard/admin/usuarios', label: 'Usuarios', icon: Users },
      { href: '/dashboard/admin/parcelas', label: 'Parcelas', icon: MapPin },
    ],
  },
]

function Sidebar({ onNavClick }: { onNavClick?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const clearUser = useAuthStore((state) => state.clearUser)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  function handleLogout() {
    logout()
    clearUser()
    router.push('/login')
  }

  function toggleGroup(label: string) {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  function isGroupOpen(group: NavGroup): boolean {
    const hasActiveChild = group.children.some((c) => pathname.startsWith(c.href))
    return hasActiveChild || !!openGroups[group.label]
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-gray-100">
        <span className="text-base font-semibold text-gray-900">Los Lirios SA</span>
      </div>

      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            if (!isGroup(item)) {
              const active =
                pathname === item.href ||
                (item.href !== '/dashboard' && pathname.startsWith(item.href))
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavClick}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    active
                      ? 'bg-green-50 text-green-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <item.icon size={18} />
                  {item.label}
                </Link>
              )
            }

            const open = isGroupOpen(item)
            const groupActive = item.children.some((c) => pathname.startsWith(c.href))

            return (
              <div key={item.label}>
                <button
                  onClick={() => toggleGroup(item.label)}
                  className={`flex items-center w-full gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    groupActive
                      ? 'text-green-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <item.icon size={18} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                {open && (
                  <div className="mt-0.5 space-y-0.5">
                    {item.children.map((child) => {
                      const active = pathname.startsWith(child.href)
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onNavClick}
                          className={`flex items-center gap-3 pl-8 pr-3 py-2 rounded-md text-sm font-medium transition-colors ${
                            active
                              ? 'bg-green-50 text-green-700'
                              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                          }`}
                        >
                          <child.icon size={16} />
                          {child.label}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </nav>

      <div className="px-3 py-4 border-t border-gray-100">
        <div className="px-3 py-2 mb-1">
          <p className="text-sm font-medium text-gray-900 truncate">
            {user?.full_name ?? '—'}
          </p>
          <p className="text-xs text-gray-500 truncate">{user?.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          <LogOut size={18} />
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div
      className="flex h-screen overflow-hidden bg-gray-50"
      style={{ backgroundColor: '#f9fafb' }}
    >
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 flex-shrink-0 bg-white border-r border-gray-200">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <aside
            className="absolute left-0 top-0 bottom-0 w-60 bg-white shadow-xl z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <Sidebar onNavClick={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100"
          >
            <Menu size={20} />
          </button>
          <span className="text-base font-semibold text-gray-900">Los Lirios SA</span>
        </header>

        <main
          className="flex-1 overflow-y-auto p-6 bg-gray-50"
          style={{ backgroundColor: '#f9fafb' }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
