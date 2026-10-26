'use client'

import {
  FACTOR_MANTO_SUPERFICIE,
  LITROS_POR_HORA_VALVULA,
  TIPO_RIEGO_LABELS,
  valvulasManto,
  type TipoRiego,
} from '@/lib/api/riego'

interface Props {
  value: TipoRiego
  onChange: (tipo: TipoRiego) => void
  disabled?: boolean
}

const TIPOS: TipoRiego[] = ['goteo', 'manto']

// First step of the irrigation forms: goteo (pick valves) or manto (whole
// parcel, no valves; litros and mm are estimated at 25% of the valve flow).
export default function TipoRiegoSelector({ value, onChange, disabled = false }: Props) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">¿Goteo o manto?</label>
      <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
        {TIPOS.map((t) => (
          <button
            key={t}
            type="button"
            disabled={disabled}
            onClick={() => onChange(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
              value === t ? 'bg-[#7a1f2c] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            } ${disabled && value !== t ? 'opacity-50' : ''}`}
          >
            {TIPO_RIEGO_LABELS[t]}
          </button>
        ))}
      </div>
      {value === 'manto' && (
        <p className="mt-1 text-xs text-gray-500">
          Se riega la parcela completa, sin elegir válvulas. Litros y mm se calculan al {FACTOR_MANTO_SUPERFICIE * 100}% del caudal de la válvula.
        </p>
      )}
    </div>
  )
}

// "Manto · N válvulas · X L/h" summary for a parcel surface.
export function MantoResumen({ superficieHa }: { superficieHa: number }) {
  const n = valvulasManto(superficieHa)
  const lph = n * LITROS_POR_HORA_VALVULA * FACTOR_MANTO_SUPERFICIE
  return (
    <p className="text-sm font-medium text-amber-700">
      Manto · {n} válvula{n > 1 ? 's' : ''} · {lph.toLocaleString('es-AR')} L/h
    </p>
  )
}
