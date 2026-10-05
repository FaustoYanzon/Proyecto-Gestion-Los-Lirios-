'use client'

import { FACTOR_MANTO, TIPO_RIEGO_LABELS, type TipoRiego } from '@/lib/api/riego'

interface Props {
  value: TipoRiego
  onChange: (tipo: TipoRiego) => void
}

const TIPOS: TipoRiego[] = ['goteo', 'manto']

// Goteo / Manto. En manto se eligen igual las válvulas (hasta dónde llega el
// agua), pero litros y mm se estiman al 40% del caudal de goteo.
export default function TipoRiegoSelector({ value, onChange }: Props) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de riego</label>
      <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
        {TIPOS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              value === t ? 'bg-[#7a1f2c] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {TIPO_RIEGO_LABELS[t]}
          </button>
        ))}
      </div>
      {value === 'manto' && (
        <p className="mt-1 text-xs text-gray-500">
          Elegí las válvulas hasta donde llega el agua. Litros y mm se calculan al {FACTOR_MANTO * 100}% del caudal de la válvula.
        </p>
      )}
    </div>
  )
}
