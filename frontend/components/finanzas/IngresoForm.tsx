'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  createIngreso,
  updateIngreso,
  PRODUCTO_INGRESO_VALUES,
  PRODUCTO_INGRESO_LABELS,
  VARIEDAD_VALUES,
  VARIEDAD_LABELS,
  type IngresoResponse,
  type ProductoIngreso,
  type VariedadUva,
} from '@/lib/api/ingresos'

const schema = z
  .object({
    fecha: z.string().min(1, 'Requerido'),
    cliente: z.string().min(1, 'Requerido'),
    producto: z.enum(PRODUCTO_INGRESO_VALUES, { error: 'Requerido' }),
    variedad: z.preprocess(
      (v) => (!v || v === '' ? undefined : v),
      z.enum(VARIEDAD_VALUES).optional()
    ),
    kg_totales: z.preprocess(
      (v) => (!v || v === '' ? undefined : Number(v)),
      z.number().positive().optional()
    ),
    precio_por_kg: z.preprocess(
      (v) => (!v || v === '' ? undefined : Number(v)),
      z.number().positive().optional()
    ),
    monto: z.coerce.number({ error: 'Requerido' }).positive('Debe ser mayor a 0'),
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
  ingreso?: IngresoResponse
  onSuccess: () => void
  onCancel: () => void
}

const today = new Date().toISOString().split('T')[0]

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'
const err = 'mt-1 text-xs text-red-600'

export default function IngresoForm({ ingreso, onSuccess, onCancel }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!ingreso
  const [submitError, setSubmitError] = useState<string | null>(null)
  const skipAutoCalc = useRef(isEdit)

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
          fecha: ingreso.fecha,
          cliente: ingreso.cliente,
          producto: ingreso.producto,
          variedad: ingreso.variedad,
          kg_totales: ingreso.kg_totales,
          precio_por_kg: ingreso.precio_por_kg,
          monto: ingreso.monto,
          moneda: ingreso.moneda,
          tipo_cambio: ingreso.tipo_cambio,
          origen: ingreso.origen,
          finca: ingreso.finca,
          forma_pago: ingreso.forma_pago,
          descripcion: ingreso.descripcion ?? '',
        }
      : {
          fecha: today,
          moneda: 'ars',
          origen: 'oficial',
          descripcion: '',
        },
  })

  const moneda = watch('moneda')
  const kgTotales = watch('kg_totales')
  const precioPorKg = watch('precio_por_kg')

  // Auto-calculate monto from kg × price (skip on first render in edit mode)
  useEffect(() => {
    if (skipAutoCalc.current) {
      skipAutoCalc.current = false
      return
    }
    if (kgTotales && precioPorKg && kgTotales > 0 && precioPorKg > 0) {
      setValue('monto', parseFloat((kgTotales * precioPorKg).toFixed(2)))
    }
  }, [kgTotales, precioPorKg, setValue])

  async function onSubmit(data: FormData) {
    try {
      setSubmitError(null)
      const payload = {
        ...data,
        tipo_cambio: data.moneda === 'usd' ? data.tipo_cambio : undefined,
      }
      if (isEdit) {
        await updateIngreso(ingreso.id, payload)
      } else {
        await createIngreso(payload)
      }
      queryClient.invalidateQueries({ queryKey: ['ingresos'] })
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
          <label className={lbl}>Fecha</label>
          <input type="date" {...register('fecha')} className={field} />
          {errors.fecha && <p className={err}>{errors.fecha.message}</p>}
        </div>

        {/* Cliente */}
        <div>
          <label className={lbl}>Cliente / Comprador</label>
          <input
            type="text"
            placeholder="Ej: Campero, Cegupa..."
            {...register('cliente')}
            className={field}
          />
          {errors.cliente && <p className={err}>{errors.cliente.message}</p>}
        </div>

        {/* Producto */}
        <div>
          <label className={lbl}>Producto</label>
          <select {...register('producto')} className={field}>
            <option value="">Seleccionar...</option>
            {PRODUCTO_INGRESO_VALUES.map((p) => (
              <option key={p} value={p}>{PRODUCTO_INGRESO_LABELS[p]}</option>
            ))}
          </select>
          {errors.producto && <p className={err}>{errors.producto.message}</p>}
        </div>

        {/* Variedad */}
        <div>
          <label className={lbl}>Variedad <span className="text-gray-400 font-normal">(opcional)</span></label>
          <select {...register('variedad')} className={field}>
            <option value="">Sin especificar</option>
            {VARIEDAD_VALUES.filter(v => v !== 'alfalfa').map((v) => (
              <option key={v} value={v}>{VARIEDAD_LABELS[v]}</option>
            ))}
          </select>
        </div>

        {/* Kg totales */}
        <div>
          <label className={lbl}>Kg Totales <span className="text-gray-400 font-normal">(opcional)</span></label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            {...register('kg_totales')}
            className={field}
          />
          {errors.kg_totales && <p className={err}>{errors.kg_totales.message}</p>}
        </div>

        {/* Precio por kg */}
        <div>
          <label className={lbl}>Precio por Kg <span className="text-gray-400 font-normal">(opcional)</span></label>
          <input
            type="number"
            step="0.0001"
            min="0"
            placeholder="0.0000"
            {...register('precio_por_kg')}
            className={field}
          />
          {errors.precio_por_kg && <p className={err}>{errors.precio_por_kg.message}</p>}
        </div>

        {/* Monto (auto-filled if kg × precio) */}
        <div>
          <label className={lbl}>
            Monto Total
            {kgTotales && precioPorKg ? (
              <span className="ml-2 text-xs text-green-600 font-normal">auto-calculado</span>
            ) : null}
          </label>
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
          <label className={lbl}>Moneda</label>
          <select {...register('moneda')} className={field}>
            <option value="ars">ARS — Peso Argentino</option>
            <option value="usd">USD — Dólar</option>
          </select>
        </div>

        {/* Tipo de cambio — only if USD */}
        {moneda === 'usd' && (
          <div>
            <label className={lbl}>Tipo de Cambio</label>
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
          <label className={lbl}>Origen</label>
          <select {...register('origen')} className={field}>
            <option value="oficial">Oficial</option>
            <option value="no_oficial">No oficial</option>
          </select>
        </div>

        {/* Finca */}
        <div>
          <label className={lbl}>Finca</label>
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
          <label className={lbl}>Forma de Pago</label>
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
        <label className={lbl}>
          Descripción <span className="text-gray-400 font-normal">(opcional)</span>
        </label>
        <textarea
          {...register('descripcion')}
          rows={3}
          placeholder="Descripción del ingreso..."
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
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 transition-colors"
        >
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Guardar
        </button>
      </div>
    </form>
  )
}
