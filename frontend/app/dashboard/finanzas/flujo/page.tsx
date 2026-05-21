'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { MONTHS_SHORT, getFlujoAnual, type FlujoRow } from '@/lib/api/flujo'
import { TIPO_EGRESO_VALUES } from '@/lib/api/egresos'

// ── Formatters ────────────────────────────────────────────────────────────────

const NUM_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

function fmt(n: number): string {
  return n === 0 ? '' : NUM_FMT.format(n)
}

function fmtAlways(n: number): string {
  return NUM_FMT.format(n)
}

// ── Year setup ────────────────────────────────────────────────────────────────

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const AVAILABLE_YEARS = Array.from({ length: DEFAULT_YEAR - 2020 + 1 }, (_, i) => DEFAULT_YEAR - i)

// ── Table row components ──────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <tr>
      <td
        colSpan={14}
        className="sticky left-0 z-10 bg-green-700 text-white px-3 py-2 text-xs font-bold uppercase tracking-wider"
      >
        {label}
      </td>
    </tr>
  )
}

function DataRow({ label, valores, total }: FlujoRow) {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
      <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-sm text-gray-700 whitespace-nowrap min-w-[180px] hover:bg-gray-50">
        {label}
      </td>
      {valores.map((v, i) => (
        <td key={i} className="px-2 py-1.5 text-right font-mono text-sm text-gray-700 whitespace-nowrap min-w-[105px]">
          {fmt(v)}
        </td>
      ))}
      <td className="px-2 py-1.5 text-right font-mono text-sm font-semibold text-gray-800 whitespace-nowrap min-w-[115px] border-l border-gray-200">
        {fmtAlways(total)}
      </td>
    </tr>
  )
}

function TotalRow({
  label,
  valores,
  bgClass = 'bg-gray-100',
  textClass = 'text-gray-800',
}: {
  label: string
  valores: number[]
  bgClass?: string
  textClass?: string
}) {
  const total = valores.reduce((s, v) => s + v, 0)
  return (
    <tr className={`border-b border-gray-300 ${bgClass}`}>
      <td className={`sticky left-0 z-10 px-3 py-2 text-sm font-bold whitespace-nowrap ${bgClass} ${textClass}`}>
        {label}
      </td>
      {valores.map((v, i) => (
        <td key={i} className={`px-2 py-2 text-right font-mono text-sm font-bold whitespace-nowrap ${textClass}`}>
          {fmtAlways(v)}
        </td>
      ))}
      <td className={`px-2 py-2 text-right font-mono text-sm font-bold whitespace-nowrap border-l border-gray-300 ${textClass}`}>
        {fmtAlways(total)}
      </td>
    </tr>
  )
}

function AccumRow({ label, valores }: { label: string; valores: number[] }) {
  return (
    <tr className="border-b border-gray-200 bg-gray-50">
      <td className="sticky left-0 z-10 bg-gray-50 px-3 py-1 text-xs italic text-gray-500 whitespace-nowrap">
        {label}
      </td>
      {valores.map((v, i) => (
        <td key={i} className="px-2 py-1 text-right font-mono text-xs text-gray-500 whitespace-nowrap">
          {fmtAlways(v)}
        </td>
      ))}
      <td className="px-2 py-1 text-right font-mono text-xs text-gray-500 whitespace-nowrap border-l border-gray-200">
        {fmtAlways(valores[11] ?? 0)}
      </td>
    </tr>
  )
}

function SaldoRow({
  label,
  valores,
  showLastAsTotal = false,
}: {
  label: string
  valores: number[]
  showLastAsTotal?: boolean
}) {
  const totalVal = showLastAsTotal
    ? (valores.at(-1) ?? 0)
    : valores.reduce((s, v) => s + v, 0)
  const bg = showLastAsTotal ? 'bg-blue-50' : 'bg-amber-50'

  return (
    <tr className={`border-b border-gray-300 ${bg}`}>
      <td className={`sticky left-0 z-10 px-3 py-2 text-sm font-bold whitespace-nowrap ${bg} text-gray-800`}>
        {label}
      </td>
      {valores.map((v, i) => (
        <td
          key={i}
          className={`px-2 py-2 text-right font-mono text-sm font-semibold whitespace-nowrap ${
            v >= 0 ? 'text-green-700' : 'text-red-600'
          }`}
        >
          {fmtAlways(v)}
        </td>
      ))}
      <td
        className={`px-2 py-2 text-right font-mono text-sm font-bold whitespace-nowrap border-l border-gray-300 ${
          totalVal >= 0 ? 'text-green-700' : 'text-red-600'
        }`}
      >
        {fmtAlways(totalVal)}
      </td>
    </tr>
  )
}

