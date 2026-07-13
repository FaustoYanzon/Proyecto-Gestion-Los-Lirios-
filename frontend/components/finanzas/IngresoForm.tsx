'use client'

import { useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  createIngreso,
  updateIngreso,
  DESTINO_INGRESO_VALUES,
  DESTINO_INGRESO_LABELS,
  FORMA_PAGO_INGRESO_VALUES,
  FORMA_PAGO_INGRESO_LABELS,
  FORMAS_PAGO_CHEQUE,
  type IngresoResponse,
  type FormaPagoIngreso,
} from '@/lib/api/ingresos'

const schema = z
  .object({
    fecha: z.string().min(1, 'Requerido'),
    destino: z.enum(DESTINO_INGRESO_VALUES, { error: 'Requerido' }),
    comprador: z.string().min(1, 'Requerido'),
    forma_pago: z.enum(FORMA_PAGO_INGRESO_VALUES, { error: 'Requerido' }),
    estado: z.string().optional(),
    cuenta_destino: z.string().optional(),
    banco: z.string().optional(),
    n_cheque: z.string().optional(),
    f_pago: z.string().optional(),
    uso_cheque: z.string().optional(),
    monto: z.coerce.number({ error: 'Requerido' }).positive('Debe ser mayor a 0'),
    moneda: z.enum(['ars', 'usd'] as const),
    tipo_cambio: z.preprocess(
      (v) => (!v || v === '' ? undefined : Number(v)),
      z.number().positive().optional()
    ),
    origen: z.enum(['oficial', 'no_oficial'] as const),
    finca: z.enum(['los_mimbres', 'media_agua', 'caucete'] as const, { error: 'Requerido' }),
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

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: isEdit
      ? {
          fecha: ingreso.fecha,
          destino: ingreso.destino,
          comprador: ingreso.comprador,
          forma_pago: ingreso.forma_pago,
          estado: ingreso.estado ?? '',
          cuenta_destino: ingreso.cuenta_destino ?? '',
          banco: ingreso.banco ?? '',
          n_cheque: ingreso.n_cheque ?? '',
          f_pago: ingreso.f_pago ?? '',
          uso_cheque: ingreso.uso_cheque ?? '',
          monto: ingreso.monto,
          moneda: ingreso.moneda,
          tipo_cambio: ingreso.tipo_cambio,
          origen: ingreso.origen,
          finca: ingreso.finca,
          descripcion: ingreso.descripcion ?? '',
        }
      : {
          fecha: today,
          moneda: 'ars',
          origen: 'oficial',
          estado: '',
          cuenta_destino: '',
          banco: '',
          n_cheque: '',
          f_pago: '',
          uso_cheque: '',
          descripcion: '',
        },
  })

  const moneda = watch('moneda')
  const formaPago = watch('forma_pago') as FormaPagoIngreso | undefined
  const esCheque = formaPago ? FORMAS_PAGO_CHEQUE.includes(formaPago) : false

  async function onSubmit(data: FormData) {
    try {
      setSubmitError(null)
      const payload = {
        ...data,
        tipo_cambio: data.moneda === 'usd' ? data.tipo_cambio : undefined,
        // Cheque-only fields: clear them if the payment method changed away from cheque,
        // so a stale n_cheque/banco doesn't linger on an efectivo/transferencia record.
        banco: esCheque ? data.banco : undefined,
        n_cheque: esCheque ? data.n_cheque : undefined,
        f_pago: esCheque ? data.f_pago : undefined,
        uso_cheque: esCheque ? data.uso_cheque : undefined,
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

        {/* Comprador */}
        <div>
          <label className={lbl}>Comprador</label>
          <input
            type="text"
            placeholder="Ej: Carrascosa, Casares..."
            {...register('comprador')}
            className={field}
          />
          {errors.comprador && <p className={err}>{errors.comprador.message}</p>}
        </div>

        {/* Destino */}
        <div>
          <label className={lbl}>Destino</label>
          <select {...register('destino')} className={field}>
            <option value="">Seleccionar...</option>
            {DESTINO_INGRESO_VALUES.map((d) => (
              <option key={d} value={d}>{DESTINO_INGRESO_LABELS[d]}</option>
            ))}
          </select>
          {errors.destino && <p className={err}>{errors.destino.message}</p>}
        </div>

        {/* Estado */}
        <div>
          <label className={lbl}>Estado <span className="text-gray-400 font-normal">(opcional)</span></label>
          <input
            type="text"
            placeholder="Ej: NR, FACT..."
            {...register('estado')}
            className={field}
          />
        </div>

        {/* Forma de pago */}
        <div>
          <label className={lbl}>Forma de Pago</label>
          <select {...register('forma_pago')} className={field}>
            <option value="">Seleccionar...</option>
            {FORMA_PAGO_INGRESO_VALUES.map((f) => (
              <option key={f} value={f}>{FORMA_PAGO_INGRESO_LABELS[f]}</option>
            ))}
          </select>
          {errors.forma_pago && <p className={err}>{errors.forma_pago.message}</p>}
        </div>

        {/* Cuenta destino */}
        <div>
          <label className={lbl}>Cuenta Destino <span className="text-gray-400 font-normal">(opcional)</span></label>
          <input
            type="text"
            placeholder="Ej: Caja, BSJ..."
            {...register('cuenta_destino')}
            className={field}
          />
        </div>

        {/* Campos de cheque — solo si forma_pago es cheque/echeque */}
        {esCheque && (
          <>
            <div>
              <label className={lbl}>Banco</label>
              <input type="text" {...register('banco')} className={field} />
            </div>
            <div>
              <label className={lbl}>N° Cheque</label>
              <input type="text" {...register('n_cheque')} className={field} />
            </div>
            <div>
              <label className={lbl}>Fecha de Pago del Cheque</label>
              <input type="date" {...register('f_pago')} className={field} />
            </div>
            <div>
              <label className={lbl}>
                Uso del Cheque <span className="text-gray-400 font-normal">(vacío = disponible)</span>
              </label>
              <input
                type="text"
                placeholder="Ej: en qué se usó..."
                {...register('uso_cheque')}
                className={field}
              />
            </div>
          </>
        )}

        {/* Monto */}
        <div>
          <label className={lbl}>Monto Total</label>
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

      </div>

      {/* Descripción */}
      <div>
        <label className={lbl}>
          Descripción <span className="text-gray-400 font-normal">(opcional)</span>
        </label>
        <textarea
          {...register('descripcion')}
          rows={3}
          placeholder="Detalle del ingreso..."
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
