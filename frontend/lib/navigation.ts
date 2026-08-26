import {
  LayoutDashboard, Map, Sprout, DollarSign, Settings, BookOpen,
} from 'lucide-react'
import type { Role } from '@/lib/theme'

export type LucideIcon = React.ComponentType<{
  size?: number
  strokeWidth?: number
  className?: string
  color?: string
  style?: React.CSSProperties
}>

export type NavItem = {
  href: string
  label: string
  short: string
  icon: LucideIcon
  matchFn: (path: string) => boolean
  allowedRoles?: Role[]
}

export const ALL_NAV: NavItem[] = [
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
    href: '/dashboard/documentacion/parcelas',
    label: 'Documentación',
    short: 'Docs',
    icon: BookOpen,
    matchFn: (p) => p.startsWith('/dashboard/documentacion'),
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

export type SubNav = { prefix: string; items: { href: string; label: string }[] }

export const SUB_NAVS: SubNav[] = [
  {
    prefix: '/dashboard/produccion',
    items: [
      { href: '/dashboard/produccion/tareas',         label: 'Tareas'         },
      { href: '/dashboard/produccion/riego',          label: 'Riego'          },
      { href: '/dashboard/produccion/fitosanitarios', label: 'Fitosanitarios' },
      { href: '/dashboard/produccion/campana',        label: 'Campaña'        },
      { href: '/dashboard/produccion/cosecha',        label: 'Cosecha'        },
      { href: '/dashboard/produccion/metas',          label: 'Metas'          },
      { href: '/dashboard/produccion/clima',          label: 'Clima'          },
      { href: '/dashboard/produccion/dashboard',      label: 'Dashboard Producción' },
    ],
  },
  {
    prefix: '/dashboard/finanzas',
    items: [
      { href: '/dashboard/finanzas/egresos',     label: 'Egresos'     },
      { href: '/dashboard/finanzas/ingresos',    label: 'Ingresos'    },
      { href: '/dashboard/finanzas/cheques',      label: 'Cheques'      },
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
      { href: '/dashboard/admin/notificaciones', label: 'Notificaciones' },
    ],
  },
  {
    prefix: '/dashboard/documentacion',
    items: [
      { href: '/dashboard/documentacion/parcelas',     label: 'Parcelas'     },
      { href: '/dashboard/documentacion/trabajadores', label: 'Trabajadores' },
      { href: '/dashboard/documentacion/riego',        label: 'Riego'        },
      { href: '/dashboard/documentacion/precios',      label: 'Precios'      },
      { href: '/dashboard/documentacion/melgas',       label: 'Melgas'       },
      { href: '/dashboard/documentacion/empresa',      label: 'Empresa'      },
    ],
  },
]
