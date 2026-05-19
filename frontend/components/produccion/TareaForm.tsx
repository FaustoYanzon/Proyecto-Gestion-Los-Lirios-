'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm, useFieldArray, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  TAREAS_POR_TEMPORADA,
  CLASIFICACION_POR_TAREA,
  TEMPORADA_LABELS,
  UNIDAD_VALUES,
  UNIDAD_LABELS,
  formatParcelaLabel,
  createTrabajoMasivo,
  updateTrabajo,
  type RegistroTrabajoResponse,
  type UnidadMedida,
  type ParcelaItem,
} from '@/lib/api/produccion'

const CLASIFICACION_BADGE: Record<string, string> = {
  verano:    'bg-orange-50 text-orange-700 border border-orange-200',
  invierno:  'bg-blue-50 text-blue-700 border border-blue-200',
  primavera: 'bg-green-50 text-green-700 border border-green-200',
  otono:     'bg-amber-50 text-amber-700 border border-amber-200',
  general:   'bg-gray-100 text-gray-600 border border-gray-200',
}

const CUSTOM_TASK_VALUE = '__nueva__'

const schema = z.object({
  fecha: z.string().min(1, 'Requerido'),
  tarea: z.string().min(1, 'Requerido'),
  parcela_id: z.string().optional(),
  unidad_medida: z.enum(UNIDAD_VALUES, { error: 'Requerido' }),
  precio_unitario: z.coerce.number().positive('Debe ser mayor a 0'),
  detalle: z.string().optional(),
  trabajadores: z
    .array(
      z.object({
        trabajador_nombre: z.string().min(1, 'Requerido'),
        cantidad: z.coerce.number().positive('Debe ser > 0'),
      })
    )
    .min(1, 'Agregar al menos un trabajador'),
})

type FormData = z.infer<typeof schema>

interface Props {
  registro?: RegistroTrabajoResponse
  parcelas: ParcelaItem[]
  onSuccess: () => void
  onCancel: () => void
}

const today = new Date().toISOString().split('T')[0]

const field =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err = 'mt-1 text-xs text-red-600'

