'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { errorDetail } from '@/lib/api/altaProduccion'
import FormError from '@/components/ui/FormError'

const MIN_MOTIVO = 5
const MAX_MOTIVO = 500

interface Props {
  titulo: string
  numero: string
  onConfirm: (motivo: string) => Promise<void>
  onClose: () => void
}

// Shared by remitos de pasa and alfalfa documents. Backend 409/422 `detail` is shown
// inline and the modal stays open so the user can read it or fix the motivo.
export default function AnularDocumentoModal({ titulo, numero, onConfirm, onClose }: Props) {
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const largo = motivo.trim().length
  const valido = largo >= MIN_MOTIVO && motivo.length <= MAX_MOTIVO

  async function confirmar() {
    if (!valido || saving) return
    setSaving(true)
    setError(null)
    try {
      await onConfirm(motivo.trim())
    } catch (e) {
      setError(errorDetail(e, 'No se pudo anular el documento'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{titulo} · N° {numero}</h2>
          <button onClick={onClose} disabled={saving} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-50">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-sm text-gray-600">
            Se revertirán sus saldos y el documento seguirá visible como Anulado, con el motivo. No se puede deshacer.
          </p>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Motivo de la anulación <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              value={motivo}
              maxLength={MAX_MOTIVO}
              onChange={(e) => setMotivo(e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]"
            />
            <p className={`text-xs mt-1 text-right ${largo < MIN_MOTIVO ? 'text-gray-500' : 'text-gray-400'}`}>
              {largo}/{MAX_MOTIVO} · mínimo {MIN_MOTIVO} caracteres
            </p>
          </div>
          {error && <FormError description={error} />}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={!valido || saving}
            className="px-4 py-2 bg-[#7a1f2c] text-white rounded-lg text-sm font-semibold hover:bg-[#5a1320] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Anulando...' : 'Anular documento'}
          </button>
        </div>
      </div>
    </div>
  )
}
