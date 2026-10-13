'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { getParcelas } from '@/lib/api/produccion'
import { VARIEDAD_VALUES, VARIEDAD_LABELS, type VariedadUva } from '@/lib/api/parcelas'
import {
  getLotesPasa, getLotePasa, abrirLotePasa, agregarBinPasa,
  getStockPasero, getParametros, errorDetail,
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

export default function LevantadaPage() {
  const qc = useQueryClient()
  const [variedad, setVariedad] = useState<VariedadUva>('sultanina')
  const [calidad, setCalidad] = useState('1')
  const [paseroId, setPaseroId] = useState('')
  const [kg, setKg] = useState('')
  const [fecha, setFecha] = useState(TODAY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultima, setUltima] = useState<{ tarja: string; cerrado: boolean; n: number; tope: number | null } | null>(null)

  // Lote abierto de esa variedad y calidad (a lo sumo uno).
  const { data: abiertos = [], isLoading } = useQuery({
    queryKey: ['ap-lotes', 'abierto', variedad],
    queryFn: () => getLotesPasa({ estado: 'abierto', variedad }),
  })
  const lote = abiertos.find((l) => String(l.calidad) === calidad) ?? null

  const { data: detalle } = useQuery({
    queryKey: ['ap-lote', lote?.id],
    queryFn: () => getLotePasa(lote!.id),
    enabled: !!lote,
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

  const disponible = paseroId ? stock.find((s) => s.variedad === variedad)?.uva_disponible_kg ?? 0 : null
  // Misma cuenta que el backend: redondeo hacia abajo a 2 decimales.
  const maxima = disponible != null && parametros
    ? Math.floor((disponible / parametros.ratio_uva_pasa) * 100) / 100
    : null
  const kgNum = Number(kg.replace(',', '.'))
  const kgValido = /^\d+([.,]\d{1,2})?$/.test(kg.trim()) && kgNum > 0
  const excede = maxima != null && kgNum > maxima
  const nominal = parametros?.kg_nominal_bin ?? null

  async function refrescar() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['ap-lotes'] }),
      qc.invalidateQueries({ queryKey: ['ap-lote'] }),
      qc.invalidateQueries({ queryKey: ['ap-stock'] }),
    ])
  }

  async function abrirLote() {
    setSaving(true)
    setError(null)
    try {
      await abrirLotePasa({ variedad, calidad: Number(calidad) })
      setUltima(null)
      await refrescar()
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      setSaving(false)
    }
  }

  async function levantar() {
    if (!lote) return
    setSaving(true)
    setError(null)
    try {
      const actualizado = await agregarBinPasa(lote.id, {
        pasero_id: paseroId, kg_real: kg.trim().replace(',', '.'), fecha: fecha || null,
      })
      // La tarja la genera el backend: es la del último bin del lote.
      const d = await getLotePasa(lote.id)
      setUltima({
        tarja: d.bines[d.bines.length - 1]?.tarja ?? '–',
        cerrado: actualizado.estado === 'cerrado',
        n: actualizado.cantidad_bines,
        tope: actualizado.tope_bines,
      })
      setKg('')
      await refrescar()
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Levantada de pasa</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          La pasa sale del pasero en bines o bolsones: cada uno se pesa, recibe su tarja y se suma al lote abierto.
          El lote se guarda en el depósito y se cierra solo al completarse.
        </p>
      </div>

      {/* 1. Qué pasa */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700">1 · ¿Qué pasa levantás?</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Variedad</label>
            <select value={variedad} onChange={(e) => { setVariedad(e.target.value as VariedadUva); setUltima(null) }} className={inputCls}>
              {VARIEDAD_VALUES.map((v) => <option key={v} value={v}>{VARIEDAD_LABELS[v]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Calidad</label>
            <select value={calidad} onChange={(e) => { setCalidad(e.target.value); setUltima(null) }} className={inputCls}>
              <option value="1">1 (buena)</option>
              <option value="2">2 (mala)</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="h-12 bg-gray-100 rounded animate-pulse" />
        ) : lote ? (
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm">
            <p className="font-semibold text-amber-900">
              Lote abierto N° {lote.numero} · {VARIEDAD_LABELS[lote.variedad]} C{lote.calidad} ({lote.temporada}/{lote.temporada + 1})
            </p>
            <p className="text-amber-800 mt-0.5">
              {lote.cantidad_bines}{lote.tope_bines != null ? ` de ${lote.tope_bines}` : ''} bines · {fmtKg(lote.kg_total)} kg
            </p>
            {lote.tope_bines != null && (
              <div className="mt-2 h-2 rounded-full bg-amber-100 overflow-hidden">
                <div
                  className="h-full bg-[#7a1f2c]"
                  style={{ width: `${Math.min(100, (lote.cantidad_bines / lote.tope_bines) * 100)}%` }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm flex items-center justify-between gap-3 flex-wrap">
            <p className="text-gray-600">No hay un lote abierto de {VARIEDAD_LABELS[variedad]} calidad {calidad}.</p>
            <button onClick={abrirLote} disabled={saving} className={btnPrimary}>
              {saving ? 'Abriendo...' : 'Abrir lote'}
            </button>
          </div>
        )}
      </div>

      {/* 2. De qué pasero y cuánto pesa */}
      {lote && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">2 · ¿De qué pasero y cuánto pesa el bin?</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Pasero</label>
              <select value={paseroId} onChange={(e) => setPaseroId(e.target.value)} className={inputCls}>
                <option value="">— Seleccionar —</option>
                {paseros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Peso real del bin (kg)</label>
              <input type="text" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Fecha</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
            </div>
          </div>

          {nominal != null && (
            <p className="text-xs text-gray-500">
              Peso teórico por bin: <b>{fmtKg(nominal)} kg</b>
              {kgValido && ` · diferencia: ${kgNum - nominal > 0 ? '+' : ''}${fmtKg(kgNum - nominal)} kg`}
            </p>
          )}
          {disponible != null && maxima != null && parametros && (
            <p className={`text-xs ${excede ? 'text-red-600' : 'text-gray-500'}`}>
              Uva disponible de {VARIEDAD_LABELS[variedad]} en este pasero: <b>{fmtKg(disponible)} kg</b> ·
              Pasa máxima levantable ({fmtKg(parametros.ratio_uva_pasa)}:1): <b>{fmtKg(maxima)} kg</b>
              {kgValido && !excede && ` · Va a descontar ${fmtKg(kgNum * parametros.ratio_uva_pasa)} kg de uva`}
            </p>
          )}

          <div className="flex justify-end">
            <button onClick={levantar} disabled={saving || !paseroId || !kgValido || excede} className={btnPrimary}>
              {saving ? 'Guardando...' : 'Levantar bin'}
            </button>
          </div>
        </div>
      )}

      {ultima && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-4 flex items-start gap-3">
          <CheckCircle2 className="text-green-600 mt-0.5" size={20} />
          <div>
            <p className="text-sm text-green-800">Bin registrado. Tarja:</p>
            <p className="text-xl font-bold font-mono text-green-900">{ultima.tarja}</p>
            <p className="text-xs text-green-700 mt-1">
              Lote: {ultima.n}{ultima.tope != null ? ` de ${ultima.tope}` : ''} bines
              {ultima.cerrado ? ' · el lote se completó y quedó cerrado.' : '.'}
            </p>
          </div>
        </div>
      )}

      {error && <FormError description={error} />}

      {detalle && detalle.bines.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Bines del lote abierto</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls}>Tarja</th>
                  <th className={thCls}>Fecha</th>
                  <th className={thCls}>Pasero</th>
                  <th className={thRCls}>Kg pasa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {detalle.bines.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2 font-mono text-xs text-gray-800">{b.tarja}</td>
                    <td className="px-4 py-2 text-gray-700">{fmtFecha(b.fecha)}</td>
                    <td className="px-4 py-2 text-gray-700">{nombrePasero(b.pasero_id)}</td>
                    <td className="px-4 py-2 text-right font-mono text-gray-900">{fmtKg(b.kg_real)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
