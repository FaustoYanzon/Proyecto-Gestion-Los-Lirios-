'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Grape } from 'lucide-react'
import { getStockPasero } from '@/lib/api/altaProduccion'
import { VARIEDAD_LABELS } from '@/lib/api/produccion'
import { VAR_COLORS } from './varColors'

const FALLBACK_COLOR = '#94a3b8'

const fmtKg = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 0 })
const fmtPct = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 })

// Fresh grape currently available in a pasero, split by variety.
export default function UvaPaseroCard({ paseroId }: { paseroId: string }) {
  // Roles below encargado get 403 here: retry is off and the card hides itself.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['pasero-stock', paseroId],
    queryFn: () => getStockPasero(paseroId),
    staleTime: 60_000,
    retry: false,
  })

  const { total, items } = useMemo(() => {
    const byVar = new Map<string, number>()
    for (const s of data ?? []) {
      byVar.set(s.variedad, (byVar.get(s.variedad) ?? 0) + s.uva_disponible_kg)
    }
    const items = [...byVar.entries()]
      .filter(([, kg]) => kg > 0)
      .map(([variedad, kg]) => ({ variedad, kg }))
      .sort((a, b) => b.kg - a.kg)
    return { total: items.reduce((s, i) => s + i.kg, 0), items }
  }, [data])

  if (isError) return null

  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1.5">
        <Grape size={13} /> Uva fresca en el pasero
      </p>
      {isLoading ? (
        <div className="space-y-1.5">
          <div className="h-6 bg-gray-100 rounded animate-pulse" />
          <div className="h-3 bg-gray-100 rounded animate-pulse" />
        </div>
      ) : total <= 0 ? (
        <p className="text-xs text-gray-400">Sin uva ingresada</p>
      ) : (
        <>
          <p className="text-sm font-bold text-[#8a5a2b]">{fmtKg(total)} kg</p>
          <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-gray-100 mt-1.5">
            {items.map((i) => (
              <div
                key={i.variedad}
                style={{ width: `${(i.kg / total) * 100}%`, background: VAR_COLORS[i.variedad] ?? FALLBACK_COLOR }}
              />
            ))}
          </div>
          <div className="mt-2 space-y-1">
            {items.map((i) => (
              <div key={i.variedad} className="flex items-center gap-2 text-xs">
                <span
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ background: VAR_COLORS[i.variedad] ?? FALLBACK_COLOR }}
                />
                <span className="text-gray-700 truncate">
                  {VARIEDAD_LABELS[i.variedad] ?? i.variedad} · {fmtKg(i.kg)} kg · {fmtPct((i.kg / total) * 100)} %
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
