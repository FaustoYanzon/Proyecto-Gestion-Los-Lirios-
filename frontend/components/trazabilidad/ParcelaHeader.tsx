'use client'

import { VARIEDAD_LABELS } from '@/lib/api/produccion'
import { FINCA_LABELS, TIPO_LABELS } from '@/lib/api/parcelas'
import type { ParcelaItem } from '@/lib/api/produccion'
import type { HistorialParcelaResponse } from '@/lib/api/trazabilidad'

function Dato({ label, valor }: { label: string; valor: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-gray-800">{valor}</p>
    </div>
  )
}

export default function ParcelaHeader({
  parcela, historial,
}: {
  parcela: ParcelaItem
  historial: HistorialParcelaResponse
}) {
  const centroide = historial.parcela_centroide

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Dato label="Tipo" valor={TIPO_LABELS[parcela.tipo as keyof typeof TIPO_LABELS] ?? parcela.tipo} />
        <Dato label="Variedad" valor={parcela.variedad ? (VARIEDAD_LABELS[parcela.variedad] ?? parcela.variedad) : '—'} />
        <Dato label="Superficie" valor={parcela.superficie_ha != null ? `${parcela.superficie_ha.toFixed(2)} ha` : '—'} />
        <Dato label="Finca" valor={parcela.finca ? (FINCA_LABELS[parcela.finca as keyof typeof FINCA_LABELS] ?? parcela.finca) : '—'} />
        <Dato label="Tipo de riego" valor={historial.parcela_tipo_riego ?? '—'} />
        <Dato label="Cobertura de invierno" valor={historial.parcela_cobertura_invierno ?? 'No'} />
        <Dato
          label="Ubicación"
          valor={centroide ? (
            <a
              href={`https://www.google.com/maps?q=${centroide.lat},${centroide.lng}`}
              target="_blank" rel="noopener noreferrer"
              className="text-[#7a1f2c] hover:underline"
            >
              {centroide.lat.toFixed(5)}, {centroide.lng.toFixed(5)}
            </a>
          ) : '—'}
        />
        <Dato
          label="Horas de frío (clima de finca)"
          valor={historial.horas_de_frio != null ? `${historial.horas_de_frio} h` : '—'}
        />
      </div>

      {historial.parcela_variedad_descripcion && (
        <p className="text-xs text-gray-500 border-t border-gray-100 pt-3">
          {historial.parcela_variedad_descripcion}
        </p>
      )}
    </div>
  )
}
