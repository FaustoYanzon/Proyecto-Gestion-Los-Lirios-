'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { FotoResponse } from '@/lib/api/trazabilidad'
import FotoForm from './FotoForm'

export default function FotoAlbum({ parcelaId, fotos, puedeEditar, onChanged }: {
  parcelaId: string
  fotos: FotoResponse[]
  puedeEditar: boolean
  onChanged: () => void
}) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Fotos ({fotos.length})</h3>
        {puedeEditar && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={14} />
            Agregar foto
          </button>
        )}
      </div>

      {showForm && (
        <FotoForm
          parcelaId={parcelaId}
          onDone={() => { setShowForm(false); onChanged() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {fotos.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Sin fotos en el período elegido.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {fotos.map((f) => (
            // eslint-disable-next-line @next/next/no-img-element -- URL externa (Cloudinary), no un asset local
            <a key={f.id} href={f.url} target="_blank" rel="noopener noreferrer" className="block group">
              <img
                src={f.url}
                alt={f.categoria}
                className="w-full aspect-square object-cover rounded-md border border-gray-200 group-hover:opacity-80 transition-opacity"
              />
              <p className="text-[11px] text-gray-500 mt-1 truncate">
                {f.categoria} · {f.fecha.split('-').reverse().join('/')}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
