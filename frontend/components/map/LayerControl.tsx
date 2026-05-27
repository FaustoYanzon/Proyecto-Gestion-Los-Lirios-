'use client'

import { useState } from 'react'
import { Layers } from 'lucide-react'

export interface LayerVisibility {
  acequias: boolean
  lineaElectrica: boolean
  canerias: boolean
  valvulas: boolean
  cuadrantesRiego: boolean
}

const LAYER_CONFIG: Array<{
  key: keyof LayerVisibility
  label: string
  color: string
  shape: 'line' | 'circle' | 'poly'
}> = [
  { key: 'acequias',        label: 'Acequias',         color: '#38bdf8', shape: 'line'   },
  { key: 'lineaElectrica',  label: 'Línea eléctrica',  color: '#facc15', shape: 'line'   },
  { key: 'canerias',        label: 'Cañerías',         color: '#1e3a8a', shape: 'line'   },
  { key: 'valvulas',        label: 'Válvulas',         color: '#1e3a8a', shape: 'circle' },
  { key: 'cuadrantesRiego', label: 'Cuadrantes riego', color: '#9ca3af', shape: 'poly'   },
]

interface Props {
  visible: LayerVisibility
  onChange: (v: LayerVisibility) => void
}

export default function LayerControl({ visible, onChange }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <div className="absolute top-[10px] right-[10px] z-[1000]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg shadow-md text-xs font-medium text-gray-700 hover:bg-gray-50 border border-gray-200 transition-colors"
        title="Mostrar/ocultar capas"
      >
        <Layers size={13} />
        Capas
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 bg-white rounded-lg shadow-lg border border-gray-200 px-3 py-2.5 min-w-[178px]">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2.5">
            Infraestructura
          </p>
          <div className="space-y-2">
            {LAYER_CONFIG.map(({ key, label, color, shape }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={visible[key]}
                  onChange={e => onChange({ ...visible, [key]: e.target.checked })}
                  className="rounded border-gray-300 text-green-600 focus:ring-1 focus:ring-green-500 focus:ring-offset-0 cursor-pointer"
                />
                <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                  {shape === 'line' && (
                    <span className="block w-4 h-[2.5px] rounded-full" style={{ background: color }} />
                  )}
                  {shape === 'circle' && (
                    <span className="block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                  )}
                  {shape === 'poly' && (
                    <span
                      className="block w-3 h-3 rounded-[2px] border"
                      style={{ background: color, borderColor: '#6b7280' }}
                    />
                  )}
                </span>
                <span className="text-xs text-gray-700 group-hover:text-gray-900 transition-colors">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
