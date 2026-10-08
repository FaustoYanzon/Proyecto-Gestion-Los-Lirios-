'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, Eye, ChevronLeft, ChevronRight } from 'lucide-react'
import { usePaginatedList } from '@/lib/usePaginatedList'
import { getParcelas } from '@/lib/api/produccion'
import { VARIEDAD_VALUES, VARIEDAD_LABELS, type VariedadUva } from '@/lib/api/parcelas'
import {
  getLotesPasa, getLotePasa, abrirLotePasa, agregarBinPasa, cerrarLotePasa,
  getStockPasero, getParametros, getDepositos, errorDetail,
  type EstadoLote, type LotePasa,
} from '@/lib/api/altaProduccion'
import FormError from '@/components/ui/FormError'

const PAGE_SIZE = 10
const KG_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fmtKg = (n: number) => KG_FMT.format(n)
const fmtFecha = (iso: string) => iso.split('-').reverse().join('/')
const TODAY = new Date().toISOString().split('T')[0]

const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
const selectFiltroCls = 'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'
const thCls = 'text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide'
const thRCls = thCls.replace('text-left', 'text-right')
const btnPrimary = 'px-4 py-2 bg-[#7a1f2c] text-white rounded-lg text-sm font-semibold hover:bg-[#5a1320] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
const btnSecondary = 'px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors'

const loteNombre = (l: LotePasa) => `${VARIEDAD_LABELS[l.variedad]} C${l.calidad} · N° ${l.numero} (${l.temporada}/${l.temporada + 1})`

