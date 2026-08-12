'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getTrabajadores } from '@/lib/api/trabajadores'

interface Props {
  value: string
  trabajadorId?: string
  onChange: (nombre: string, trabajadorId?: string) => void
  className: string
  error?: string
}

export default function ResponsableInput({ value, trabajadorId, onChange, className, error }: Props) {
  const [focused, setFocused] = useState(false)

  const { data: trabajadoresDb = [] } = useQuery({
    queryKey: ['trabajadores'],
    queryFn: getTrabajadores,
    staleTime: 60_000,
  })

  const matches =
    focused && value.trim() && !trabajadorId
      ? trabajadoresDb
          .filter((t) => t.nombre_completo.toLowerCase().includes(value.trim().toLowerCase()))
          .slice(0, 5)
      : []

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Nombre..."
        value={value}
        onChange={(e) => onChange(e.target.value, undefined)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        className={className}
      />
      {matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-md max-h-40 overflow-y-auto">
          {matches.map((t) => (
            <button
              type="button"
              key={t.id}
              onMouseDown={() => {
                onChange(t.nombre_completo, t.id)
                setFocused(false)
              }}
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              {t.nombre_completo}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
