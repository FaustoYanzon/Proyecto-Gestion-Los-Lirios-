'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, AlertTriangle, ClipboardCheck, RefreshCcw, Undo2 } from 'lucide-react'
import {
  getValvulasARevisar, revisarValvula, type ProductoAplicado, type ValvulaARevisar,
} from '@/lib/api/ordenesAplicacion'
import { VARIEDAD_LABELS } from '@/lib/api/produccion'
import { formatNum } from '@/components/produccion/RondaCard'

export const A_REVISAR_QUERY_KEY = ['valvulas-a-revisar']

// Every product of the valve; older backends only sent the first-line shim.
export function productosDe(v: ValvulaARevisar): ProductoAplicado[] {
  if (v.productos?.length) return v.productos
  return [{ insumo_id: v.insumo_id, insumo_nombre: v.insumo_nombre, dosis_por_ha: v.dosis_por_ha }]
}

function formatFecha(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Argentina/San_Juan',
  })
}

// Válvulas confirmadas que no se aplicaron, o que se aplicaron con
// observaciones (así se señalan las aplicaciones incompletas: no existe
// resultado "parcial"). Desde acá se decide si hace falta una orden de repaso.
export default function ARevisarPanel({
  onCrearRepaso,
  onDeshacer,
}: {
  onCrearRepaso: (valvula: ValvulaARevisar) => void
  onDeshacer: (valvula: ValvulaARevisar) => void
}) {
  const queryClient = useQueryClient()
  const [marcando, setMarcando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: items = [], isLoading } = useQuery({
    queryKey: A_REVISAR_QUERY_KEY,
    queryFn: getValvulasARevisar,
    staleTime: 30_000,
  })

  async function marcarRevisada(v: ValvulaARevisar) {
    setMarcando(v.id)
    setError(null)
    try {
      await revisarValvula(v.id)
      queryClient.invalidateQueries({ queryKey: A_REVISAR_QUERY_KEY })
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'No se pudo marcar como revisada.')
    } finally {
      setMarcando(null)
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
        Cargando…
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
        <ClipboardCheck size={28} className="mx-auto mb-2 text-gray-300" />
        No hay válvulas para revisar.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>}
      {items.map((v) => {
        const noAplicada = v.resultado === 'no_aplicada'
        return (
          <div key={v.id} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{v.parcela_nombre} · válvula {v.valvula_nombre}</span>
                  <span
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                      noAplicada
                        ? 'bg-red-50 text-red-700 border-red-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}
                  >
                    {noAplicada ? 'No se aplicó' : 'Aplicada con observaciones'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {v.objetivo} · {VARIEDAD_LABELS[v.variedad] ?? v.variedad}
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1" data-testid="productos-valvula">
                  {productosDe(v).map((p) => (
                    <span
                      key={p.insumo_id}
                      className="inline-flex items-baseline gap-1 text-[11px] font-medium text-gray-700 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-md"
                    >
                      {p.insumo_nombre}
                      <span className="font-mono font-normal text-gray-500">{formatNum(p.dosis_por_ha)}/ha</span>
                    </span>
                  ))}
                </div>
                <p className="text-xs text-gray-500">
                  {v.responsable ?? 'Sin responsable'} · {formatFecha(v.confirmada_at)}
                </p>
                {v.observaciones && (
                  <p className="mt-2 text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 flex gap-2">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
                    {v.observaciones}
                  </p>
                )}
                {v.fotos.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {v.fotos.map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="Foto de la aplicación" className="h-16 w-16 object-cover rounded-md border border-gray-200" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => onCrearRepaso(v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
                >
                  <RefreshCcw size={13} />
                  Crear orden de repaso
                </button>
                <button
                  onClick={() => marcarRevisada(v)}
                  disabled={marcando === v.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-60 transition-colors"
                >
                  {marcando === v.id && <Loader2 size={13} className="animate-spin" />}
                  Marcar revisada
                </button>
                <button
                  type="button"
                  onClick={() => onDeshacer(v)}
                  aria-label={`Deshacer válvula ${v.valvula_nombre} de ${v.parcela_nombre}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-md hover:bg-red-50 transition-colors"
                >
                  <Undo2 size={13} />
                  Deshacer
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
