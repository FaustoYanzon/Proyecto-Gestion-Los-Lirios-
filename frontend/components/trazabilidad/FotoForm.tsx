'use client'

import { useRef, useState } from 'react'
import { createFoto } from '@/lib/api/trazabilidad'

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-xs font-medium text-gray-500 mb-1'

export default function FotoForm({ parcelaId, onDone, onCancel }: {
  parcelaId: string
  onDone: () => void
  onCancel: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fecha, setFecha] = useState(() => new Date().toISOString().split('T')[0])
  const [categoria, setCategoria] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
      setError('Formato no soportado — usá JPEG, PNG o WEBP.')
      return
    }
    if (f.size > 8 * 1024 * 1024) {
      setError('La imagen supera el tamaño máximo de 8 MB.')
      return
    }
    setError(null)
    setFile(f)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { setError('Elegí una foto.'); return }
    if (!categoria.trim()) { setError('La categoría es obligatoria.'); return }
    setError(null)
    setSaving(true)
    try {
      await createFoto({
        parcela_id: parcelaId,
        fecha,
        categoria: categoria.trim(),
        descripcion: descripcion.trim() || undefined,
        file,
      })
      onDone()
    } catch {
      setError('No se pudo subir la foto. Probá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 p-3 bg-gray-50 rounded-md border border-gray-200 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={field} required />
        </div>
        <div>
          <label className={label}>Categoría</label>
          <input
            type="text"
            placeholder="Ej: parral, racimo, sanidad"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className={field}
            required
          />
        </div>
      </div>
      <div>
        <label className={label}>Descripción (opcional)</label>
        <input type="text" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={field} />
      </div>
      <div>
        <label className={label}>Foto</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="text-sm"
        />
        {file && <p className="text-xs text-gray-500 mt-1">{file.name}</p>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-3 py-1.5 text-xs font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors disabled:opacity-50"
        >
          {saving ? 'Subiendo...' : 'Guardar'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
