'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import {
  getHistorialMaquina,
  getMaquina,
  getMaquinariaErrorMessage,
  GRAVEDAD_FALLA_LABELS,
  TIPO_MAQUINA_LABELS,
  FINCA_LABELS,
} from '@/lib/api/maquinaria'
import EstadoMaquinaBadge from '@/components/maquinaria/EstadoMaquinaBadge'
import MaquinaIcon from '@/components/maquinaria/MaquinaIcon'
import { OrdenEstadoBadge, fmtDate, fmtMonto, fmtOM } from '@/components/maquinaria/ordenUi'
import EmptyState from '@/components/ui/EmptyState'
import FormError from '@/components/ui/FormError'

const CAMPANAS_VISIBLES = 4

// Campaña runs May -> April and is named by its starting year.
function campanaActual(now = new Date()): number {
  return now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  )
}

function HistorialTemporada({ maquinaId }: { maquinaId: string }) {
  const actual = campanaActual()
  const [temporada, setTemporada] = useState(actual)
  const campanas = Array.from({ length: CAMPANAS_VISIBLES }, (_, i) => actual - i)

  const { data, isLoading, error } = useQuery({
    queryKey: ['maquinaria', 'historial', maquinaId, temporada],
    queryFn: () => getHistorialMaquina(maquinaId, temporada),
    staleTime: 30_000,
  })

  // costo_total is null for roles below gerencial: hide every money field then.
  const verCostos = data ? data.costo_total !== null : false
  const th = 'text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap'

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Historial de la temporada</h2>
        <select
          value={temporada}
          onChange={(e) => setTemporada(Number(e.target.value))}
          aria-label="Campaña"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]"
        >
          {campanas.map((c) => (
            <option key={c} value={c}>Campaña {c}/{c + 1}</option>
          ))}
        </select>
      </div>

      {error ? (
        <FormError
          title="No se pudo cargar el historial"
          description={getMaquinariaErrorMessage(error, 'Error de conexión. Intente nuevamente.')}
        />
      ) : isLoading || !data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
          <div className="h-40 rounded-lg bg-gray-100 animate-pulse" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Tile label="Órdenes" value={String(data.ordenes_count)} />
            <Tile label="Días fuera de servicio" value={String(data.dias_fuera_servicio_total)} />
            {verCostos && <Tile label="Total gastado" value={fmtMonto(Number(data.costo_total))} />}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {data.ordenes.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="Sin órdenes en esta campaña"
                description={`No se reportaron fallas en la campaña ${temporada}/${temporada + 1}.`}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className={th}>OM</th>
                      <th className={th}>Reportada</th>
                      <th className={th}>Descripción</th>
                      <th className={th}>Taller</th>
                      <th className={th}>Estado</th>
                      <th className={`${th} text-right`}>Días fuera</th>
                      <th className={th}>Fecha de pago</th>
                      {verCostos && <th className={`${th} text-right`}>Costo</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.ordenes.map((o) => (
                      <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-3 whitespace-nowrap">
                          <Link
                            href={`/dashboard/maquinaria/ordenes/${o.id}`}
                            className="font-mono font-medium text-[#7a1f2c] hover:underline"
                          >
                            {fmtOM(o.numero)}
                          </Link>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-700">{fmtDate(o.created_at)}</td>
                        <td className="px-3 py-3 min-w-[220px] max-w-md">
                          <p className="line-clamp-2 text-gray-800">{o.descripcion}</p>
                          <p className="text-[11px] text-gray-400">{GRAVEDAD_FALLA_LABELS[o.gravedad]}</p>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-700">{o.taller || '—'}</td>
                        <td className="px-3 py-3 whitespace-nowrap"><OrdenEstadoBadge estado={o.estado} /></td>
                        <td className="px-3 py-3 text-right font-mono text-gray-800">{o.dias_fuera_servicio}</td>
                        <td className="px-3 py-3 whitespace-nowrap text-gray-700">
                          {o.fecha_pago ? fmtDate(o.fecha_pago) : '—'}
                        </td>
                        {verCostos && (
                          <td className="px-3 py-3 text-right font-mono whitespace-nowrap text-gray-800">
                            {o.costo !== null ? fmtMonto(o.costo) : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

export default function MaquinaFichaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data: maquina, isLoading, error } = useQuery({
    queryKey: ['maquinaria', 'maquina', id],
    queryFn: () => getMaquina(id),
  })

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/maquinaria"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft size={14} /> Maquinaria
      </Link>

      {isLoading ? (
        <div className="h-16 bg-gray-100 rounded-lg animate-pulse" />
      ) : error || !maquina ? (
        <FormError
          title="No se pudo cargar la máquina"
          description={getMaquinariaErrorMessage(error, 'La máquina no existe o no tenés acceso.')}
        />
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <MaquinaIcon icono={maquina.icono} size={32} className="text-[#7a1f2c] shrink-0" />
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">
                  {maquina.marca} {maquina.modelo}
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                  {TIPO_MAQUINA_LABELS[maquina.tipo]} · {FINCA_LABELS[maquina.finca]}
                  {maquina.anio ? ` · ${maquina.anio}` : ''}
                  {maquina.patente_serie ? ` · ${maquina.patente_serie}` : ''}
                </p>
              </div>
            </div>
            <EstadoMaquinaBadge estado={maquina.estado} semaforo={maquina.semaforo} />
          </div>

          <HistorialTemporada maquinaId={id} />
        </>
      )}
    </div>
  )
}
