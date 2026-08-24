'use client'

import { useEffect } from 'react'
import { Command } from 'cmdk'
import { useRouter } from 'next/navigation'
import {
  LayoutDashboard, Sprout, DollarSign, Settings, BookOpen, Search,
} from 'lucide-react'
import { ALL_NAV, SUB_NAVS, type LucideIcon } from '@/lib/navigation'

type CmdItem = { label: string; href: string; icon: LucideIcon; group: string }

// Ícono + etiqueta de grupo por prefijo de ruta — un ítem nuevo agregado a
// SUB_NAVS/ALL_NAV (frontend/lib/navigation.ts) aparece acá solo, sin tocar
// este archivo, así este buscador no se vuelve a desincronizar de la nav real.
const GROUP_META: Record<string, { label: string; icon: LucideIcon }> = {
  '/dashboard/produccion':    { label: 'Producción',    icon: Sprout },
  '/dashboard/finanzas':      { label: 'Finanzas',      icon: DollarSign },
  '/dashboard/admin':         { label: 'Admin',         icon: Settings },
  '/dashboard/documentacion': { label: 'Documentación', icon: BookOpen },
}

const TOP_LEVEL_ITEMS: CmdItem[] = ALL_NAV
  .filter((item) => !SUB_NAVS.some((sn) => item.href.startsWith(sn.prefix)))
  .map((item) => ({ label: item.label, href: item.href, icon: item.icon, group: 'Navegación' }))

const SUB_NAV_ITEMS: CmdItem[] = SUB_NAVS.flatMap((sn) => {
  const meta = GROUP_META[sn.prefix] ?? { label: sn.prefix, icon: LayoutDashboard }
  return sn.items.map((item) => ({ label: item.label, href: item.href, icon: meta.icon, group: meta.label }))
})

const CMD_ITEMS: CmdItem[] = [...TOP_LEVEL_ITEMS, ...SUB_NAV_ITEMS]

const GROUPS = ['Navegación', 'Producción', 'Finanzas', 'Admin', 'Documentación']

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
                placeholder="Buscar sección…"
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
                        value={`${item.group} ${item.label}`}
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
