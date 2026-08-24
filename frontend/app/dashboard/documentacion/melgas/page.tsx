'use client'

import { useState } from 'react'
import { ImageIcon } from 'lucide-react'

interface FilaMelga {
  id: string
  melgasEO: string
  melgasNS: string
  totalCuadros: string
  observaciones: string
}

const FILAS: FilaMelga[] = [
  { id: 'Parral 21 (P 21)',     melgasEO: '80',   melgasNS: '89',     totalCuadros: '7.120,0',  observaciones: 'Distribución estándar' },
  { id: 'Parral 6 (P 6)',       melgasEO: '152',  melgasNS: '45',     totalCuadros: '6.840,0',  observaciones: 'Cuartel de gran longitud E-O' },
  { id: 'Parral 7 (P 7)',       melgasEO: '147',  melgasNS: '43',     totalCuadros: '6.321,0',  observaciones: 'Parral extenso E-O' },
  { id: 'Parral 12 (P 12)',     melgasEO: '91',   melgasNS: '53',     totalCuadros: '4.823,0',  observaciones: 'Estructura balanceada' },
  { id: 'Parral 11 (P 11) · Multi-Sector', melgasEO: '144', melgasNS: 'Varía', totalCuadros: '6.799,0', observaciones: '37x33 (1.221) + 11x43 (473) + 96x43 cepas (4.128) + 977 cejos' },
  { id: 'Parral Syrah (Sirah)', melgasEO: '55,5', melgasNS: '63',     totalCuadros: '3.496,5',  observaciones: 'Media melga en lateral' },
  { id: 'Parral Red Globe Viejo', melgasEO: '36', melgasNS: '63',     totalCuadros: '2.268,0',  observaciones: 'Variedad mesa / pasas' },
  { id: 'Parral BN',            melgasEO: '99',   melgasNS: '45',     totalCuadros: '4.455,0',  observaciones: '45 N-S × 99 E-O' },
  { id: 'Parral BV (PBV)',      melgasEO: '100',  melgasNS: '70',     totalCuadros: '7.000,0',  observaciones: 'Cuartel de gran porte' },
  { id: 'Parral 8 (P 8)',       melgasEO: '103',  melgasNS: '55',     totalCuadros: '5.665,0',  observaciones: '103 melgas E-O' },
  { id: 'Parral 2 (P 2)',       melgasEO: '112',  melgasNS: '45',     totalCuadros: '5.040,0',  observaciones: 'Orientación predominante E-O' },
  { id: 'Parral 5 (P 5)',       melgasEO: '88',   melgasNS: '37',     totalCuadros: '3.256,0',  observaciones: 'Cuartel intermedio' },
  { id: 'Parral 4 (P 4)',       melgasEO: '88',   melgasNS: '36',     totalCuadros: '3.168,0',  observaciones: 'Cuartel intermedio' },
  { id: 'Parral 10 (P 10)',     melgasEO: '112',  melgasNS: '47',     totalCuadros: '5.264,0',  observaciones: '112 melgas E-O' },
  { id: 'Parral 9 (P 9)',       melgasEO: '60',   melgasNS: '67',     totalCuadros: '4.020,0',  observaciones: 'Mayor desarrollo N-S' },
  { id: 'Parral 13 (P 13)',     melgasEO: '70',   melgasNS: '57',     totalCuadros: '3.990,0',  observaciones: 'Cuartel regular' },
  { id: 'Parral 16 (P 16)',     melgasEO: '70',   melgasNS: '57',     totalCuadros: '3.990,0',  observaciones: 'Dimensiones idénticas a P 13' },
  { id: 'Parral 14 (P 14)',     melgasEO: '70',   melgasNS: '70',     totalCuadros: '4.900,0',  observaciones: 'Cuadro simétrico (70 × 70)' },
  { id: 'Parral 15 (P 15)',     melgasEO: '70',   melgasNS: '71',     totalCuadros: '4.970,0',  observaciones: 'Cuadro regular' },
]

export default function DocumentacionMelgasPage() {
  const [verOriginal, setVerOriginal] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Plantas por Melgas y Melgas</h1>
          <p className="text-sm text-gray-500 mt-1">
            Planilla técnica de relevamiento de cuarteles y parrales — 19 parrales, sistema de conducción Parral Cuyano.
          </p>
        </div>
        <button
          onClick={() => setVerOriginal((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors whitespace-nowrap"
        >
          <ImageIcon size={16} />
          {verOriginal ? 'Ocultar planilla original' : 'Ver planilla original'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-900">19</div>
          <div className="text-xs text-gray-500 mt-1">Parrales / Cuarteles</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-900">1.614,5</div>
          <div className="text-xs text-gray-500 mt-1">Total Melgas E-O</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-900">91.010,5</div>
          <div className="text-xs text-gray-500 mt-1">Cuadros / Unidades estimadas</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-900">Poda, Riego, Cosecha</div>
          <div className="text-xs text-gray-500 mt-1">Uso del documento</div>
        </div>
      </div>

      {verOriginal && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/documentacion/plantas-por-melgas.jpeg"
            alt="Planilla técnica de relevamiento de cuarteles y parrales"
            className="w-full h-auto rounded-md"
          />
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Identificación</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Melgas E-O</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Melgas N-S</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Total Cuadros/Unidades</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Observaciones técnicas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {FILAS.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{f.id}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{f.melgasEO}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{f.melgasNS}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{f.totalCuadros}</td>
                  <td className="px-4 py-3 text-gray-600">{f.observaciones}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                <td className="px-4 py-3 text-gray-900">Totales generales</td>
                <td className="px-4 py-3 text-right text-gray-900">1.614,5</td>
                <td className="px-4 py-3 text-right text-gray-900">—</td>
                <td className="px-4 py-3 text-right text-gray-900">91.010,5</td>
                <td className="px-4 py-3 text-gray-600">19 Cuarteles relevados</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
