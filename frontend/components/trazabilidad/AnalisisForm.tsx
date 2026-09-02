'use client'

import { useState } from 'react'
import {
  createAnalisisCalidad, ESTADO_SANITARIO_LABELS, ORIGEN_ANALISIS_LABELS,
  type EstadoSanitarioAnalisis, type OrigenAnalisis,
} from '@/lib/api/trazabilidad'

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-xs font-medium text-gray-500 mb-1'

export default function AnalisisForm({ parcelaId, onDone, onCancel }: {
  parcelaId: string
  onDone: () => void
  onCancel: () => void
}) {
  const [fecha, setFecha] = useState(() => new Date().toISOString().split('T')[0])
  const [origen, setOrigen] = useState<OrigenAnalisis>('propio')
  const [brix, setBrix] = useState('')
  const [acidez, setAcidez] = useState('')
  const [ph, setPh] = useState('')
  const [estadoSanitario, setEstadoSanitario] = useState<EstadoSanitarioAnalisis | ''>('')
  const [laboratorioNombre, setLaboratorioNombre] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.type)) {
      setError('Formato no soportado — usá JPEG, PNG, WEBP o PDF.')
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('El archivo supera el tamaño máximo de 10 MB.')
      return
    }
    setError(null)
    setFile(f)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await createAnalisisCalidad({
        parcela_id: parcelaId,
        fecha,
        origen,
        brix: brix ? Number(brix) : undefined,
        acidez: acidez ? Number(acidez) : undefined,
        ph: ph ? Number(ph) : undefined,
        estado_sanitario: estadoSanitario || undefined,
        laboratorio_nombre: origen === 'laboratorio' ? (laboratorioNombre.trim() || undefined) : undefined,
        observaciones: observaciones.trim() || undefined,
        file: file ?? undefined,
      })
      onDone()
    } catch {
      setError('No se pudo guardar el análisis. Probá de nuevo.')
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
          <label className={label}>Origen</label>
          <select value={origen} onChange={(e) => setOrigen(e.target.value as OrigenAnalisis)} className={field}>
            {Object.entries(ORIGEN_ANALISIS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={label}>Grados Brix</label>
          <input type="number" step="0.1" value={brix} onChange={(e) => setBrix(e.target.value)} className={field} />
        </div>
        <div>
          <label className={label}>Acidez</label>
          <input type="number" step="0.1" value={acidez} onChange={(e) => setAcidez(e.target.value)} className={field} />
        </div>
        <div>
          <label className={label}>pH</label>
          <input type="number" step="0.1" value={ph} onChange={(e) => setPh(e.target.value)} className={field} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Estado sanitario</label>
          <select
            value={estadoSanitario}
            onChange={(e) => setEstadoSanitario(e.target.value as EstadoSanitarioAnalisis | '')}
            className={field}
          >
            <option value="">Sin especificar</option>
            {Object.entries(ESTADO_SANITARIO_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        {origen === 'laboratorio' && (
          <div>
            <label className={label}>Laboratorio / bodega</label>
            <input
              type="text"
              value={laboratorioNombre}
              onChange={(e) => setLaboratorioNombre(e.target.value)}
              className={field}
            />
          </div>
        )}
      </div>
      <div>
        <label className={label}>Observaciones (opcional)</label>
        <input type="text" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className={field} />
      </div>
      <div>
        <label className={label}>Informe adjunto (opcional — imagen o PDF)</label>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
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
          {saving ? 'Guardando...' : 'Guardar'}
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
