'use client'

import { useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { getMaquinariaErrorMessage, registrarPago } from '@/lib/api/maquinaria'
import { btnPrimary, btnSecondary, errCls, inputCls, labelCls } from './ordenUi'
import { montoRefine, parseMonto } from './PresupuestoForm'

// Values mirror OrigenPago / FormaPago in backend/app/models/finanzas.py.
const ORIGEN_OPTIONS = [
  { value: 'no_oficial', label: 'No oficial' },
  { value: 'oficial', label: 'Oficial' },
] as const
const FORMA_PAGO_OPTIONS = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'echeque', label: 'E-cheque' },
  { value: 'credito', label: 'Crédito' },
] as const

const schema = z.object({
  monto_real: z.string().refine(montoRefine, { message: 'Monto mayor a 0, hasta 2 decimales' }),
  fecha: z.string().min(1, 'Requerido'),
  factura_url: z
    .string()
    .trim()
    .max(500)
    .optional()
    .refine((v) => !v || v.startsWith('https://'), { message: 'La URL debe empezar con https://' }),
  origen: z.enum(['oficial', 'no_oficial']),
  forma_pago: z.enum(['efectivo', 'transferencia', 'cheque', 'echeque', 'credito']),
})

type FormData = z.infer<typeof schema>

function todayLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface Props {
  ordenId: string
  onSuccess: () => void
  onCancel: () => void
}

export default function PagoForm({ ordenId, onSuccess, onCancel }: Props) {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: {
      monto_real: '',
      fecha: todayLocal(),
      factura_url: '',
      origen: 'no_oficial',
      forma_pago: 'transferencia',
    },
  })

  async function onSubmit(data: FormData) {
    try {
      setSubmitError(null)
      await registrarPago(ordenId, {
        monto_real: parseMonto(data.monto_real),
        fecha: data.fecha,
        factura_url: data.factura_url || undefined,
        origen: data.origen,
        forma_pago: data.forma_pago,
      })
      queryClient.invalidateQueries({ queryKey: ['maquinaria'] })
      onSuccess()
    } catch (e) {
      setSubmitError(getMaquinariaErrorMessage(e, 'No se pudo registrar el pago.'))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <p className="text-xs text-gray-500">
        El pago genera un egreso en ARS en la finca de la orden.
      </p>
      <div>
        <label className={labelCls}>Monto real (ARS)</label>
        <input type="text" inputMode="decimal" {...register('monto_real')} className={inputCls} />
        {errors.monto_real && <p className={errCls}>{errors.monto_real.message}</p>}
      </div>
      <div>
        <label className={labelCls}>Fecha</label>
        <input type="date" {...register('fecha')} className={inputCls} />
        {errors.fecha && <p className={errCls}>{errors.fecha.message}</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Origen</label>
          <select {...register('origen')} className={inputCls}>
            {ORIGEN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Forma de pago</label>
          <select {...register('forma_pago')} className={inputCls}>
            {FORMA_PAGO_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls}>Factura (URL https) <span className="text-gray-400 font-normal">(opcional)</span></label>
        <input type="url" placeholder="https://..." {...register('factura_url')} className={inputCls} />
        {errors.factura_url && <p className={errCls}>{errors.factura_url.message}</p>}
      </div>
      {submitError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{submitError}</p>}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancelar</button>
        <button type="submit" disabled={isSubmitting} className={btnPrimary}>
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Registrar pago
        </button>
      </div>
    </form>
  )
}