function EstadoBadge({ estado }: { estado: EstadoLote }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
      estado === 'abierto' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
    }`}>
      {estado === 'abierto' ? 'Abierto' : 'Cerrado'}
    </span>
  )
}

export default function LotesPage() {
  const qc = useQueryClient()
  const [estado, setEstado] = useState<'' | EstadoLote>('')
  const [variedad, setVariedad] = useState<'' | VariedadUva>('')
  const [calidad, setCalidad] = useState<'' | '1' | '2'>('')
  const [showNuevo, setShowNuevo] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const { data: lotes = [], isLoading, error: loadError } = useQuery({
    queryKey: ['ap-lotes', estado, variedad],
    queryFn: () => getLotesPasa({ estado: estado || undefined, variedad: variedad || undefined }),
    staleTime: 30_000,
  })
  const { data: depositos = [] } = useQuery({ queryKey: ['ap-depositos'], queryFn: () => getDepositos(), staleTime: 60_000 })
  const nombreDeposito = (id: string | null) => (id ? depositos.find((d) => d.id === id)?.nombre ?? '–' : '–')

  // El backend no filtra por calidad: se filtra acá.
  // useMemo: usePaginatedList depende de la identidad del array.
  const filtrados = useMemo(
    () => (calidad ? lotes.filter((l) => String(l.calidad) === calidad) : lotes),
    [lotes, calidad],
  )
  const { page, setPage, totalPages, paged } = usePaginatedList(filtrados, PAGE_SIZE)

  const refrescar = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['ap-lotes'] }),
    qc.invalidateQueries({ queryKey: ['ap-lote'] }),
    qc.invalidateQueries({ queryKey: ['ap-stock'] }),
  ])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Lotes de pasa</h1>
          <p className="text-sm text-gray-500 mt-0.5">Un lote abierto por variedad y calidad; la pasa se entrega solo de lotes cerrados</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={estado} onChange={(e) => setEstado(e.target.value as '' | EstadoLote)} className={selectFiltroCls}>
            <option value="">Todos los estados</option>
            <option value="abierto">Abiertos</option>
            <option value="cerrado">Cerrados</option>
          </select>
          <select value={variedad} onChange={(e) => setVariedad(e.target.value as '' | VariedadUva)} className={selectFiltroCls}>
            <option value="">Todas las variedades</option>
            {VARIEDAD_VALUES.map((v) => <option key={v} value={v}>{VARIEDAD_LABELS[v]}</option>)}
          </select>
          <select value={calidad} onChange={(e) => setCalidad(e.target.value as '' | '1' | '2')} className={selectFiltroCls}>
            <option value="">Toda calidad</option>
            <option value="1">Calidad 1</option>
            <option value="2">Calidad 2</option>
          </select>
          <button
            onClick={() => setShowNuevo(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#7a1f2c] text-white text-sm font-semibold rounded-lg hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={16} /> Abrir lote
          </button>
        </div>
      </div>

      {loadError && <FormError description={errorDetail(loadError, 'No se pudo cargar el listado')} />}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Lotes</h3>
          <span className="text-xs text-gray-400">{filtrados.length} registros</span>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : filtrados.length === 0 ? (
          <p className="px-5 py-10 text-center text-gray-400 text-sm">No hay lotes para mostrar</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls}>Lote</th>
                  <th className={thCls}>Estado</th>
                  <th className={thRCls}>Bines</th>
                  <th className={thRCls}>Kg total</th>
                  <th className={thRCls}>Saldo kg</th>
                  <th className={thRCls}>Merma bines kg</th>
                  <th className={thCls}>Depósito</th>
                  <th className={thRCls}>Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paged.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-900 font-medium">{loteNombre(l)}</td>
                    <td className="px-4 py-2.5"><EstadoBadge estado={l.estado} /></td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {l.cantidad_bines}{l.tope_bines != null ? ` / ${l.tope_bines}` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(l.kg_total)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-green-700">{fmtKg(l.saldo_kg)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(l.merma_bines_kg)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{nombreDeposito(l.deposito_id)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => setDetalleId(l.id)}
                        title="Ver detalle"
                        className="p-1.5 rounded text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

      {showNuevo && (
        <NuevoLoteModal
          depositos={depositos.filter((d) => d.is_active)}
          onClose={() => setShowNuevo(false)}
          onCreated={async (l) => { await refrescar(); setShowNuevo(false); setDetalleId(l.id) }}
        />
      )}
      {detalleId && (
        <DetalleLoteModal
          loteId={detalleId}
          depositos={depositos.filter((d) => d.is_active)}
          nombreDeposito={nombreDeposito}
          onClose={() => setDetalleId(null)}
          onChanged={refrescar}
        />
      )}
    </div>
  )
}

// ── Abrir lote ────────────────────────────────────────────────────────────────

function NuevoLoteModal({
  depositos, onClose, onCreated,
}: {
  depositos: { id: string; nombre: string }[]
  onClose: () => void
  onCreated: (l: LotePasa) => Promise<void>
}) {
  const [variedad, setVariedad] = useState<VariedadUva>('sultanina')
  const [calidad, setCalidad] = useState('1')
  const [fecha, setFecha] = useState(TODAY)
  const [depositoId, setDepositoId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    setSaving(true)
    setError(null)
    try {
      const l = await abrirLotePasa({
        variedad, calidad: Number(calidad), fecha: fecha || null, deposito_id: depositoId || null,
      })
      await onCreated(l)
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Abrir lote de pasa</h2>
          <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Variedad</label>
              <select value={variedad} onChange={(e) => setVariedad(e.target.value as VariedadUva)} className={inputCls}>
                {VARIEDAD_VALUES.map((v) => <option key={v} value={v}>{VARIEDAD_LABELS[v]}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Calidad</label>
              <select value={calidad} onChange={(e) => setCalidad(e.target.value)} className={inputCls}>
                <option value="1">1</option>
                <option value="2">2</option>
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Fecha (define la campaña)</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Depósito (opcional, se puede asignar al cerrar)</label>
            <select value={depositoId} onChange={(e) => setDepositoId(e.target.value)} className={inputCls}>
              <option value="">Sin depósito</option>
              {depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
          {error && <FormError description={error} />}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={saving} className={btnPrimary}>{saving ? 'Abriendo...' : 'Abrir lote'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Detalle del lote ──────────────────────────────────────────────────────────

function DetalleLoteModal({
  loteId, depositos, nombreDeposito, onClose, onChanged,
}: {
  loteId: string
  depositos: { id: string; nombre: string }[]
  nombreDeposito: (id: string | null) => string
  onClose: () => void
  onChanged: () => Promise<unknown>
}) {
  const [paseroId, setPaseroId] = useState('')
  const [kg, setKg] = useState('')
  const [fecha, setFecha] = useState(TODAY)
  const [depositoCierre, setDepositoCierre] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: lote, isLoading } = useQuery({
    queryKey: ['ap-lote', loteId], queryFn: () => getLotePasa(loteId),
  })
  const { data: parcelas = [] } = useQuery({ queryKey: ['parcelas'], queryFn: getParcelas, staleTime: 300_000 })
  const paseros = parcelas.filter((p) => p.tipo === 'pasero' && p.is_active)
  const nombrePasero = (id: string) => parcelas.find((p) => p.id === id)?.nombre ?? '–'
  const { data: parametros } = useQuery({ queryKey: ['ap-parametros'], queryFn: getParametros, staleTime: 60_000 })

  const { data: stock = [] } = useQuery({
    queryKey: ['ap-stock', paseroId],
    queryFn: () => getStockPasero(paseroId),
    enabled: !!paseroId,
  })

  if (isLoading || !lote) {
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-8 text-sm text-gray-500">Cargando lote...</div>
      </div>
    )
  }

  const abierto = lote.estado === 'abierto'
  const disponible = paseroId
    ? stock.find((s) => s.variedad === lote.variedad)?.uva_disponible_kg ?? 0
    : null
  // Misma cuenta que el backend: redondeo hacia abajo a 2 decimales.
  const maxima = disponible != null && parametros
    ? Math.floor((disponible / parametros.ratio_uva_pasa) * 100) / 100
    : null
  const kgNum = Number(kg.replace(',', '.'))
  const excede = maxima != null && kgNum > maxima
  const kgValido = /^\d+([.,]\d{1,2})?$/.test(kg.trim()) && kgNum > 0

  async function refrescarTodo() {
    await qc.invalidateQueries({ queryKey: ['ap-lote', loteId] })
    await onChanged()
  }

  async function agregarBin() {
    if (!lote) return
    setSaving(true)
    setError(null)
    try {
      await agregarBinPasa(lote.id, { pasero_id: paseroId, kg_real: kg.trim().replace(',', '.'), fecha: fecha || null })
      setKg('')
      await refrescarTodo()
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      setSaving(false)
    }
  }

  async function cerrar() {
    if (!lote) return
    setSaving(true)
    setError(null)
    try {
      await cerrarLotePasa(lote.id, depositoCierre || null)
      await refrescarTodo()
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900">{loteNombre(lote)}</h2>
            <EstadoBadge estado={lote.estado} />
          </div>
          <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500 uppercase">Kg total</p>
              <p className="text-lg font-bold font-mono text-gray-900">{fmtKg(lote.kg_total)}</p>
            </div>
            <div className="rounded-lg bg-green-50 border border-green-100 p-3">
              <p className="text-xs text-green-700 uppercase">Saldo kg</p>
              <p className="text-lg font-bold font-mono text-green-800">{fmtKg(lote.saldo_kg)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500 uppercase">Bines</p>
              <p className="text-lg font-bold font-mono text-gray-900">
                {lote.cantidad_bines}{lote.tope_bines != null ? ` / ${lote.tope_bines}` : ''}
              </p>
              {lote.tope_bines == null && <p className="text-xs text-gray-400">Sin tope</p>}
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500 uppercase">Depósito</p>
              <p className="text-sm font-semibold text-gray-900 mt-1">{nombreDeposito(lote.deposito_id)}</p>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Bines</h3>
            {lote.bines.length === 0 ? (
              <p className="text-sm text-gray-400">Todavía no tiene bines</p>
            ) : (
              <div className="overflow-x-auto border border-gray-100 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className={thCls}>#</th>
                      <th className={thCls}>Fecha</th>
                      <th className={thCls}>Pasero</th>
                      <th className={thRCls}>Kg pasa</th>
                      <th className={thRCls}>Uva consumida kg</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {lote.bines.map((b, i) => (
                      <tr key={b.id}>
                        <td className="px-4 py-2 text-gray-500">{i + 1}</td>
                        <td className="px-4 py-2 text-gray-700">{fmtFecha(b.fecha)}</td>
                        <td className="px-4 py-2 text-gray-700">{nombrePasero(b.pasero_id)}</td>
                        <td className="px-4 py-2 text-right font-mono text-gray-900">{fmtKg(b.kg_real)}</td>
                        <td className="px-4 py-2 text-right font-mono text-gray-600">{fmtKg(b.uva_consumida_kg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {abierto && (
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">Agregar bin</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Pasero</label>
                  <select value={paseroId} onChange={(e) => setPaseroId(e.target.value)} className={inputCls}>
                    <option value="">— Seleccionar —</option>
                    {paseros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Kg de pasa (báscula)</label>
                  <input type="text" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Fecha</label>
                  <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
                </div>
              </div>
              {disponible != null && maxima != null && parametros && (
                <p className={`text-xs ${excede ? 'text-red-600' : 'text-gray-500'}`}>
                  Uva disponible de {VARIEDAD_LABELS[lote.variedad]} en este pasero: <b>{fmtKg(disponible)} kg</b> ·
                  Pasa máxima levantable ({fmtKg(parametros.ratio_uva_pasa)}:1): <b>{fmtKg(maxima)} kg</b>
                  {kgValido && !excede && ` · Va a descontar ${fmtKg(kgNum * parametros.ratio_uva_pasa)} kg de uva`}
                </p>
              )}
              <div className="flex justify-end">
                <button onClick={agregarBin} disabled={saving || !paseroId || !kgValido} className={btnPrimary}>
                  {saving ? 'Guardando...' : 'Agregar bin'}
                </button>
              </div>

              <div className="border-t border-gray-100 pt-3 space-y-2">
                <h3 className="text-sm font-semibold text-gray-700">Cerrar lote</h3>
                <p className="text-xs text-gray-500">
                  {lote.tope_bines != null
                    ? `Se cierra solo al llegar a ${lote.tope_bines} bines. `
                    : 'No hay tope de bines: se cierra a mano. '}
                  No se puede cerrar sin bines; una vez cerrado no admite más bines.
                </p>
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="min-w-[200px]">
                    <label className={labelCls}>Depósito</label>
                    <select value={depositoCierre} onChange={(e) => setDepositoCierre(e.target.value)} className={inputCls}>
                      <option value="">{lote.deposito_id ? 'Mantener el actual' : 'Sin depósito'}</option>
                      {depositos.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                    </select>
                  </div>
                  <button onClick={cerrar} disabled={saving || lote.cantidad_bines === 0} className={btnSecondary}>
                    Cerrar lote
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && <FormError description={error} />}
        </div>
      </div>
    </div>
  )
}
