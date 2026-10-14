'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Package } from 'lucide-react'
import { getLotesPasa, getDepositos, errorDetail } from '@/lib/api/altaProduccion'
import FormError from '@/components/ui/FormError'
import LoteDetalleModal, { loteNombre } from '@/components/alta-produccion/LoteDetalleModal'

const KG_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fmtKg = (n: number) => KG_FMT.format(n)

export default function LevantadaPage() {
  const qc = useQueryClient()
  const [detalleId, setDetalleId] = useState<string | null>(null)

  // Solo lotes abiertos: acá se levanta; abrirlos y cerrarlos es en "Lotes de pasa".
  const { data: lotes = [], isLoading, error } = useQuery({
    queryKey: ['ap-lotes', 'abierto'],
    queryFn: () => getLotesPasa({ estado: 'abierto' }),
    staleTime: 15_000,
  })
  const { data: depositos = [] } = useQuery({ queryKey: ['ap-depositos'], queryFn: () => getDepositos(), staleTime: 60_000 })
  const nombreDeposito = (id: string | null) => (id ? depositos.find((d) => d.id === id)?.nombre ?? '–' : '–')

  const refrescar = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['ap-lotes'] }),
    qc.invalidateQueries({ queryKey: ['ap-stock'] }),
  ])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Levantada de pasa</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Elegí un lote abierto para agregarle bines o bolsones. Cada uno se pesa, lleva su tarja y se imprime de a uno.
        </p>
      </div>

      {error && <FormError description={errorDetail(error, 'No se pudieron cargar los lotes')} />}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : lotes.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 px-6 py-12 text-center">
          <Package className="mx-auto text-gray-300" size={36} />
          <p className="mt-3 text-sm font-medium text-gray-700">No hay lotes abiertos</p>
          <p className="mt-1 text-sm text-gray-500">
            Abrí uno desde{' '}
            <Link href="/dashboard/alta-produccion/lotes" className="text-[#7a1f2c] font-semibold hover:underline">Lotes de pasa</Link>
            {' '}para empezar a levantar.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {lotes.map((l) => {
            const pct = l.tope_bines ? Math.min(100, (l.cantidad_bines / l.tope_bines) * 100) : 0
            return (
              <button
                key={l.id}
                onClick={() => setDetalleId(l.id)}
                className="text-left bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:border-[#7a1f2c] hover:shadow-md transition-all"
              >
                <p className="text-sm font-semibold text-gray-900">{loteNombre(l)}</p>
                <div className="mt-3 flex items-end justify-between">
                  <p className="text-2xl font-bold font-mono text-gray-900">
                    {l.cantidad_bines}<span className="text-base text-gray-400">{l.tope_bines != null ? ` / ${l.tope_bines}` : ''}</span>
                  </p>
                  <p className="text-sm text-gray-500 font-mono">{fmtKg(l.kg_total)} kg</p>
                </div>
                <p className="text-xs text-gray-500">bines / bolsones</p>
                {l.tope_bines != null && (
                  <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-[#7a1f2c]" style={{ width: `${pct}%` }} />
                  </div>
                )}
                <p className="mt-3 text-xs font-semibold text-[#7a1f2c]">Agregar bin →</p>
              </button>
            )
          })}
        </div>
      )}

      {detalleId && (
        <LoteDetalleModal
          loteId={detalleId}
          modo="levantada"
          nombreDeposito={nombreDeposito}
          onClose={() => setDetalleId(null)}
          onChanged={refrescar}
        />
      )}
    </div>
  )
}
