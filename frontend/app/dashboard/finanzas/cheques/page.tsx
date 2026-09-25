'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Circle, ChevronLeft, ChevronRight } from 'lucide-react'
import { getIngresos, updateIngreso, type IngresoResponse } from '@/lib/api/ingresos'
import { getEgresos } from '@/lib/api/egresos'
import { usePaginatedList } from '@/lib/usePaginatedList'

const PAGE_SIZE = 10

// ─── Seguimiento de cheques ─────────────────────────────────────────────────
// Cheques y echeques, recibidos (Ingresos) y emitidos (Egresos). La Fecha de
// Pago (f_pago, "F PAGO" de BD Cobros) es desde cuándo se puede cobrar / se
// debita, y es cuando el movimiento impacta en el flujo. Ese día sale un aviso
// push a super_admin y gerencial (backend app/core/cheques_aviso.py).
// En recibidos, uso_cheque vacío = sigue en cartera; con texto = ya se aplicó
// a algo (equivalente a la hoja "SEGUI CHEQUES").

type Vista = 'recibidos' | 'emitidos'
type TipoFiltro = 'todos' | 'cheque' | 'echeque'
type EstadoFiltro = 'todos' | 'disponibles' | 'usados'

interface ChequeRow {
  id: string
  tipo: 'cheque' | 'echeque'
  fecha: string
  f_pago?: string | null
  n_cheque?: string | null
  banco?: string | null
  contraparte: string
  monto: number
  moneda: 'ars' | 'usd'
  ingreso?: IngresoResponse
}

const TIPO_LABELS = { cheque: 'Cheque', echeque: 'eCheque' } as const

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

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function diasHasta(fechaIso: string, hoy: string): number {
  const ms = new Date(`${fechaIso}T00:00:00`).getTime() - new Date(`${hoy}T00:00:00`).getTime()
  return Math.round(ms / 86_400_000)
}

