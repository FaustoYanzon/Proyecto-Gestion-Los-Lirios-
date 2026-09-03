'use client'

import { VARIEDAD_LABELS } from '@/lib/api/produccion'
import { FINCA_LABELS, TIPO_LABELS } from '@/lib/api/parcelas'
import type { ParcelaItem } from '@/lib/api/produccion'

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-gray-800">{valor}</p>
    </div>
  )
}

export default function ParcelaHeader({ parcela }: { parcela: ParcelaItem }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Dato label="Tipo" valor={TIPO_LABELS[parcela.tipo as keyof typeof TIPO_LABELS] ?? parcela.tipo} />
        <Dato label="Variedad" valor={parcela.variedad ? (VARIEDAD_LABELS[parcela.variedad] ?? parcela.variedad) : '—'} />
        <Dato label="Superficie" valor={parcela.superficie_ha != null ? `${parcela.superficie_ha.toFixed(2)} ha` : '—'} />
        <Dato label="Finca" valor={parcela.finca ? (FINCA_LABELS[parcela.finca as keyof typeof FINCA_LABELS] ?? parcela.finca) : '—'} />
      </div>
    </div>
  )
}
