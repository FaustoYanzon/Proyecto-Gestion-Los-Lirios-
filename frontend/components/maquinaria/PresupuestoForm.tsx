'use client'

import { useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { createPresupuesto, getMaquinariaErrorMessage } from '@/lib/api/maquinaria'
import { btnPrimary, btnSecondary, errCls, inputCls, labelCls } from './ordenUi'

// Amount is typed as text. With a comma ("1.500,50") dots are thousand separators;
// without one ("1500.50") the dot is the decimal point, so nothing is silently x10.
export function parseMonto(raw: string): number {
  const s = raw.trim()
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
}

export const montoRefine = (v: string) => {
  const n = parseMonto(v)
  return Number.isFinite(n) && n > 0 && Math.round(n * 100) / 100 === n
}

const schema = z.object({
  taller: z.string().trim().min(1, 'Requerido').max(200),
  monto: z.string().refine(montoRefine, { message: 'Monto mayor a 0, hasta 2 decimales' }),
  detalle: z.string().trim().max(2000).optional(),
  adjunto_url: z
    .string()
    .trim()
    .max(500)
    .optional()
    .refine((v) => !v || v.startsWith('https://'), { message: 'La URL debe empezar con https://' }),
})

type FormData = z.infer<typeof schema>

interface Props {
  ordenId: string
  tallerInicial: string | null
  onSuccess: () => void
  onCancel: () => void
}

export default function PresupuestoForm({ ordenId, tallerInicial, onSuccess, onCancel }: Props) {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: { taller: tallerInicial ?? '', monto: '', detalle: '', adjunto_url: '' },
  })

  async function onSubmit(data: FormData) {
    try {
      setSubmitError(null)
      await createPresupuesto(ordenId, {
        taller: data.taller,
        monto: parseMonto(data.monto),
        detalle: data.detalle || undefined,
        adjunto_url: data.adjunto_url || undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['maquinaria'] })
      onSuccess()
    } catch (e) {
      setSubmitError(getMaquinariaErrorMessage(e, 'No se pudo cargar el presupuesto.'))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className={labelCls}>Taller</label>
        <input type="text" {...register('taller')} className={inputCls} />
        {errors.taller && <p className={errCls}>{errors.taller.message}</p>}
      </div>
      <div>
        <label className={labelCls}>Monto (ARS)</label>
        <input type="text" inputMode="decimal" placeholder="Ej: 150000" {...register('monto')} className={inputCls} />
        {errors.monto && <p className={errCls}>{errors.monto.message}</p>}
      </div>
      <div>
        <label className={labelCls}>Detalle <span className="text-gray-400 font-normal">(opcional)</span></label>
        <textarea rows={3} {...register('detalle')} className={inputCls} />
        {errors.detalle && <p className={errCls}>{errors.detalle.message}</p>}
      </div>
      <div>
        <label className={labelCls}>Adjunto (URL https) <span className="text-gray-400 font-normal">(opcional)</span></label>
        <input type="url" placeholder="https://..." {...register('adjunto_url')} className={inputCls} />
        {errors.adjunto_url && <p className={errCls}>{errors.adjunto_url.message}</p>}
      </div>
      {submitError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{submitError}</p>}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancelar</button>
        <button type="submit" disabled={isSubmitting} className={btnPrimary}>
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Cargar presupuesto
        </button>
      </div>
    </form>
  )
}
