'use client'

import { useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, CalendarCheck } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { createFitosanitario, updateFitosanitario, type FitosanitarioResponse } from '@/lib/api/fitosanitarios'
import { formatParcelaLabel } from '@/lib/api/produccion'
import type { ParcelaItem } from '@/lib/api/produccion'

const schema = z.object({
  fecha: z.string().min(1, 'Requerido'),
  parcela_id: z.string().min(1, 'Requerido'),
  producto_nombre: z.string().min(1, 'Requerido'),
  dosis_lt_ha: z.coerce.number().positive('Debe ser mayor a 0'),
  motivo: z.string().min(1, 'Requerido'),
  dias_carencia: z.coerce.number().int().min(0, 'Mínimo 0'),
  dias_reingreso: z.coerce.number().int().min(0, 'Mínimo 0'),
  responsable: z.string().min(1, 'Requerido'),
})

type FormData = z.infer<typeof schema>

interface Props {
  registro?: FitosanitarioResponse
  parcelas: ParcelaItem[]
  onSuccess: () => void
  onCancel: () => void
}

const today = new Date().toISOString().split('T')[0]

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err = 'mt-1 text-xs text-red-600'

function addDays(dateStr: string, days: number): string {
  if (!dateStr || isNaN(days)) return ''
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function FitosanitarioForm({ registro, parcelas, onSuccess, onCancel }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!registro
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
          fecha: registro.fecha,
          parcela_id: registro.parcela_id,
          producto_nombre: registro.producto_nombre,
          dosis_lt_ha: registro.dosis_lt_ha,
          motivo: registro.motivo,
          dias_carencia: registro.dias_carencia,
          dias_reingreso: registro.dias_reingreso,
          responsable: registro.responsable,
        }
      : { fecha: today, parcela_id: '', producto_nombre: '', motivo: '', responsable: '', dias_carencia: 0, dias_reingreso: 0 },
  })

  const fechaW = watch('fecha')
  const diasCarenciaW = watch('dias_carencia')
  const diasReingresoW = watch('dias_reingreso')

  const habCosecha = addDays(fechaW, Number(diasCarenciaW))
  const habReingreso = addDays(fechaW, Number(diasReingresoW))

  const parcelasActivas = parcelas.filter((p) => p.is_active && p.tipo === 'parral')

  async function onSubmit(data: FormData) {
    try {
      setSubmitError(null)
      if (isEdit) {
        await updateFitosanitario(registro.id, data)
      } else {
        await createFitosanitario(data)
      }
      queryClient.invalidateQueries({ queryKey: ['fitosanitarios'] })
      onSuccess()
    } catch {
      setSubmitError('Error al guardar. Intente nuevamente.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Fecha</label>
          <input type="date" {...register('fecha')} className={field} />
          {errors.fecha && <p className={err}>{errors.fecha.message}</p>}
        </div>
        <div>
          <label className={label}>Responsable</label>
          <input type="text" placeholder="Nombre..." {...register('responsable')} className={field} />
          {errors.responsable && <p className={err}>{errors.responsable.message}</p>}
        </div>
      </div>

      <div>
        <label className={label}>Parcela</label>
        <select {...register('parcela_id')} className={field}>
          <option value="">Seleccionar...</option>
          {parcelasActivas.map((p) => (
            <option key={p.id} value={p.id}>{formatParcelaLabel(p.nombre)}</option>
          ))}
        </select>
        {errors.parcela_id && <p className={err}>{errors.parcela_id.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Producto</label>
          <input type="text" placeholder="Nombre comercial" {...register('producto_nombre')} className={field} />
          {errors.producto_nombre && <p className={err}>{errors.producto_nombre.message}</p>}
        </div>
        <div>
          <label className={label}>Dosis (L/ha)</label>
          <input type="number" step="0.01" min="0" placeholder="0.00" {...register('dosis_lt_ha')} className={field} />
          {errors.dosis_lt_ha && <p className={err}>{errors.dosis_lt_ha.message}</p>}
        </div>
      </div>

      <div>
        <label className={label}>Motivo / Plaga o enfermedad</label>
        <textarea rows={2} placeholder="Descripción del motivo de aplicación..." {...register('motivo')} className={field} />
        {errors.motivo && <p className={err}>{errors.motivo.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Días de carencia</label>
          <input type="number" min="0" placeholder="0" {...register('dias_carencia')} className={field} />
          {errors.dias_carencia && <p className={err}>{errors.dias_carencia.message}</p>}
        </div>
        <div>
          <label className={label}>Días de reingreso</label>
          <input type="number" min="0" placeholder="0" {...register('dias_reingreso')} className={field} />
          {errors.dias_reingreso && <p className={err}>{errors.dias_reingreso.message}</p>}
        </div>
      </div>

      {/* Preview habilitaciones */}
      {fechaW && (habCosecha || habReingreso) && (
        <div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-3 space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium text-amber-700 mb-1">
            <CalendarCheck size={14} />
            Fechas de habilitación calculadas
          </div>
          {habCosecha && (
            <p className="text-sm text-amber-800">
              Cosecha habilitada: <span className="font-semibold">{habCosecha}</span>
            </p>
          )}
          {habReingreso && (
            <p className="text-sm text-amber-800">
              Reingreso habilitado: <span className="font-semibold">{habReingreso}</span>
            </p>
          )}
        </div>
      )}

      {submitError && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{submitError}</p>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-60 transition-colors">
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? 'Guardar cambios' : 'Registrar'}
        </button>
      </div>
    </form>
  )
}
