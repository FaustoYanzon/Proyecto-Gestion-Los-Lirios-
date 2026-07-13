'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, MapPin, Check } from 'lucide-react'
import { useContextStore } from '@/store/contextStore'
import type { FincaKey } from '@/store/contextStore'

const FINCAS: { key: FincaKey; label: string }[] = [
  { key: 'los_mimbres', label: 'Los Mimbres' },
  { key: 'media_agua',  label: 'Media Agua'  },
  { key: 'caucete',     label: 'Caucete'      },
]

export default function FincaSwitcher() {
  const finca    = useContextStore((s) => s.finca)
  const setFinca = useContextStore((s) => s.setFinca)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const active = FINCAS.find((f) => f.key === finca) ?? FINCAS[0]

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full
                   border-[1.5px] border-[#7a1f2c] bg-[#faf6ec] text-[#7a1f2c]
                   text-sm font-medium hover:bg-[#f0e8d8] transition-colors duration-150"
      >
        <MapPin size={13} strokeWidth={2} />
        <span>{active.label}</span>
        <ChevronDown
          size={13}
          strokeWidth={2}
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 w-52 rounded-[10px]
                     border border-[#fbfaf6] bg-white z-[1000] overflow-hidden"
          style={{ boxShadow: '0 4px 12px rgba(31,26,23,0.08)' }}
        >
          {FINCAS.map((f) => (
            <button
              key={f.key}
              onClick={() => { setFinca(f.key); setOpen(false) }}
              className="flex items-center justify-between w-full px-4 py-3
                         text-sm text-[#1f1a17] hover:bg-[#fbfaf6] transition-colors"
            >
              <span className="font-medium">{f.label}</span>
              {finca === f.key && (
                <Check size={14} strokeWidth={2.5} className="text-[#7a1f2c]" />
              )}
            </button>
          ))}
          <div className="border-t border-[#fbfaf6]">
            <button className="w-full px-4 py-2.5 text-[11px] font-bold uppercase
                               tracking-wider text-[#5a544c] hover:bg-[#fbfaf6] transition-colors">
              Comparar las 3
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
