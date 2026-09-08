'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { getTrabajadores, createTrabajador, type TrabajadorResponse } from '@/lib/api/trabajadores'

interface Props {
  value: string
  trabajadorId?: string
  onChange: (nombre: string, trabajadorId?: string) => void
  className: string
  error?: string
}

// Rango Unicode "Combining Diacritical Marks" (U+0300–U+036F), construido por
// code point para no depender de que el archivo se re-guarde siempre en UTF-8.
const DIACRITICS_RE = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g'
)

function normalizar(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .trim()
    .toLowerCase()
}

// Elegir de la lista existente es obligatorio -- ya no se acepta texto libre
// como trabajador (causaba duplicados silenciosos, ver
// scripts/normalizar_trabajadores.py). Si de verdad no está, "+ Agregar
// nuevo trabajador" pide confirmar con un aviso de los nombres más
// parecidos antes de crearlo (doble verificación).
export default function TrabajadorSelect({ value, trabajadorId, onChange, className, error }: Props) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [addMode, setAddMode] = useState(false)
  const [addName, setAddName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data: trabajadoresDb = [] } = useQuery({
    queryKey: ['trabajadores'],
    queryFn: getTrabajadores,
    staleTime: 60_000,
  })

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setAddMode(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const trimmed = value.trim()
  const matches = trimmed
    ? trabajadoresDb.filter((t) => normalizar(t.nombre_completo).includes(normalizar(trimmed))).slice(0, 6)
    : trabajadoresDb.slice(0, 6)

  const parecidos = addMode
    ? trabajadoresDb.filter((t) => {
        const a = normalizar(t.nombre_completo)
        const b = normalizar(addName)
        return b.length > 1 && (a.includes(b) || b.includes(a))
      }).slice(0, 3)
    : []

  function openAddPanel() {
    setAddName(trimmed)
    setAddError(null)
    setAddMode(true)
    setOpen(false)
  }

  async function confirmarNuevo() {
    const nombre = addName.trim()
    if (!nombre) {
      setAddError('Ingresá un nombre.')
      return
    }
    setCreating(true)
    setAddError(null)
    try {
      const creado = await createTrabajador(nombre)
      queryClient.invalidateQueries({ queryKey: ['trabajadores'] })
      onChange(creado.nombre_completo, creado.id)
      setAddMode(false)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setAddError(typeof detail === 'string' ? detail : 'Error al crear el trabajador.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value, undefined); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar trabajador..."
        autoComplete="off"
        className={trabajadorId ? className + ' pr-16' : className}
      />
      {trabajadorId && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded pointer-events-none">
          existente
        </span>
      )}

      {open && !addMode && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-56 overflow-auto">
          {matches.map((t: TrabajadorResponse) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { onChange(t.nombre_completo, t.id); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              {t.nombre_completo}
            </button>
          ))}
          {matches.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-400">Nadie coincide con &quot;{trimmed}&quot;.</p>
          )}
          <button
            type="button"
            onClick={openAddPanel}
            className="w-full flex items-center gap-1.5 text-left px-3 py-2 text-sm text-[#7a1f2c] font-medium hover:bg-[#fbfaf6] border-t border-gray-100"
          >
            <Plus size={13} />
            Agregar nuevo trabajador
          </button>
        </div>
      )}

      {addMode && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">Nuevo trabajador</p>
            <button type="button" onClick={() => setAddMode(false)} className="text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          </div>
          <input
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder="Nombre completo"
            autoFocus
            className={className}
          />
          {parecidos.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-md px-2.5 py-2 text-xs text-amber-800">
              <p className="font-medium mb-1">¿Ya está uno de estos?</p>
              <ul className="space-y-0.5">
                {parecidos.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => { onChange(t.nombre_completo, t.id); setAddMode(false) }}
                      className="underline hover:text-amber-900"
                    >
                      {t.nombre_completo}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setAddMode(false)}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={creating}
              onClick={confirmarNuevo}
              className="px-3 py-1.5 text-xs font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60"
            >
              {creating ? 'Creando...' : 'Sí, crear trabajador nuevo'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