function EstadoPago({ fPago, vista, hoy }: { fPago?: string | null; vista: Vista; hoy: string }) {
  if (!fPago) return <span className="text-xs text-gray-400">Sin fecha</span>
  const dias = diasHasta(fPago, hoy)
  let texto: string
  let cls: string
  if (dias < 0) {
    texto = vista === 'recibidos' ? 'Cobrable' : 'Debitado'
    cls = vista === 'recibidos' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200'
  } else if (dias === 0) {
    texto = vista === 'recibidos' ? 'Cobrable hoy' : 'Se debita hoy'
    cls = 'bg-green-50 text-green-700 border-green-200'
  } else {
    texto = dias === 1 ? 'Mañana' : `En ${dias} días`
    cls = dias <= 7 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-gray-50 text-gray-600 border-gray-200'
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${cls}`}>
      {texto}
    </span>
  )
}

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

function enCartera(c: ChequeRow): boolean {
  return !c.ingreso?.uso_cheque || c.ingreso.uso_cheque.trim() === ''
}

function sumaArs(rows: ChequeRow[]): number {
  return rows.filter((c) => c.moneda === 'ars').reduce((s, c) => s + Number(c.monto), 0)
}

export default function ChequesPage() {
  const queryClient = useQueryClient()
  const [vista, setVista] = useState<Vista>('recibidos')
  const [tipoFiltro, setTipoFiltro] = useState<TipoFiltro>('todos')
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>('todos')
  const [busqueda, setBusqueda] = useState('')
  const hoy = hoyIso()

  const { data: recibidos = [], isLoading: loadingRecibidos } = useQuery({
    queryKey: ['ingresos-cheques'],
    queryFn: async (): Promise<ChequeRow[]> => {
      const [cheque, echeque] = await Promise.all([
        getIngresos({ forma_pago: 'cheque', limit: 10000 }),
        getIngresos({ forma_pago: 'echeque', limit: 10000 }),
      ])
      return [...cheque, ...echeque].map((i) => ({
        id: i.id,
        tipo: i.forma_pago as 'cheque' | 'echeque',
        fecha: i.fecha,
        f_pago: i.f_pago,
        n_cheque: i.n_cheque,
        banco: i.banco,
        contraparte: i.comprador,
        monto: Number(i.monto),
        moneda: i.moneda,
        ingreso: i,
      }))
    },
    staleTime: 30_000,
  })

  const { data: emitidos = [], isLoading: loadingEmitidos } = useQuery({
    queryKey: ['egresos-cheques'],
    queryFn: async (): Promise<ChequeRow[]> => {
      const [cheque, echeque] = await Promise.all([
        getEgresos({ forma_pago: 'cheque', limit: 10000 }),
        getEgresos({ forma_pago: 'echeque', limit: 10000 }),
      ])
      return [...cheque, ...echeque].map((e) => ({
        id: e.id,
        tipo: e.forma_pago as 'cheque' | 'echeque',
        fecha: e.fecha,
        f_pago: e.f_pago,
        n_cheque: e.n_cheque,
        banco: e.banco,
        contraparte: e.descripcion || '—',
        monto: Number(e.monto),
        moneda: e.moneda,
      }))
    },
    staleTime: 30_000,
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['ingresos-cheques'] })
  }

  const cheques = vista === 'recibidos' ? recibidos : emitidos
  const isLoading = vista === 'recibidos' ? loadingRecibidos : loadingEmitidos

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return cheques
      .filter((c) => {
        if (tipoFiltro !== 'todos' && c.tipo !== tipoFiltro) return false
        if (vista === 'recibidos' && estadoFiltro === 'disponibles' && !enCartera(c)) return false
        if (vista === 'recibidos' && estadoFiltro === 'usados' && enCartera(c)) return false
        if (q && !c.contraparte.toLowerCase().includes(q) && !(c.n_cheque ?? '').includes(q)) return false
        return true
      })
      // Más reciente/próxima Fecha de Pago primero; sin fecha, por fecha de carga.
      .sort((a, b) => ((b.f_pago ?? b.fecha) > (a.f_pago ?? a.fecha) ? 1 : -1))
  }, [cheques, vista, tipoFiltro, estadoFiltro, busqueda])

  const { page, setPage, totalPages, paged: pagedCheques } = usePaginatedList(filtrados, PAGE_SIZE)

  // Resumen del encabezado.
  const cartera = recibidos.filter(enCartera)
  const cobrables = cartera.filter((c) => c.f_pago && c.f_pago <= hoy)
  const en30 = (() => {
    const limite = new Date(`${hoy}T00:00:00`)
    limite.setDate(limite.getDate() + 30)
    const lim = limite.toISOString().split('T')[0]
    return emitidos.filter((c) => c.f_pago && c.f_pago >= hoy && c.f_pago <= lim)
  })()

  const selectCls =
    'rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
  const th = 'text-left px-3 py-3 font-medium text-gray-600 whitespace-nowrap'
  const columnas = vista === 'recibidos' ? 10 : 9

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Seguimiento de Cheques</h1>
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
          {vista === 'recibidos' ? (
            <>
              <span className="flex items-center gap-1.5">
                <Circle size={10} className="fill-green-500 text-green-500" />
                {cartera.length} en cartera · <span className="font-mono text-gray-800">${formatMonto(sumaArs(cartera))}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Check size={13} className="text-green-600" />
                {cobrables.length} ya cobrable{cobrables.length !== 1 ? 's' : ''} · <span className="font-mono text-gray-800">${formatMonto(sumaArs(cobrables))}</span>
              </span>
            </>
          ) : (
            <span>
              A debitar en 30 días: {en30.length} · <span className="font-mono text-gray-800">${formatMonto(sumaArs(en30))}</span>
            </span>
          )}
        </div>
      </div>

      {/* Vista */}
      <div className="flex gap-2">
        {([
          { value: 'recibidos', label: `Recibidos (${recibidos.length})` },
          { value: 'emitidos', label: `Emitidos (${emitidos.length})` },
        ] as const).map((t) => (
          <button
            key={t.value}
            onClick={() => { setVista(t.value); setPage(1) }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              vista === t.value
                ? 'bg-[#7a1f2c] text-white'
                : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tipo</label>
            <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value as TipoFiltro)} className={selectCls}>
              <option value="todos">Cheques y eCheques</option>
              <option value="cheque">Solo cheques</option>
              <option value="echeque">Solo eCheques</option>
            </select>
          </div>
          {vista === 'recibidos' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Estado</label>
              <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value as EstadoFiltro)} className={selectCls}>
                <option value="todos">Todos</option>
                <option value="disponibles">En cartera</option>
                <option value="usados">Usados</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {vista === 'recibidos' ? 'Comprador o N°' : 'Descripción o N°'}
            </label>
            <input
              type="text"
              placeholder="Buscar..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className={selectCls}
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
                <th className={th}>Tipo</th>
                <th className={th}>{vista === 'recibidos' ? 'Recibido' : 'Emitido'}</th>
                <th className={th}>Fecha de Pago</th>
                <th className={th}>Estado</th>
                <th className={th}>N° Cheque</th>
                <th className={th}>Banco</th>
                <th className={th}>{vista === 'recibidos' ? 'Comprador' : 'Descripción'}</th>
                <th className={`${th} text-right`}>Monto</th>
                <th className={th}>Moneda</th>
                {vista === 'recibidos' && <th className={`${th} w-56`}>Uso del Cheque</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: columnas }).map((_, j) => (
                      <td key={j} className="px-3 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtrados.length === 0 ? (
                <tr>
                  <td colSpan={columnas} className="px-3 py-12 text-center text-gray-400">
                    {vista === 'recibidos' ? 'No hay cheques recibidos' : 'No hay cheques emitidos (se cargan desde Egresos con forma de pago Cheque o eCheque)'}
                  </td>
                </tr>
              ) : (
                pagedCheques.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-3 whitespace-nowrap text-gray-700">{TIPO_LABELS[c.tipo]}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-500">{formatDate(c.fecha)}</td>
                    <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-800">{formatDate(c.f_pago)}</td>
                    <td className="px-3 py-3"><EstadoPago fPago={c.f_pago} vista={vista} hoy={hoy} /></td>
                    <td className="px-3 py-3 whitespace-nowrap font-mono text-gray-700">{c.n_cheque || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-700">{c.banco || '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap font-medium text-gray-800">{c.contraparte}</td>
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
                    {vista === 'recibidos' && c.ingreso && (
                      <td className="px-1 py-1">
                        <div className="flex items-center gap-1.5">
                          {enCartera(c) ? (
                            <Circle size={9} className="fill-green-500 text-green-500 flex-shrink-0" />
                          ) : (
                            <Check size={13} className="text-gray-400 flex-shrink-0" />
                          )}
                          <UsoCell ingreso={c.ingreso} onSaved={refresh} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!isLoading && totalPages > 1 && (
          <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="text-xs text-gray-500">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtrados.length)} de {filtrados.length}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
