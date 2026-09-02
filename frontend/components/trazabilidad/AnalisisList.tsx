'use client'

import { useState } from 'react'
import { Plus, FileText } from 'lucide-react'
import { ESTADO_SANITARIO_LABELS, ORIGEN_ANALISIS_LABELS, type AnalisisCalidadResponse } from '@/lib/api/trazabilidad'
import AnalisisForm from './AnalisisForm'

export default function AnalisisList({ parcelaId, analisis, puedeEditar, onChanged }: {
  parcelaId: string
  analisis: AnalisisCalidadResponse[]
  puedeEditar: boolean
  onChanged: () => void
}) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Análisis de calidad ({analisis.length})</h3>
        {puedeEditar && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={14} />
            Agregar análisis
          </button>
        )}
      </div>

      {showForm && (
        <AnalisisForm
          parcelaId={parcelaId}
          onDone={() => { setShowForm(false); onChanged() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {analisis.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Sin análisis en el período elegido.</p>
      ) : (
        <ul className="space-y-2">
          {analisis.map((a) => (
            <li key={a.id} className="border border-gray-100 rounded-md p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-800">
                  {a.fecha.split('-').reverse().join('/')} — {ORIGEN_ANALISIS_LABELS[a.origen]}
                </span>
                {a.informe_url && (
                  <a
                    href={a.informe_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#7a1f2c] flex items-center gap-1 hover:underline flex-shrink-0"
                  >
                    <FileText size={13} /> Informe
                  </a>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {[
                  a.brix !== null && `Brix: ${a.brix}`,
                  a.acidez !== null && `Acidez: ${a.acidez}`,
                  a.ph !== null && `pH: ${a.ph}`,
                  a.estado_sanitario && ESTADO_SANITARIO_LABELS[a.estado_sanitario],
                  a.laboratorio_nombre,
                ].filter(Boolean).join(' · ') || 'Sin datos adicionales'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
