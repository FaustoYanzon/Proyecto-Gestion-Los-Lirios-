'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Calendar, Check } from 'lucide-react'
import { useContextStore } from '@/store/contextStore'

function buildCampanas(): string[] {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth() + 1
  const base  = month >= 5 ? year : year - 1
  return [
    `${base}/${base + 1}`,
    `${base - 1}/${base}`,
    `${base - 2}/${base - 1}`,
  ]
}

export default function CampanaSwitcher() {
  const campana    = useContextStore((s) => s.campana)
  const setCampana = useContextStore((s) => s.setCampana)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const campanas = buildCampanas()

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
                   border-[1.5px] border-[#c89a3a] bg-[#faf6ec] text-[#5a544c]
                   text-sm font-medium hover:bg-[#f0e8d8] transition-colors duration-150"
      >
        <Calendar size={13} strokeWidth={2} />
        <span
          className="font-mono text-[#5a1320]"
          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
        >
          {campana}
        </span>
        <ChevronDown
          size={13}
          strokeWidth={2}
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 w-44 rounded-[10px]
                     border border-[#fbfaf6] bg-white z-50 overflow-hidden"
          style={{ boxShadow: '0 4px 12px rgba(31,26,23,0.08)' }}
        >
          {campanas.map((c) => (
            <button
              key={c}
              onClick={() => { setCampana(c); setOpen(false) }}
              className="flex items-center justify-between w-full px-4 py-3
                         text-sm text-[#1f1a17] hover:bg-[#fbfaf6] transition-colors"
            >
              <span
                className="font-mono"
                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
              >
                {c}
              </span>
              {campana === c && (
                <Check size={14} strokeWidth={2.5} className="text-[#7a1f2c]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
