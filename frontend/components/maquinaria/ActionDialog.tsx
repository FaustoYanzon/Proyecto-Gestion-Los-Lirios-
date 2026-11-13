'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { btnDanger, btnPrimary, btnSecondary, errCls, inputCls, labelCls } from './ordenUi'

interface Props {
  title: string
  description?: string
  confirmLabel: string
  danger?: boolean
  // When set, a textarea is shown; `noteRequired` blocks confirming while empty.
  noteLabel?: string
  noteRequired?: boolean
  pending: boolean
  error: string | null
  onConfirm: (note: string) => void
  onClose: () => void
}

// In-app confirmation modal (replaces window.confirm). Mount it only while open
// so the note state resets between uses.
export default function ActionDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  noteLabel,
  noteRequired = false,
  pending,
  error,
  onConfirm,
  onClose,
}: Props) {
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, pending])

  const noteMissing = noteRequired && !note.trim()

  function submit() {
    setTouched(true)
    if (noteMissing) return
    onConfirm(note.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={() => !pending && onClose()} />
      <div className="relative w-full max-w-md bg-white rounded-lg shadow-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {description && <p className="text-sm text-gray-600">{description}</p>}
        {noteLabel && (
          <div>
            <label className={labelCls}>
              {noteLabel}
              {!noteRequired && <span className="text-gray-400 font-normal"> (opcional)</span>}
            </label>
            <textarea
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputCls}
            />
            {touched && noteMissing && <p className={errCls}>Requerido</p>}
          </div>
        )}
        {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} disabled={pending} className={btnSecondary}>
            Volver
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className={danger ? btnDanger : btnPrimary}
          >
            {pending && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
