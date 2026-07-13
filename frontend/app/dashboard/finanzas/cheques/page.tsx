'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Circle } from 'lucide-react'
import { getIngresos, updateIngreso, type IngresoResponse } from '@/lib/api/ingresos'

// ─── Seguimiento de cheques ─────────────────────────────────────────────────
// Vista filtrada de Ingresos (forma_pago = cheque/echeque). uso_cheque vacío
// significa que el cheque todavía está disponible para usar; con texto
// significa que ya se aplicó a algo (equivalente a la hoja "SEGUI CHEQUES").

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

function formatMonto(monto: number): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(monto)
}

type EstadoFiltro = 'todos' | 'disponibles' | 'usados'

interface UsoCellProps {
  ingreso: IngresoResponse
  onSaved: () => void
}

function UsoCell({ ingreso, onSaved }: UsoCellProps) {
  const [value, setValue] = useState(ingreso.uso_cheque ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (value === (ingreso.uso_cheque ?? '')) return
    setSaving(true)
    try {
      await updateIngreso(ingreso.id, { uso_cheque: value || undefined })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <input
      type="text"
      value={value}
      placeholder="Disponible"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      disabled={saving}
      className="w-full rounded-md border border-transparent px-2 py-1 text-sm bg-transparent
                 hover:border-gray-200 focus:border-[#7a1f2c] focus:outline-none focus:ring-1 focus:ring-[#7a1f2c]
                 disabled:opacity-50 transition-colors"
    />
  )
}

export default function ChequesPage() {
  const queryClient = useQueryClient()
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>('todos')
  const [comprador, setComprador] = useState('')

  const { data: cheques = [], isLoading } = useQuery({
    queryKey: ['ingresos-cheques'],
    queryFn: async () => {
      const [cheque, echeque] = await Promise.all([
        getIngresos({ forma_pago: 'cheque', limit: 1000 }),
        getIngresos({ forma_pago: 'echeque', limit: 1000 }),
      ])
      return [...cheque, ...echeque].sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    },
    staleTime: 30_000,
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['ingresos-cheques'] })
  }

  const filtrados = useMemo(() => {
    return cheques.filter((c) => {
      const disponible = !c.uso_cheque || c.uso_cheque.trim() === ''
      if (estadoFiltro === 'disponibles' && !disponible) return false
      if (estadoFiltro === 'usados' && disponible) return false
      if (comprador && !c.comprador.toLowerCase().includes(comprador.toLowerCase())) return false
      return true
    })
  }, [cheques, estadoFiltro, comprador])

  const disponiblesCount = cheques.filter((c) => !c.uso_cheque || c.uso_cheque.trim() === '').length
  const montoDisponibleArs = cheques
    .filter((c) => (!c.uso_cheque || c.uso_cheque.trim() === '') && c.moneda === 'ars')
    .reduce((s, c) => s + c.monto, 0)

  const selectCls =
    'rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
  const inputCls = selectCls

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Seguimiento de Cheques</h1>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span className="flex items-center gap-1.5">
            <Circle size={10} className="fill-green-500 text-green-500" />
            {disponiblesCount} disponible{disponiblesCount !== 1 ? 's' : ''}
          </span>
          <span className="font-mono text-gray-800">${formatMonto(montoDisponibleArs)} ARS</span>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Estado</label>
            <select
              value={estadoFiltro}
              onChange={(e) => setEstadoFiltro(e.target.value as EstadoFiltro)}
              className={selectCls}
            >
              <option value="todos">Todos</option>
              <option value="disponibles">Disponibles</option>
              <option value="usados">Usados</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Comprador</label>
            <input
              type="text"
              placeholder="Buscar comprador..."
              value={comprador}
              onChange={(e) => setComprador(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">F. Pago</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">N° Cheque</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Banco</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Comprador</th>
                <th className="text-right px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Monto</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap">Moneda</th>
                <th className="text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap w-56">Uso del Cheque</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-gray-400">
                    No hay cheques registrados
                  </td>
                </tr>
              ) : (
                filtrados.map((c) => {
                  const disponible = !c.uso_cheque || c.uso_cheque.trim() === ''
                  return (
                    <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-3 whitespace-nowrap text-gray-700">{formatDate(c.f_pago)}</td>
                      <td className="px-3 py-3 whitespace-nowrap font-mono text-gray-700">{c.n_cheque || '—'}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-gray-700">{c.banco || '—'}</td>
                      <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-800">{c.comprador}</td>
                      <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-gray-800">
                        {formatMonto(c.monto)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            c.moneda === 'usd' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'
                          }`}
                        >
                          {c.moneda.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-1 py-1">
                        <div className="flex items-center gap-1.5">
                          {disponible ? (
                            <Circle size={9} className="fill-green-500 text-green-500 flex-shrink-0" />
                          ) : (
                            <Check size={13} className="text-gray-400 flex-shrink-0" />
                          )}
                          <UsoCell ingreso={c} onSaved={refresh} />
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