export default function TareaForm({ registro, parcelas, onSuccess, onCancel }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!registro
  const firstRender = useRef(true)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [customTask, setCustomTask] = useState('')

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: isEdit
      ? {
          fecha: registro.fecha,
          tarea: registro.tarea,
          parcela_id: registro.parcela_id ?? '',
          unidad_medida: registro.unidad_medida,
          precio_unitario: registro.precio_unitario,
          detalle: registro.detalle ?? '',
          trabajadores: [
            { trabajador_nombre: registro.trabajador_nombre, cantidad: registro.cantidad },
          ],
        }
      : {
          fecha: today,
          tarea: '',
          parcela_id: '',
          unidad_medida: 'dias' as UnidadMedida,
          precio_unitario: undefined,
          detalle: '',
          trabajadores: [{ trabajador_nombre: '', cantidad: undefined as unknown as number }],
        },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'trabajadores' })

  const tareaWatched = watch('tarea')
  const isCustomTask = tareaWatched === CUSTOM_TASK_VALUE
  const clasificacion = isCustomTask ? null : (CLASIFICACION_POR_TAREA[tareaWatched] ?? null)

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
    }
  }, [])

  const precioWatched = watch('precio_unitario')
  const trabajadoresWatched = watch('trabajadores')
  const previewTotal =
    !isEdit && trabajadoresWatched.length === 1 && precioWatched > 0
      ? precioWatched * (trabajadoresWatched[0]?.cantidad ?? 0)
      : null

  async function onSubmit(data: FormData) {
    try {
      setSubmitError(null)
      const tareaFinal = isCustomTask ? customTask.trim() : data.tarea
      if (!tareaFinal) {
        setSubmitError('Ingresá el nombre de la nueva tarea.')
        return
      }
      if (isEdit) {
        await updateTrabajo(registro.id, {
          fecha: data.fecha,
          tarea: tareaFinal,
          parcela_id: data.parcela_id || undefined,
          unidad_medida: data.unidad_medida,
          precio_unitario: data.precio_unitario,
          detalle: data.detalle || undefined,
          trabajador_nombre: data.trabajadores[0].trabajador_nombre,
          cantidad: data.trabajadores[0].cantidad,
        })
      } else {
        await createTrabajoMasivo({
          fecha: data.fecha,
          tarea: tareaFinal,
          parcela_id: data.parcela_id || undefined,
          unidad_medida: data.unidad_medida,
          precio_unitario: data.precio_unitario,
          detalle: data.detalle || undefined,
          trabajadores: data.trabajadores,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['trabajos'] })
      onSuccess()
    } catch {
      setSubmitError('Error al guardar. Intente nuevamente.')
    }
  }

  const activeParcelas = parcelas.filter((p) => p.is_active)

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

      {/* Fecha + Tarea */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Fecha</label>
          <input type="date" {...register('fecha')} className={field} />
          {errors.fecha && <p className={err}>{errors.fecha.message}</p>}
        </div>

        <div>
          <label className={label}>Tarea</label>
          <select {...register('tarea')} className={field}>
            <option value="">Seleccionar...</option>
            {Object.entries(TAREAS_POR_TEMPORADA).map(([season, tareas]) => (
              <optgroup key={season} label={TEMPORADA_LABELS[season] ?? season}>
                {tareas.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
            ))}
            <option value={CUSTOM_TASK_VALUE}>+ Nueva tarea...</option>
          </select>
          {errors.tarea && <p className={err}>{errors.tarea.message}</p>}
        </div>
      </div>

      {/* Custom task input */}
      {isCustomTask && (
        <div>
          <label className={label}>Nombre de la nueva tarea</label>
          <input
            type="text"
            placeholder="Ej: Deschuponado, Guía, Empalme..."
            value={customTask}
            onChange={(e) => setCustomTask(e.target.value)}
            className={field}
            autoFocus
          />
          <p className="mt-1 text-xs text-gray-400">Se guardará como tarea de clasificación General.</p>
        </div>
      )}

      {/* Season badge */}
      {clasificacion && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Temporada:</span>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium ${
              CLASIFICACION_BADGE[clasificacion] ?? 'bg-gray-100 text-gray-600'
            }`}
          >
            {TEMPORADA_LABELS[clasificacion] ?? clasificacion}
          </span>
        </div>
      )}

      {/* Ubicación */}
      <div>
        <label className={label}>Ubicación</label>
        <select {...register('parcela_id')} className={field}>
          <option value="">General (sin parcela)</option>
          {activeParcelas.map((p) => (
            <option key={p.id} value={p.id}>
              {formatParcelaLabel(p.nombre)}
            </option>
          ))}
        </select>
      </div>

      {/* Unidad + Precio */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Unidad</label>
          <select {...register('unidad_medida')} className={field}>
            {UNIDAD_VALUES.map((u) => (
              <option key={u} value={u}>{UNIDAD_LABELS[u]}</option>
            ))}
          </select>
          {errors.unidad_medida && <p className={err}>{errors.unidad_medida.message}</p>}
        </div>

        <div>
          <label className={label}>Precio por unidad (ARS)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            {...register('precio_unitario')}
            className={field}
          />
          {errors.precio_unitario && <p className={err}>{errors.precio_unitario.message}</p>}
        </div>
      </div>

      {/* Trabajadores */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className={label + ' mb-0'}>
            {isEdit ? 'Trabajador' : 'Trabajadores'}
          </label>
          {!isEdit && (
            <button
              type="button"
              onClick={() => append({ trabajador_nombre: '', cantidad: '' as unknown as number })}
              className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium"
            >
              <Plus size={13} />
              Agregar
            </button>
          )}
        </div>

        <div className="space-y-2">
          {fields.map((f, i) => (
            <div key={f.id} className="flex items-start gap-2">
              <div className="flex-1">
                <input
                  {...register(`trabajadores.${i}.trabajador_nombre`)}
                  placeholder="Nombre del trabajador"
                  className={field}
                />
                {errors.trabajadores?.[i]?.trabajador_nombre && (
                  <p className={err}>{errors.trabajadores[i]?.trabajador_nombre?.message}</p>
                )}
              </div>
              <div className="w-28">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Cant."
                  {...register(`trabajadores.${i}.cantidad`)}
                  className={field}
                />
                {errors.trabajadores?.[i]?.cantidad && (
                  <p className={err}>{errors.trabajadores[i]?.cantidad?.message}</p>
                )}
              </div>
              {!isEdit && fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="mt-0.5 p-2 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
        {errors.trabajadores && !Array.isArray(errors.trabajadores) && (errors.trabajadores as { message?: string }).message && (
          <p className={err}>{(errors.trabajadores as { message?: string }).message}</p>
        )}
      </div>

      {/* Preview total */}
      {previewTotal != null && previewTotal > 0 && (
        <div className="bg-gray-50 rounded-md px-3 py-2 text-sm text-gray-600">
          Total estimado:{' '}
          <span className="font-mono font-semibold text-gray-800">
            ${' '}
            {new Intl.NumberFormat('es-AR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(previewTotal)}
          </span>
        </div>
      )}

      {/* Detalle */}
      <div>
        <label className={label}>
          Detalle <span className="text-gray-400 font-normal">(opcional)</span>
        </label>
        <textarea
          {...register('detalle')}
          rows={2}
          placeholder="Observaciones..."
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
          {isEdit ? 'Guardar cambios' : 'Registrar'}
        </button>
      </div>
    </form>
  )
}
