'use client'

import { useQuery } from '@tanstack/react-query'
import { VARIEDAD_LABELS } from '@/lib/api/parcelas'
import { getLotesPasa, getDepositos, errorDetail, type LotePasa } from '@/lib/api/altaProduccion'
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

const loteNombre = (l: LotePasa) =>
  `${VARIEDAD_LABELS[l.variedad]} C${l.calidad} · N° ${l.numero} (${l.temporada}/${l.temporada + 1})`

/** Inventario de pasa: solo lectura. La operatoria (abrir lote, agregar bines,
 *  cerrar, entregar) se hace en Alta de producción → Lotes de pasa y Remitos. */
export default function ProductoTerminadoPage() {
  const { data: lotes = [], isLoading, error } = useQuery({
    queryKey: ['ap-lotes', '', ''], queryFn: () => getLotesPasa(), staleTime: 30_000,
  })
  const { data: depositos = [] } = useQuery({ queryKey: ['ap-depositos'], queryFn: () => getDepositos(), staleTime: 60_000 })

  const sum = (ls: LotePasa[], f: (l: LotePasa) => number) => ls.reduce((s, l) => s + f(l), 0)
  const abiertos = lotes.filter((l) => l.estado === 'abierto')
  const cerrados = lotes.filter((l) => l.estado === 'cerrado')
  const conSaldo = lotes.filter((l) => l.saldo_kg > 0)

  const nombreDeposito = (id: string | null) =>
    id ? depositos.find((d) => d.id === id)?.nombre ?? 'Depósito' : 'Sin depósito asignado'
  const porDeposito = new Map<string, number>()
  for (const l of conSaldo) {
    const k = l.deposito_id ?? ''
    porDeposito.set(k, (porDeposito.get(k) ?? 0) + l.saldo_kg)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Producto Terminado</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Pasa en stock, por lote. Solo lectura: los lotes se cargan en Alta de producción y se descuentan con los remitos de entrega.
        </p>
      </div>

      {error && <FormError description={errorDetail(error, 'No se pudo cargar el inventario')} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card label="Pasa cargada en lotes" value={`${fmtKg(sum(lotes, (l) => l.kg_total))} kg`} tone="blue" />
        <Card label="Pasa en lotes abiertos (saldo)" value={`${fmtKg(sum(abiertos, (l) => l.saldo_kg))} kg`} tone="amber" />
        <Card label="Pasa en lotes cerrados (entregable)" value={`${fmtKg(sum(cerrados, (l) => l.saldo_kg))} kg`} tone="green" />
      </div>

      <Seccion titulo="Stock por lote" nota="Disponible = kilos del lote − kilos ya entregados por remito.">
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : lotes.length === 0 ? (
          <p className="px-5 py-10 text-center text-gray-400 text-sm">Todavía no hay lotes de pasa</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls}>Lote</th>
                  <th className={thCls}>Estado</th>
                  <th className={thCls}>Depósito</th>
                  <th className={thRCls}>Cargado kg</th>
                  <th className={thRCls}>Entregado kg</th>
                  <th className={thRCls}>Disponible kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lotes.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-900">{loteNombre(l)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                        l.estado === 'abierto' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {l.estado === 'abierto' ? 'Abierto' : 'Cerrado'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{nombreDeposito(l.deposito_id)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(l.kg_total)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(l.kg_total - l.saldo_kg)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-green-700">{fmtKg(l.saldo_kg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      <Seccion titulo="Stock por depósito" nota="Disponible de los lotes con pasa pendiente de entrega, según el depósito asignado al lote.">
        {porDeposito.size === 0 ? (
          <p className="px-5 py-8 text-center text-gray-400 text-sm">No hay pasa con saldo</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls}>Depósito</th><th className={thRCls}>Disponible kg</th>
                </tr>
              </thead>
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
