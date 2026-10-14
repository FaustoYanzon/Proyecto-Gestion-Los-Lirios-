'use client'

// Detalle de un lote de pasa con sus bines / bolsones. Se usa en dos pantallas:
// - "levantada": lote abierto -> agregar bin (pasero, kg, observaciones) e
//   imprimir la tarja de cada uno; al completarse, imprimir la hoja del lote.
// - "lotes": ver bines, cerrar el lote e imprimir (tarjas / hoja del lote).
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Printer } from 'lucide-react'
import { getParcelas } from '@/lib/api/produccion'
import { VARIEDAD_LABELS } from '@/lib/api/parcelas'
import {
  getLotePasa, agregarBinPasa, cerrarLotePasa, getStockPasero, getParametros,
  abrirTarjaPdf, abrirHojaLotePdf, errorDetail, type LotePasa,
} from '@/lib/api/altaProduccion'
import FormError from '@/components/ui/FormError'

const KG_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fmtKg = (n: number) => KG_FMT.format(n)
const fmtFecha = (iso: string) => iso.split('-').reverse().join('/')
const TODAY = new Date().toISOString().split('T')[0]

const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'
const thCls = 'text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide'
const thRCls = thCls.replace('text-left', 'text-right')
const btnPrimary = 'px-4 py-2 bg-[#7a1f2c] text-white rounded-lg text-sm font-semibold hover:bg-[#5a1320] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
const btnSecondary = 'px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors'

export const loteNombre = (l: LotePasa) =>
  `${VARIEDAD_LABELS[l.variedad]} C${l.calidad} · N° ${l.numero} (${l.temporada}/${l.temporada + 1})`

