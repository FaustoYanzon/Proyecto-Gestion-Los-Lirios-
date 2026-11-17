'use client'

import { useRef, useState } from 'react'
import axios from 'axios'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import {
  crearDocumentoAlfalfa, PRODUCTO_LABELS, type ProductoAlfalfa, type StockAlfalfa,
} from '@/lib/api/alfalfa'
import { errorDetail } from '@/lib/api/altaProduccion'
import FormError from '@/components/ui/FormError'
import {
  PRODUCTOS, LINEAS_VACIAS, hoyLocal, claveParaPayload, parseCantidad, cantidadInvalida, esErrorDefinitivo,
  fmtNum, fmtFecha, inputCls, labelCls, btnPrimary, btnSecondary, type LineasInput,
} from './shared'

export default function SalidaAlfalfaModal({
  compradores, stock, onClose, onCreated,
}: {
  compradores: { id: string; nombre: string }[]
  stock: StockAlfalfa[]
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const qc = useQueryClient()
  const [compradorId, setCompradorId] = useState('')
  const [fecha, setFecha] = useState(hoyLocal)
  const [patente, setPatente] = useState('')
  const [lineas, setLineas] = useState<LineasInput>(LINEAS_VACIAS)
  const [obs, setObs] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Key + payload signature of the last attempt: reused on retry only if the payload is unchanged.
  const keyRef = useRef<{ key: string; sig: string } | null>(null)

  // Stock is in units for fardo/rollo and in kg for semilla (kg == unidades there is not
  // guaranteed), so the comparable balance depends on the product.
  const saldo = (p: ProductoAlfalfa) => {
    const s = stock.find((x) => x.producto === p)
    if (!s) return 0
    return p === 'semilla' ? s.kg : s.unidades
  }
  const unidad = (p: ProductoAlfalfa) => (p === 'semilla' ? 'kg' : 'un.')

  const items = PRODUCTOS.flatMap((p) => {
    const cantidad = parseCantidad(p, lineas[p])
    return cantidad === null ? [] : [{ producto: p, cantidad }]
  })
  const hayInvalidas = PRODUCTOS.some((p) => cantidadInvalida(p, lineas[p]))
  const excede = (p: ProductoAlfalfa) => {
    const c = parseCantidad(p, lineas[p])
    return c !== null && c > saldo(p)
  }
  const algunExcede = PRODUCTOS.some(excede)
  const puedeContinuar = !!compradorId && !!fecha && items.length > 0 && !hayInvalidas && !algunExcede
  const compradorNombre = compradores.find((c) => c.id === compradorId)?.nombre ?? ''

  async function guardar() {
    setSaving(true)
    setError(null)
    const sig = JSON.stringify([compradorId, fecha, patente.trim(), obs.trim(), items])
    keyRef.current = claveParaPayload(keyRef.current, sig)
    try {
      await crearDocumentoAlfalfa({
        tipo: 'salida',
        fecha,
        comprador_id: compradorId,
        vehiculo_patente: patente.trim() || null,
        observaciones: obs.trim() || null,
        idempotency_key: keyRef.current.key,
        lineas: items.map((i) => ({ producto: i.producto, cantidad: String(i.cantidad) })),
      })
      await onCreated()
    } catch (e) {
      if (esErrorDefinitivo(e)) keyRef.current = null
      // 409 means stock changed under us: refresh so "Disponible" is not stale.
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        void qc.invalidateQueries({ queryKey: ['alfalfa-stock'] })
      }
      setError(errorDetail(e))
      setConfirmando(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">
            {confirmando ? 'Confirmar salida de alfalfa' : 'Salida de alfalfa'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {confirmando ? (
            <div className="space-y-3 text-sm text-gray-700">
              <p>Revisá el documento. Una vez guardado no se puede anular.</p>
              <div className="rounded border border-gray-200 divide-y divide-gray-100">
                <div className="px-3 py-2 flex justify-between"><span>Comprador</span><b>{compradorNombre}</b></div>
                <div className="px-3 py-2 flex justify-between"><span>Fecha</span><b>{fmtFecha(fecha)}</b></div>
                {patente.trim() && (
                  <div className="px-3 py-2 flex justify-between"><span>Patente</span><b>{patente.trim()}</b></div>
                )}
                {items.map((i) => (
                  <div key={i.producto} className="px-3 py-2 flex justify-between">
                    <span>{PRODUCTO_LABELS[i.producto]}</span>
                    <b className="font-mono">{fmtNum(i.cantidad)} {unidad(i.producto)}</b>
                  </div>
                ))}
                {obs.trim() && <div className="px-3 py-2 text-xs text-gray-500">{obs.trim()}</div>}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Comprador <span className="text-red-500">*</span></label>
                  <select value={compradorId} onChange={(e) => setCompradorId(e.target.value)} className={inputCls}>
                    <option value="">— Seleccionar —</option>
                    {compradores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Fecha <span className="text-red-500">*</span></label>
                  <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Patente del vehículo</label>
                  <input type="text" maxLength={20} value={patente} onChange={(e) => setPatente(e.target.value)} className={inputCls} />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-700">Producto a despachar (completá al menos uno)</p>
                {PRODUCTOS.map((p) => (
                  <div key={p}>
                    <div className="flex items-center gap-3">
                      <span className="w-20 text-sm text-gray-700">{PRODUCTO_LABELS[p]}</span>
                      <input
                        type="text"
                        inputMode={p === 'semilla' ? 'decimal' : 'numeric'}
                        value={lineas[p]}
                        onChange={(e) => setLineas((l) => ({ ...l, [p]: e.target.value }))}
                        placeholder="0"
                        className={`${inputCls} ${cantidadInvalida(p, lineas[p]) || excede(p) ? 'border-red-400' : ''}`}
                      />
                      <span className="w-8 text-xs text-gray-500">{unidad(p)}</span>
                    </div>
                    <p className={`text-xs mt-0.5 ml-[92px] ${excede(p) ? 'text-red-600' : 'text-gray-400'}`}>
                      Disponible: {fmtNum(saldo(p))} {unidad(p)}{excede(p) ? ' — supera el saldo' : ''}
                    </p>
                  </div>
                ))}
                {hayInvalidas && (
                  <p className="text-xs text-red-600">Fardos y rollos: números enteros. Semilla: hasta 2 decimales.</p>
                )}
              </div>

              <div>
                <label className={labelCls}>Observaciones</label>
                <textarea rows={2} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} className={inputCls} />
              </div>
            </>
          )}
          {error && <FormError description={error} />}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
          {confirmando ? (
            <>
              <button onClick={() => setConfirmando(false)} disabled={saving} className={btnSecondary}>Volver</button>
              <button onClick={guardar} disabled={saving} className={btnPrimary}>
                {saving ? 'Guardando...' : 'Confirmar y guardar'}
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className={btnSecondary}>Cancelar</button>
              <button onClick={() => { setError(null); setConfirmando(true) }} disabled={!puedeContinuar} className={btnPrimary}>
                Revisar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
