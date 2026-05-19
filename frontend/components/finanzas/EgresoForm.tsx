'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  createEgreso,
  updateEgreso,
  TIPO_EGRESO_VALUES,
  TIPO_EGRESO_LABELS,
  CLASIFICACIONES_POR_TIPO,
  type EgresoResponse,
  type TipoEgreso,
  type ClasificacionEgreso,
} from '@/lib/api/egresos'

const schema = z
  .object({
    fecha: z.string().min(1, 'Requerido'),
    tipo: z.enum(TIPO_EGRESO_VALUES, { error: 'Requerido' }),
    clasificacion: z.string().min(1, 'Requerido'),
    monto: z.coerce.number().positive('Debe ser mayor a 0'),
    moneda: z.enum(['ars', 'usd'] as const),
    tipo_cambio: z.preprocess(
      (v) => (!v || v === '' ? undefined : Number(v)),
      z.number().positive().optional()
    ),
    origen: z.enum(['oficial', 'no_oficial'] as const),
    finca: z.enum(['los_mimbres', 'media_agua', 'caucete'] as const, { error: 'Requerido' }),
    forma_pago: z.enum(['efectivo', 'transferencia', 'cheque', 'credito'] as const, { error: 'Requerido' }),
    descripcion: z.string().optional(),
  })
  .refine((d) => d.moneda !== 'usd' || (d.tipo_cambio != null && d.tipo_cambio > 0), {
    message: 'Requerido para USD',
    path: ['tipo_cambio'],
  })

type FormData = z.infer<typeof schema>

interface Props {
  egreso?: EgresoResponse
  onSuccess: () => void
  onCancel: () => void
}

const today = new Date().toISOString().split('T')[0]

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err = 'mt-1 text-xs text-red-600'

export default function EgresoForm({ egreso, onSuccess, onCancel }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!egreso
  const firstRender = useRef(true)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: isEdit
      ? {
          fecha: egreso.fecha,
          tipo: egreso.tipo,
          clasificacion: egreso.clasificacion,
          monto: egreso.monto,
          moneda: egreso.moneda,
          tipo_cambio: egreso.tipo_cambio,
          origen: egreso.origen,
          finca: egreso.finca,
          forma_pago: egreso.forma_pago,
          descripcion: egreso.descripcion ?? '',
        }
      : {
          fecha: today,
          moneda: 'ars',
          origen: 'oficial',
          descripcion: '',
        },
  })

  const moneda = watch('moneda')
  const tipo = watch('tipo')

  // Reset clasificacion on tipo change, but skip initial render to preserve edit defaults
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setValue('clasificacion', '')
  }, [tipo, setValue])

  const clasificaciones = tipo ? (CLASIFICACIONES_POR_TIPO[tipo as TipoEgreso] ?? []) : []

  async function onSubmit(data: FormData) {
    try {
      setSubmitError(null)
      const payload = {
        ...data,
        clasificacion: data.clasificacion as ClasificacionEgreso,
        tipo_cambio: data.moneda === 'usd' ? data.tipo_cambio : undefined,
        fuente: 'manual' as const,
      }

      if (isEdit) {
        await updateEgreso(egreso.id, payload)
      } else {
        await createEgreso(payload)
      }

      queryClient.invalidateQueries({ queryKey: ['egresos'] })
      onSuccess()
    } catch {
      setSubmitError('Error al guardar. Intente nuevamente.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Fecha */}
        <div>
          <label className={label}>Fecha</label>
          <input type="date" {...register('fecha')} className={field} />
          {errors.fecha && <p className={err}>{errors.fecha.message}</p>}
        </div>

        {/* Tipo */}
        <div>
          <label className={label}>Tipo</label>
          <select {...register('tipo')} className={field}>
            <option value="">Seleccionar...</option>
            {TIPO_EGRESO_VALUES.map((t) => (
              <option key={t} value={t}>{TIPO_EGRESO_LABELS[t]}</option>
            ))}
          </select>
          {errors.tipo && <p className={err}>{errors.tipo.message}</p>}
        </div>

        {/* Clasificación (dependent on tipo) */}
        <div>
          <label className={label}>Clasificación</label>
          <select {...register('clasificacion')} className={field} disabled={!tipo}>
            <option value="">Seleccionar...</option>
            {clasificaciones.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          {errors.clasificacion && <p className={err}>{errors.clasificacion.message}</p>}
        </div>

        {/* Monto */}
        <div>
          <label className={label}>Monto</label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            {...register('monto')}
            className={field}
          />
          {errors.monto && <p className={err}>{errors.monto.message}</p>}
        </div>

        {/* Moneda */}
        <div>
          <label className={label}>Moneda</label>
          <select {...register('moneda')} className={field}>
            <option value="ars">ARS — Peso Argentino</option>
            <option value="usd">USD — Dólar</option>
          </select>
        </div>

        {/* Tipo de cambio — only visible when moneda = usd */}
        {moneda === 'usd' && (
          <div>
            <label className={label}>Tipo de Cambio</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="Ej: 1000"
              {...register('tipo_cambio')}
              className={field}
            />
            {errors.tipo_cambio && <p className={err}>{errors.tipo_cambio.message}</p>}
          </div>
        )}

        {/* Origen */}
        <div>
          <label className={label}>Origen</label>
          <select {...register('origen')} className={field}>
            <option value="oficial">Oficial</option>
            <option value="no_oficial">No oficial</option>
          </select>
        </div>

        {/* Finca */}
        <div>
          <label className={label}>Finca</label>
          <select {...register('finca')} className={field}>
            <option value="">Seleccionar...</option>
            <option value="los_mimbres">Los Mimbres</option>
            <option value="media_agua">Media Agua</option>
            <option value="caucete">Caucete</option>
          </select>
          {errors.finca && <p className={err}>{errors.finca.message}</p>}
        </div>

        {/* Forma de pago */}
        <div>
          <label className={label}>Forma de Pago</label>
          <select {...register('forma_pago')} className={field}>
            <option value="">Seleccionar...</option>
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="cheque">Cheque</option>
            <option value="credito">Crédito</option>
          </select>
          {errors.forma_pago && <p className={err}>{errors.forma_pago.message}</p>}
        </div>

      </div>

      {/* Descripción */}
      <div>
        <label className={label}>
          Descripción <span className="text-gray-400 font-normal">(opcional)</span>
        </label>
        <textarea
          {...register('descripcion')}
          rows={3}
          placeholder="Descripción del egreso..."
          className={field}
        />
      </div>

      {submitError && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{submitError}</p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-60 transition-colors"
        >
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Guardar
        </button>
      </div>
    </form>
  )
}