function EgresoRow({
  num, tipo, label, valores, total, anio,
}: FlujoRow & { num: number; tipo: string; anio: number }) {
  const router = useRouter()
  return (
    <tr
      className="border-b border-gray-100 hover:bg-green-50 transition-colors cursor-pointer group"
      onClick={() => router.push(`/dashboard/finanzas/flujo/desglose/${tipo}?anio=${anio}`)}
    >
      <td className="sticky left-0 z-10 bg-white group-hover:bg-green-50 px-3 py-1.5 text-sm text-gray-700 whitespace-nowrap min-w-[180px]">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 font-mono w-4 text-right flex-shrink-0">{num}</span>
          <span>{label}</span>
          <ChevronRight size={12} className="text-gray-300 group-hover:text-green-600 ml-auto flex-shrink-0" />
        </div>
      </td>
      {valores.map((v, i) => (
        <td key={i} className="px-2 py-1.5 text-right font-mono text-sm text-gray-700 whitespace-nowrap min-w-[105px]">
          {fmt(v)}
        </td>
      ))}
      <td className="px-2 py-1.5 text-right font-mono text-sm font-semibold text-gray-800 whitespace-nowrap min-w-[115px] border-l border-gray-200">
        {fmtAlways(total)}
      </td>
    </tr>
  )
}

function SpacerRow() {
  return (
    <tr className="h-1.5 bg-gray-300">
      <td colSpan={14} />
    </tr>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonTable() {
  return (
    <div className="p-6 space-y-2">
      {Array.from({ length: 16 }).map((_, i) => (
        <div
          key={i}
          className="h-7 bg-gray-200 rounded animate-pulse"
          style={{ opacity: Math.max(0.2, 1 - i * 0.05) }}
        />
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FlujoPage() {
  const [anio, setAnio] = useState(DEFAULT_YEAR)

  const { data, isLoading } = useQuery({
    queryKey: ['flujo-anual', anio],
    queryFn: () => getFlujoAnual(anio),
    staleTime: 60_000,
  })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Flujo Anual</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Campaña {anio}/{anio + 1} · Valores en ARS · USD no incluido
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-600">Campaña</label>
          <select
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {AVAILABLE_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}/{y + 1}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <SkeletonTable />
        ) : !data ? (
          <p className="p-8 text-center text-gray-400">Sin datos para esta campaña</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse" style={{ minWidth: '1480px' }}>
              <thead>
                <tr className="bg-gray-800 text-white">
                  <th className="sticky left-0 z-20 bg-gray-800 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap min-w-[180px]">
                    Concepto
                  </th>
                  {MONTHS_SHORT.map((m) => (
                    <th
                      key={m}
                      className="px-2 py-2.5 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap min-w-[105px]"
                    >
                      {m}
                    </th>
                  ))}
                  <th className="px-2 py-2.5 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap min-w-[115px] border-l border-gray-600">
                    TOTAL
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* ── INGRESOS ── */}
                <SectionHeader label="Ingresos" />

                {data.ingresoPorCliente.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="px-3 py-3 text-sm text-gray-400 italic">
                      Sin ingresos en ARS registrados
                    </td>
                  </tr>
                ) : (
                  data.ingresoPorCliente.map((row) => <DataRow key={row.label} {...row} />)
                )}

                <SpacerRow />
                <TotalRow label="TOTAL INGRESOS" valores={data.totalIngreso} />
                <AccumRow label="Acumulado Ingresos" valores={data.acumuladoIngreso} />

                {/* ── EGRESOS ── */}
                <SectionHeader label="Egresos" />

                {TIPO_EGRESO_VALUES.map((tipo, idx) => (
                  <EgresoRow
                    key={tipo}
                    num={idx + 1}
                    tipo={tipo}
                    anio={anio}
                    {...data.egresoPorTipo[idx]}
                  />
                ))}

                <SpacerRow />
                <TotalRow
                  label="TOTAL EGRESOS"
                  valores={data.totalEgreso}
                  bgClass="bg-red-50"
                  textClass="text-red-800"
                />
                <AccumRow label="Acumulado Egresos" valores={data.acumuladoEgreso} />

                {/* ── SALDO ── */}
                <SpacerRow />
                <SaldoRow label="SALDO MENSUAL" valores={data.saldoMensual} />
                <SaldoRow
                  label="SALDO ACUMULADO"
                  valores={data.saldoAcumulado}
                  showLastAsTotal
                />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
