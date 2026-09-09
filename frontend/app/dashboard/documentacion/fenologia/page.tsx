'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, PenLine } from 'lucide-react'
import { getFenologiaCalendario, getFenologiaEstadoActual, VARIEDAD_LABELS } from '@/lib/api/produccion'

function fmt(mes: number, dia: number): string {
  return `${dia.toString().padStart(2, '0')}/${mes.toString().padStart(2, '0')}`
}

export default function DocumentacionFenologiaPage() {
  const { data: calendario = [], isLoading: loadingCalendario } = useQuery({
    queryKey: ['fenologia-calendario'],
    queryFn: getFenologiaCalendario,
    staleTime: 60 * 60_000, // no cambia salvo que se edite el calendario en código
  })

  const { data: estadoActual = [], isLoading: loadingEstado } = useQuery({
    queryKey: ['fenologia-campana'],
    queryFn: getFenologiaEstadoActual,
    staleTime: 30_000,
  })

  const isLoading = loadingCalendario || loadingEstado

  // El calendario es el mismo para todas las variedades — el estado "de hoy"
  // también, salvo que alguna tenga una confirmación manual vigente.
  const faseActual = estadoActual.find((e) => e.fuente === 'automatico')?.fase
  const overrides = estadoActual.filter((e) => e.fuente === 'manual')

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Fenología — Calendario de Ciclo de Campaña</h1>
          <p className="text-sm text-gray-500 mt-1">
            De cuándo a cuándo es cada estado (se repite todos los años, mes/día) — el mismo calendario
            que pinta el mapa, igual para todas las variedades. Resaltado abajo, el estado de hoy.
          </p>
        </div>
        <Link
          href="/dashboard/produccion/campana"
          className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg
                     border border-gray-200 text-gray-700 hover:border-[#7a1f2c] hover:text-[#7a1f2c] transition-colors whitespace-nowrap"
        >
          Cambiar un estado
          <ArrowRight size={14} />
        </Link>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Desde</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Hasta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 7 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 3 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : calendario.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-gray-400">
                    Sin calendario cargado
                  </td>
                </tr>
              ) : (
                calendario.map((f) => (
                  <tr
                    key={f.fase}
                    className={`transition-colors ${f.fase === faseActual ? 'bg-[#fbf1e8]' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-4 py-3 text-gray-900 font-medium">
                      {f.fase_label}
                      {f.fase === faseActual && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-[#7a1f2c] text-white">
                          Hoy
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{fmt(f.desde_mes, f.desde_dia)}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{fmt(f.hasta_mes, f.hasta_dia)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {overrides.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Variedades con un estado confirmado a mano (distinto del calendario)
          </p>
          <div className="flex flex-wrap gap-2">
            {overrides.map((o) => (
              <span
                key={o.variedad}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#fbf1e8] text-[#7a1f2c]"
              >
                <PenLine size={11} />
                {VARIEDAD_LABELS[o.variedad] ?? o.variedad}: {o.fase_label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
