'use client'

import { useEffect } from 'react'
import { Command } from 'cmdk'
import { useRouter } from 'next/navigation'
import {
  LayoutDashboard, Map, Sprout, Droplets, FlaskConical,
  DollarSign, TrendingDown, TrendingUp, ClipboardList, Settings, Search,
} from 'lucide-react'

type LucideIcon = React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties }>

type CmdItem = { label: string; href: string; icon: LucideIcon; group: string }

const CMD_ITEMS: CmdItem[] = [
  { label: 'Inicio',              href: '/dashboard',                          icon: LayoutDashboard, group: 'Navegación'  },
  { label: 'Mapa de Finca',       href: '/dashboard/mapa',                     icon: Map,             group: 'Navegación'  },
  { label: 'Tareas del día',      href: '/dashboard/produccion/tareas',         icon: Sprout,          group: 'Producción'  },
  { label: 'Riego',               href: '/dashboard/produccion/riego',          icon: Droplets,        group: 'Producción'  },
  { label: 'Fitosanitarios',      href: '/dashboard/produccion/fitosanitarios', icon: FlaskConical,    group: 'Producción'  },
  { label: 'Dashboard financiero',href: '/dashboard/finanzas/dashboard',        icon: DollarSign,      group: 'Finanzas'    },
  { label: 'Egresos',             href: '/dashboard/finanzas/egresos',          icon: TrendingDown,    group: 'Finanzas'    },
  { label: 'Ingresos',            href: '/dashboard/finanzas/ingresos',         icon: TrendingUp,      group: 'Finanzas'    },
  { label: 'Registros campaña',   href: '/dashboard/produccion/dashboard',      icon: ClipboardList,   group: 'Registros'   },
  { label: 'Usuarios',            href: '/dashboard/admin/usuarios',            icon: Settings,        group: 'Admin'       },
]

const GROUPS = ['Navegación', 'Producción', 'Finanzas', 'Registros', 'Admin']

interface Props {
  open: boolean
  onClose: () => void
}

export default function CommandPalette({ open, onClose }: Props) {
  const router = useRouter()

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function navigate(href: string) {
    router.push(href)
    onClose()
  }

  return (
    <>
      <style>{`
        [data-cmdk-group-heading] {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #a09584;
          padding: 8px 12px 4px;
        }
        [data-cmdk-item] {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          color: #1f1a17;
          transition: background 100ms ease-out;
        }
        [data-cmdk-item][aria-selected="true"] {
          background: #fbfaf6;
        }
        [data-cmdk-group]:not(:first-child) {
          border-top: 1px solid #fbfaf6;
          margin-top: 4px;
          padding-top: 4px;
        }
      `}</style>

      <div
        className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
        style={{ backgroundColor: 'rgba(31,26,23,0.4)' }}
        onClick={onClose}
      >
        <div
          className="w-full max-w-lg overflow-hidden"
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '14px',
            boxShadow: '0 12px 32px rgba(31,26,23,0.12)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Command>
            <div
              className="flex items-center gap-2 px-4 border-b"
              style={{ borderColor: '#fbfaf6' }}
            >
              <Search size={16} strokeWidth={1.75} style={{ color: '#a09584', flexShrink: 0 }} />
              <Command.Input
                autoFocus
                placeholder="Buscar sección, tarea, parcela…"
                className="flex-1 h-12 text-sm bg-transparent outline-none"
                style={{ color: '#1f1a17' }}
              />
            </div>

            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty
                className="py-8 text-center text-sm"
                style={{ color: '#a09584' }}
              >
                Sin resultados.
              </Command.Empty>

              {GROUPS.map((group) => {
                const items = CMD_ITEMS.filter((i) => i.group === group)
                if (items.length === 0) return null
                return (
                  <Command.Group key={group} heading={group}>
                    {items.map((item) => (
                      <Command.Item
                        key={item.href}
                        value={item.label}
                        onSelect={() => navigate(item.href)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <item.icon size={15} strokeWidth={1.75} style={{ color: '#5a544c', flexShrink: 0 }} />
                          <span>{item.label}</span>
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )
              })}
            </Command.List>
          </Command>
        </div>
      </div>
    </>
  )
}
