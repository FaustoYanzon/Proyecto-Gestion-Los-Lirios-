'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react'
import { getFlujoDesglose, MONTHS_SHORT } from '@/lib/api/flujo'
import type { FlujoDesgloseRow } from '@/lib/api/flujo'
import { TIPO_EGRESO_LABELS, TIPO_EGRESO_VALUES } from '@/lib/api/egresos'
import type { TipoEgreso } from '@/lib/api/egresos'

// ── Formatters ────────────────────────────────────────────────────────────────

const NUM_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
function fmt(n: number) { return n === 0 ? '' : NUM_FMT.format(n) }
function fmtAlways(n: number) { return NUM_FMT.format(n) }

// ── Year helpers ──────────────────────────────────────────────────────────────

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const AVAILABLE_YEARS = Array.from({ length: DEFAULT_YEAR - 2020 + 1 }, (_, i) => DEFAULT_YEAR - i)

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DesgloseEgresoPage({
  params,
  searchParams,
}: {
  params: Promise<{ tipo: string }>
  searchParams: Promise<{ anio?: string }>
}) {
  const { tipo } = use(params)
  const sp = use(searchParams)
  const router = useRouter()

  const tipoKey = tipo as TipoEgreso
  const isValidTipo = (TIPO_EGRESO_VALUES as readonly string[]).includes(tipoKey)
  const tipoLabel = isValidTipo ? (TIPO_EGRESO_LABELS[tipoKey] ?? tipo) : tipo

  const [anio, setAnio] = useState(Number(sp.anio ?? DEFAULT_YEAR))
  const [allOpen, setAllOpen] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['flujo-desglose', tipoKey, anio],
    queryFn: () => getFlujoDesglose(tipoKey, anio),
    staleTime: 60_000,
    enabled: isValidTipo,
  })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => router.push('/dashboard/finanzas/flujo')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors flex-shrink-0"
        >
          <ArrowLeft size={16} />
          Flujo Anual
        </button>
        <span className="text-gray-300">/</span>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold text-gray-900">{tipoLabel}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Campaña {anio}/{anio + 1} · Desglose por clasificación · ARS
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {data && data.rows.some((r) => r.items.length > 0) && (
            <button
              onClick={() => setAllOpen((v) => !v)}
              className="flex items-center gap-1.5 text-sm text-gray-600 border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-50 transition-colors"
            >
              {allOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {allOpen ? 'Colapsar todo' : 'Expandir todo'}
            </button>
          )}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-600">Campaña</label>
            <select
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              {AVAILABLE_YEARS.map((y) => (
                <option key={y} value={y}>{y}/{y + 1}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {!isValidTipo ? (
          <p className="p-8 text-center text-red-500">Tipo de egreso no válido: {tipo}</p>
        ) : isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-gray-200 rounded animate-pulse" style={{ opacity: Math.max(0.2, 1 - i * 0.15) }} />
            ))}
          </div>
        ) : isError ? (
          <p className="p-8 text-center text-red-500">Error al cargar datos. Intente recargar la página.</p>
        ) : !data || data.total.every((v) => v === 0) ? (
          <p className="p-8 text-center text-gray-400 italic">
            Sin registros en ARS para {tipoLabel} en la campaña {anio}/{anio + 1}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse" style={{ minWidth: `${220 + MONTHS_SHORT.length * 105 + 115}px` }}>
              <thead>
                <tr className="bg-gray-800 text-white">
                  <th className="sticky left-0 z-20 bg-gray-800 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap min-w-[220px]">
                    Clasificación / Descripción
                  </th>
                  {MONTHS_SHORT.map((m) => (
                    <th key={m} className="px-2 py-2.5 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap min-w-[105px]">
                      {m}
                    </th>
                  ))}
                  <th className="px-2 py-2.5 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap min-w-[115px] border-l border-gray-600">
                    TOTAL
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Render with key-based open state override when allOpen changes */}
                {data.rows.map((row) => (
                  <ExpandableRow key={row.key} row={row} forceOpen={allOpen} />
                ))}

                {/* Total row */}
                <tr className="bg-red-50 border-t-2 border-gray-300">
                  <td className="sticky left-0 z-10 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-800 whitespace-nowrap uppercase">
                    Total {tipoLabel}
                  </td>
                  {data.total.map((v, i) => (
                    <td key={i} className="px-2 py-2.5 text-right font-mono text-sm font-bold text-red-800 whitespace-nowrap">
                      {fmtAlways(v)}
                    </td>
                  ))}
                  <td className="px-2 py-2.5 text-right font-mono text-sm font-bold text-red-800 whitespace-nowrap border-l border-gray-300">
                    {fmtAlways(data.total.reduce((s, v) => s + v, 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// Wrapper that respects forceOpen override
function ExpandableRow({ row, forceOpen }: { row: FlujoDesgloseRow; forceOpen: boolean }) {
  const [localOpen, setLocalOpen] = useState(false)
  const hasItems = row.items.length > 0
  const open = hasItems && (forceOpen || localOpen)

  return (
    <>
      <tr
        className={`border-b border-gray-200 bg-gray-50 select-none ${hasItems ? 'hover:bg-gray-100 transition-colors cursor-pointer' : 'opacity-50'}`}
        onClick={() => hasItems && setLocalOpen((v) => !v)}
      >
        <td className="sticky left-0 z-10 bg-gray-50 hover:bg-gray-100 px-3 py-2 whitespace-nowrap min-w-[220px]">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-mono w-4 text-right flex-shrink-0">{row.num}</span>
            <span
              className="flex-shrink-0 text-gray-400 transition-transform duration-150"
              style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', display: 'inline-flex', visibility: hasItems ? 'visible' : 'hidden' }}
            >
              <ChevronDown size={15} />
            </span>
            <span className="text-sm font-semibold text-gray-800">{row.label}</span>
            {hasItems && <span className="ml-1 text-xs text-gray-400 font-normal">({row.items.length})</span>}
          </div>
        </td>
        {row.valores.map((v, i) => (
          <td key={i} className="px-2 py-2 text-right font-mono text-sm font-semibold text-gray-700 whitespace-nowrap min-w-[105px]">
            {fmt(v)}
          </td>
        ))}
        <td className="px-2 py-2 text-right font-mono text-sm font-bold text-gray-800 whitespace-nowrap min-w-[115px] border-l border-gray-300">
          {fmtAlways(row.total)}
        </td>
      </tr>

      {open && row.items.map((item) => (
        <tr
          key={item.descripcion}
          className="border-b border-gray-100 bg-white hover:bg-blue-50 transition-colors"
        >
          <td className="sticky left-0 z-10 bg-white hover:bg-blue-50 px-3 py-1.5 whitespace-nowrap min-w-[220px]">
            <div className="flex items-center gap-2 pl-7">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
              <span className="text-xs text-gray-600">{item.descripcion}</span>
            </div>
          </td>
          {item.valores.map((v, i) => (
            <td key={i} className="px-2 py-1.5 text-right font-mono text-xs text-gray-500 whitespace-nowrap min-w-[105px]">
              {fmt(v)}
            </td>
          ))}
          <td className="px-2 py-1.5 text-right font-mono text-xs font-medium text-gray-600 whitespace-nowrap min-w-[115px] border-l border-gray-200">
            {fmtAlways(item.total)}
          </td>
        </tr>
      ))}
    </>
  )
}
