'use client'

import { useQuery } from '@tanstack/react-query'
import { VARIEDAD_LABELS } from '@/lib/api/parcelas'
import {
  getStockPasero, getLotesPasa, getDepositos, errorDetail,
  type LotePasa,
} from '@/lib/api/altaProduccion'
import FormError from '@/components/ui/FormError'

const KG_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fmtKg = (n: number) => KG_FMT.format(n)

const thCls = 'text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide'
const thRCls = thCls.replace('text-left', 'text-right')

function Card({ label, value, tone }: { label: string; value: string; tone: 'green' | 'amber' | 'blue' }) {
  const s = {
    green: 'bg-green-50 border-green-100 text-green-700 text-green-800',
    amber: 'bg-amber-50 border-amber-100 text-amber-700 text-amber-800',
    blue: 'bg-blue-50 border-blue-100 text-blue-700 text-blue-800',
  }[tone].split(' ')
  return (
    <div className={`${s[0]} rounded-lg border ${s[1]} shadow-sm p-4`}>
      <p className={`text-xs font-medium ${s[2]} uppercase tracking-wide`}>{label}</p>
      <p className={`text-2xl font-bold ${s[3]} mt-1`}>{value}</p>
    </div>
  )
}

function Seccion({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-700">{titulo}</h3>
        {nota && <p className="text-xs text-gray-400 mt-0.5">{nota}</p>}
      </div>
      {children}
    </div>
  )
}

export default function StockPage() {
  const { data: stock = [], error: e1 } = useQuery({ queryKey: ['ap-stock', ''], queryFn: () => getStockPasero(), staleTime: 30_000 })
  const { data: lotes = [], error: e2 } = useQuery({ queryKey: ['ap-lotes', '', ''], queryFn: () => getLotesPasa(), staleTime: 30_000 })
  const { data: depositos = [] } = useQuery({ queryKey: ['ap-depositos'], queryFn: () => getDepositos(), staleTime: 60_000 })

  // Uva disponible por variedad (suma de paseros).
  const uvaPorVariedad = new Map<string, { ingresada: number; disponible: number }>()
  for (const s of stock) {
    const a = uvaPorVariedad.get(s.variedad) ?? { ingresada: 0, disponible: 0 }
    a.ingresada += s.uva_ingresada_kg
    a.disponible += s.uva_disponible_kg
    uvaPorVariedad.set(s.variedad, a)
  }
  const uvaTotal = [...uvaPorVariedad.values()].reduce((s, v) => s + v.disponible, 0)

  const sum = (ls: LotePasa[], f: (l: LotePasa) => number) => ls.reduce((s, l) => s + f(l), 0)
  const abiertos = lotes.filter((l) => l.estado === 'abierto')
  const cerrados = lotes.filter((l) => l.estado === 'cerrado')

  // Pasa por variedad y estado.
  const variedadesPasa = [...new Set(lotes.map((l) => l.variedad))]

  // Stock por depósito: saldo de todos los lotes con saldo, agrupado por depósito.
  const nombreDeposito = (id: string | null) => (id ? depositos.find((d) => d.id === id)?.nombre ?? 'Depósito' : 'Sin depósito asignado')
  const porDeposito = new Map<string, number>()
  for (const l of lotes) {
    if (l.saldo_kg <= 0) continue
    const k = l.deposito_id ?? ''
    porDeposito.set(k, (porDeposito.get(k) ?? 0) + l.saldo_kg)
  }

  const error = e1 ?? e2

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Stock</h1>
        <p className="text-sm text-gray-500 mt-0.5">Uva en pasero, pasa en lotes y stock por depósito</p>
      </div>

      {error && <FormError description={errorDetail(error, 'No se pudo cargar el stock')} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card label="Uva disponible en pasero" value={`${fmtKg(uvaTotal)} kg`} tone="green" />
        <Card label="Pasa en lotes abiertos" value={`${fmtKg(sum(abiertos, (l) => l.saldo_kg))} kg`} tone="amber" />
        <Card label="Pasa en lotes cerrados (entregable)" value={`${fmtKg(sum(cerrados, (l) => l.saldo_kg))} kg`} tone="blue" />
      </div>

      <Seccion titulo="Uva fresca en pasero por variedad" nota="Suma de todos los paseros. Disponible = ingresada − consumida por la levantada de pasa.">
        {uvaPorVariedad.size === 0 ? (
          <p className="px-5 py-8 text-center text-gray-400 text-sm">Sin uva ingresada</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className={thCls}>Variedad</th><th className={thRCls}>Ingresada kg</th><th className={thRCls}>Disponible kg</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {[...uvaPorVariedad.entries()].map(([v, a]) => (
                  <tr key={v} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-900">{VARIEDAD_LABELS[v as keyof typeof VARIEDAD_LABELS] ?? v}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(a.ingresada)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-green-700">{fmtKg(a.disponible)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      <Seccion titulo="Pasa en lotes por variedad" nota="Saldo = kilos del lote que todavía no se entregaron.">
        {variedadesPasa.length === 0 ? (
          <p className="px-5 py-8 text-center text-gray-400 text-sm">Todavía no hay lotes</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className={thCls}>Variedad</th>
                <th className={thRCls}>Abiertos: saldo kg</th>
                <th className={thRCls}>Cerrados: saldo kg</th>
                <th className={thRCls}>Cerrados: kg total</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {variedadesPasa.map((v) => {
                  const ab = abiertos.filter((l) => l.variedad === v)
                  const ce = cerrados.filter((l) => l.variedad === v)
                  return (
                    <tr key={v} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-900">{VARIEDAD_LABELS[v]}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-amber-700">{fmtKg(sum(ab, (l) => l.saldo_kg))}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-blue-700">{fmtKg(sum(ce, (l) => l.saldo_kg))}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-600">{fmtKg(sum(ce, (l) => l.kg_total))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      <Seccion titulo="Stock por depósito" nota="Saldo de los lotes con pasa pendiente de entrega, según el depósito asignado al lote.">
        {porDeposito.size === 0 ? (
          <p className="px-5 py-8 text-center text-gray-400 text-sm">No hay pasa con saldo</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                <th className={thCls}>Depósito</th><th className={thRCls}>Saldo kg</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {[...porDeposito.entries()].map(([id, kg]) => (
                  <tr key={id || 'none'} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-900">{nombreDeposito(id || null)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-gray-900">{fmtKg(kg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>
    </div>
  )
}
