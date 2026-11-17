'use client'

import { useQuery } from '@tanstack/react-query'
import { getParametros } from '@/lib/api/altaProduccion'
import {
  MM_MANTO_DEFAULT,
  TIPO_RIEGO_LABELS,
  calcMantoResumen,
  type TipoRiego,
} from '@/lib/api/riego'

interface Props {
  value: TipoRiego
  onChange: (tipo: TipoRiego) => void
  disabled?: boolean
}

const TIPOS: TipoRiego[] = ['goteo', 'manto']

// First step of the irrigation forms: goteo (pick valves) or manto (whole
// parcel, no valves; fixed mm depth, litros = mm x surface).
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
          Se riega la parcela completa, sin elegir válvulas. Cada riego a manto aplica una lámina fija de mm; los litros salen de la superficie.
        </p>
      )}
    </div>
  )
}

// mm per manto irrigation from the production parameters. Roles that cannot
// read them (403) fall back to the fixed default instead of breaking the form.
export function useMmRiegoManto(): number {
  const { data } = useQuery({
    queryKey: ['ap-parametros'],
    queryFn: getParametros,
    staleTime: 60_000,
    retry: false,
  })
  return data?.mm_riego_manto ?? MM_MANTO_DEFAULT
}

// "60 mm · 2,3 ha · 1.380.000 L" summary for a parcel surface.
export function MantoResumen({ superficieHa }: { superficieHa: number }) {
  const mmParam = useMmRiegoManto()
  const { mm, litros } = calcMantoResumen(mmParam, superficieHa)
  return (
    <p className="text-sm font-medium text-amber-700">
      {mm.toLocaleString('es-AR')} mm · {superficieHa.toLocaleString('es-AR')} ha · {litros.toLocaleString('es-AR')} L
    </p>
  )
}
