'use client'

// Posiciones del orden de campaña (0 = Mayo ... 11 = Abril) — mismo orden que
// MESES_ORDER en dashboard/page.tsx y mano-de-obra/page.tsx.
const CAMPANA_MESES = [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4]

function campanaPos(year: number, month: number): { anio: number; idx: number } {
  // El año de campaña de un mes calendario: mayo-diciembre pertenecen al año
  // en curso, enero-abril pertenecen al año de campaña anterior.
  const anio = month >= 5 ? year : year - 1
  return { anio, idx: CAMPANA_MESES.indexOf(month) }
}

interface Props {
  onApply: (anio: number, mesDesdeIdx: number, mesHastaIdx: number) => void
}

export default function MesRangeQuickButtons({ onApply }: Props) {
  const now = new Date()
  const actual = campanaPos(now.getFullYear(), now.getMonth() + 1)
  const mesAnteriorDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const anterior = campanaPos(mesAnteriorDate.getFullYear(), mesAnteriorDate.getMonth() + 1)

  return (
    <div className="flex rounded-md border border-gray-300 overflow-hidden text-sm">
      <button
        type="button"
        onClick={() => onApply(anterior.anio, anterior.idx, anterior.idx)}
        className="px-3 py-2 font-medium text-gray-600 bg-white hover:bg-gray-50 border-r border-gray-300 transition-colors"
      >
        Mes anterior
      </button>
      <button
        type="button"
        onClick={() => onApply(actual.anio, actual.idx, actual.idx)}
        className="px-3 py-2 font-medium text-gray-600 bg-white hover:bg-gray-50 transition-colors"
      >
        Mes actual
      </button>
    </div>
  )
}
