'use client'

// Carga del comprobante de bodega (SUV + kg recibidos) de un remito BOD. Es el
// pesaje en destino: se carga cuando llega el camión y una sola vez por remito.
import { useState } from 'react'
import { X } from 'lucide-react'
import { cargarComprobanteBodega, errorDetail } from '@/lib/api/altaProduccion'
import FormError from '@/components/ui/FormError'

const KG_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fmtKg = (n: number) => KG_FMT.format(n)
const TODAY = new Date().toISOString().split('T')[0]
const decimalOk = (v: string) => /^\d+([.,]\d{1,2})?$/.test(v.trim()) && Number(v.replace(',', '.')) > 0

const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'
const btnPrimary = 'px-4 py-2 bg-[#7a1f2c] text-white rounded-lg text-sm font-semibold hover:bg-[#5a1320] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
const btnSecondary = 'px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors'

export default function ComprobanteBodegaModal({
  remitoId, numero, kgDespachados, onClose, onSaved,
}: {
  remitoId: string
  numero: string
  kgDespachados: number
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [suv, setSuv] = useState('')
  const [kg, setKg] = useState('')
  const [fecha, setFecha] = useState(TODAY)
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dif = decimalOk(kg) ? Number(kg.replace(',', '.')) - kgDespachados : null

  async function guardar() {
    setSaving(true)
    setError(null)
    try {
      await cargarComprobanteBodega(remitoId, {
        numero_suv: suv.trim(), kg_recibidos: kg.trim().replace(',', '.'),
        fecha: fecha || null, observaciones: obs.trim() || null,
      })
      await onSaved()
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
          <h2 className="text-base font-semibold text-gray-900">Comprobante de bodega · remito {numero}</h2>
          <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-500">Kg despachados en el remito: <b className="font-mono">{fmtKg(kgDespachados)}</b>. Se carga una sola vez.</p>
          <div>
            <label className={labelCls}>N° SUV <span className="text-red-500">*</span></label>
            <input type="text" value={suv} onChange={(e) => setSuv(e.target.value)} maxLength={50} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Kg recibidos por la bodega <span className="text-red-500">*</span></label>
            <input type="text" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} className={inputCls} />
            {dif != null && (
              <p className={`text-xs mt-1 ${dif < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                Diferencia: {fmtKg(dif)} kg {dif < 0 ? '(la bodega recibió menos)' : ''}
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Fecha</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Observaciones</label>
            <textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} className={inputCls} />
          </div>
          {error && <FormError description={error} />}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={saving || !suv.trim() || !decimalOk(kg)} className={btnPrimary}>
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