export function EstadoBadge({ estado }: { estado: 'abierto' | 'cerrado' }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
      estado === 'abierto' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
    }`}>
      {estado === 'abierto' ? 'Abierto' : 'Cerrado'}
    </span>
  )
}

export default function LoteDetalleModal({
  loteId, modo, nombreDeposito, onClose, onChanged,
}: {
  loteId: string
  /** levantada: se agregan bines; lotes: se puede cerrar el lote. */
  modo: 'levantada' | 'lotes'
  nombreDeposito: (id: string | null) => string
  onClose: () => void
  onChanged: () => Promise<unknown>
}) {
  const qc = useQueryClient()
  const [paseroId, setPaseroId] = useState('')
  const [kg, setKg] = useState('')
  const [obs, setObs] = useState('')
  const [fecha, setFecha] = useState(TODAY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimoBin, setUltimoBin] = useState<string | null>(null)

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
  const nominal = parametros?.kg_nominal_bin ?? null
  const disponible = paseroId ? stock.find((s) => s.variedad === lote.variedad)?.uva_disponible_kg ?? 0 : null
  // Misma cuenta que el backend: redondeo hacia abajo a 2 decimales.
  const maxima = disponible != null && parametros
    ? Math.floor((disponible / parametros.ratio_uva_pasa) * 100) / 100
    : null
  const kgNum = Number(kg.replace(',', '.'))
  const kgValido = /^\d+([.,]\d{1,2})?$/.test(kg.trim()) && kgNum > 0
  const excede = maxima != null && kgNum > maxima
  const progreso = lote.tope_bines ? Math.min(100, (lote.cantidad_bines / lote.tope_bines) * 100) : 0

  async function refrescar() {
    await qc.invalidateQueries({ queryKey: ['ap-lote', loteId] })
    await onChanged()
  }

  async function agregarBin() {
    if (!lote) return
    setSaving(true)
    setError(null)
    try {
      await agregarBinPasa(lote.id, {
        pasero_id: paseroId, kg_real: kg.trim().replace(',', '.'), fecha: fecha || null,
        observaciones: obs.trim() || null,
      })
      // La tarja la genera el backend: es la del último bin del lote.
      const d = await getLotePasa(lote.id)
      setUltimoBin(d.bines[d.bines.length - 1]?.tarja ?? null)
      setKg('')
      setObs('')
      await refrescar()
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
      await cerrarLotePasa(lote.id)
      await refrescar()
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      setSaving(false)
    }
  }

  async function imprimir(fn: () => Promise<void>) {
    setError(null)
    try { await fn() } catch (e) { setError(errorDetail(e, 'No se pudo generar el PDF')) }
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
              <p className="text-xs text-gray-500 uppercase">Bines / bolsones</p>
              <p className="text-lg font-bold font-mono text-gray-900">
                {lote.cantidad_bines}{lote.tope_bines != null ? ` / ${lote.tope_bines}` : ''}
              </p>
              {lote.tope_bines != null && (
                <div className="mt-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                  <div className="h-full bg-[#7a1f2c]" style={{ width: `${progreso}%` }} />
                </div>
              )}
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-xs text-gray-500 uppercase">Depósito</p>
              <p className="text-sm font-semibold text-gray-900 mt-1">{nombreDeposito(lote.deposito_id)}</p>
            </div>
          </div>

          {/* Lote completo: hoja con todo el detalle */}
          {!abierto && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-green-50 border border-green-200 p-3">
              <p className="text-sm text-green-800">Lote completo. Podés imprimir la hoja con el listado de bines y bolsones.</p>
              <button onClick={() => imprimir(() => abrirHojaLotePdf(lote.id))} className={`${btnPrimary} flex items-center gap-2 whitespace-nowrap`}>
                <Printer size={15} /> Imprimir hoja del lote
              </button>
            </div>
          )}

          {/* Bines, con la tarja a la derecha */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Bines / bolsones</h3>
            {lote.bines.length === 0 ? (
              <p className="text-sm text-gray-400">Todavía no tiene bines.</p>
            ) : (
              <div className="overflow-x-auto border border-gray-100 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className={thCls}>N°</th>
                      <th className={thCls}>Tarja</th>
                      <th className={thCls}>Fecha</th>
                      <th className={thCls}>Pasero</th>
                      <th className={thRCls}>Kg pasa</th>
                      <th className={thCls}>Observaciones</th>
                      <th className={thRCls}>Tarja</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {lote.bines.map((b, i) => (
                      <tr key={b.id} className={b.tarja === ultimoBin ? 'bg-green-50' : undefined}>
                        <td className="px-4 py-2 text-gray-500">{i + 1}</td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-800">{b.tarja}</td>
                        <td className="px-4 py-2 text-gray-700">{fmtFecha(b.fecha)}</td>
                        <td className="px-4 py-2 text-gray-700">{nombrePasero(b.pasero_id)}</td>
                        <td className="px-4 py-2 text-right font-mono text-gray-900">{fmtKg(b.kg_real)}</td>
                        <td className="px-4 py-2 text-gray-600 max-w-[200px] truncate" title={b.observaciones ?? ''}>{b.observaciones ?? ''}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            onClick={() => imprimir(() => abrirTarjaPdf(lote.id, b.id))}
                            title="Imprimir tarja"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-[#7a1f2c]"
                          >
                            <Printer size={13} /> Imprimir tarja
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Agregar bin (solo en Levantada y con el lote abierto) */}
          {modo === 'levantada' && abierto && (
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">
                Agregar bin / bolsón N° {lote.cantidad_bines + 1}{lote.tope_bines != null ? ` de ${lote.tope_bines}` : ''}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Pasero</label>
                  <select value={paseroId} onChange={(e) => setPaseroId(e.target.value)} className={inputCls}>
                    <option value="">— Seleccionar —</option>
                    {paseros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Peso real (kg)</label>
                  <input type="text" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Fecha</label>
                  <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>Observaciones (opcional)</label>
                <input
                  type="text" value={obs} maxLength={500} onChange={(e) => setObs(e.target.value)}
                  placeholder="Ej.: bolsón con humedad, bin golpeado…" className={inputCls}
                />
              </div>
              {nominal != null && (
                <p className="text-xs text-gray-500">
                  Peso teórico por bin: <b>{fmtKg(nominal)} kg</b>
                  {kgValido && ` · diferencia: ${kgNum - nominal > 0 ? '+' : ''}${fmtKg(kgNum - nominal)} kg`}
                </p>
              )}
              {disponible != null && maxima != null && parametros && (
                <p className={`text-xs ${excede ? 'text-red-600' : 'text-gray-500'}`}>
                  Uva disponible de {VARIEDAD_LABELS[lote.variedad]} en este pasero: <b>{fmtKg(disponible)} kg</b> ·
                  Pasa máxima levantable ({fmtKg(parametros.ratio_uva_pasa)}:1): <b>{fmtKg(maxima)} kg</b>
                  {kgValido && !excede && ` · Va a descontar ${fmtKg(kgNum * parametros.ratio_uva_pasa)} kg de uva`}
                </p>
              )}
              <div className="flex justify-end">
                <button onClick={agregarBin} disabled={saving || !paseroId || !kgValido || excede} className={btnPrimary}>
                  {saving ? 'Guardando...' : 'Agregar bin'}
                </button>
              </div>
            </div>
          )}

          {/* Cerrar a mano (solo en Lotes de pasa) */}
          {modo === 'lotes' && abierto && (
            <div className="rounded-lg border border-gray-200 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-gray-700">Cerrar lote</h3>
              <p className="text-xs text-gray-500">
                {lote.tope_bines != null
                  ? `Se cierra solo al llegar a ${lote.tope_bines} bines. `
                  : 'No hay tope de bines: se cierra a mano. '}
                No se puede cerrar sin bines; una vez cerrado no admite más bines.
              </p>
              <button onClick={cerrar} disabled={saving || lote.cantidad_bines === 0} className={btnSecondary}>
                Cerrar lote
              </button>
            </div>
          )}

          {error && <FormError description={error} />}
        </div>
      </div>
    </div>
  )
}
