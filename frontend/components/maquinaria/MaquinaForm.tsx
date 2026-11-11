'use client'

import { useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createMaquina,
  getMaquinas,
  getMaquinariaErrorMessage,
  TIPO_MAQUINA_VALUES,
  TIPO_MAQUINA_LABELS,
  type FincaMaquinaria,
} from '@/lib/api/maquinaria'
import { useContextStore } from '@/store/contextStore'

// Caucete is no longer offered for new records (same rule as IngresoForm).
const FINCA_OPTIONS: { value: FincaMaquinaria; label: string }[] = [
  { value: 'los_mimbres', label: 'Los Mimbres' },
  { value: 'media_agua', label: 'Media Agua' },
]

// Numeric inputs stay as strings in the form and are converted on submit.
const schema = z.object({
  tipo: z.enum(TIPO_MAQUINA_VALUES, { error: 'Requerido' }),
  marca: z.string().trim().min(1, 'Requerido').max(100),
  modelo: z.string().trim().min(1, 'Requerido').max(100),
  anio: z
    .string()
    .optional()
    .refine((v) => !v || (/^\d{4}$/.test(v) && Number(v) >= 1900 && Number(v) <= 2100), {
      message: 'Año entre 1900 y 2100',
    }),
  patente_serie: z.string().trim().max(100).optional(),
  finca: z.enum(['los_mimbres', 'media_agua', 'caucete'] as const, { error: 'Requerido' }),
  tractor_id: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface Props {
  onSuccess: () => void
  onCancel: () => void
}

const field =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'
const err = 'mt-1 text-xs text-red-600'

export default function MaquinaForm({ onSuccess, onCancel }: Props) {
  const queryClient = useQueryClient()
  const fincaActiva = useContextStore((s) => s.finca)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: {
      marca: '',
      modelo: '',
      anio: '',
      patente_serie: '',
      tractor_id: '',
      finca: fincaActiva === 'caucete' ? undefined : fincaActiva,
    },
  })

  const esImplemento = watch('tipo') === 'implemento'

  // Only active tractors can be assigned (backend validates the same rule).
  const { data: tractores = [] } = useQuery({
    queryKey: ['maquinaria', 'tractores'],
    queryFn: () => getMaquinas({ tipo: 'tractor' }),
    enabled: esImplemento,
  })

  async function onSubmit(data: FormData) {
    try {
      setSubmitError(null)
      await createMaquina({
        tipo: data.tipo,
        marca: data.marca,
        modelo: data.modelo,
        anio: data.anio ? Number(data.anio) : null,
        patente_serie: data.patente_serie || null,
        finca: data.finca,
        tractor_id: esImplemento && data.tractor_id ? data.tractor_id : null,
      })
      queryClient.invalidateQueries({ queryKey: ['maquinaria'] })
      onSuccess()
    } catch (e) {
      setSubmitError(getMaquinariaErrorMessage(e, 'Error al guardar. Intente nuevamente.'))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Tipo</label>
          <select {...register('tipo')} className={field}>
            <option value="">Seleccionar...</option>
            {TIPO_MAQUINA_VALUES.map((t) => (
              <option key={t} value={t}>{TIPO_MAQUINA_LABELS[t]}</option>
            ))}
          </select>
          {errors.tipo && <p className={err}>{errors.tipo.message}</p>}
        </div>

        <div>
          <label className={lbl}>Finca</label>
          <select {...register('finca')} className={field}>
            <option value="">Seleccionar...</option>
            {FINCA_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          {errors.finca && <p className={err}>{errors.finca.message}</p>}
        </div>

        <div>
          <label className={lbl}>Marca</label>
          <input type="text" placeholder="Ej: John Deere" {...register('marca')} className={field} />
          {errors.marca && <p className={err}>{errors.marca.message}</p>}
        </div>

        <div>
          <label className={lbl}>Modelo</label>
          <input type="text" placeholder="Ej: 5090" {...register('modelo')} className={field} />
          {errors.modelo && <p className={err}>{errors.modelo.message}</p>}
        </div>

        <div>
          <label className={lbl}>Año <span className="text-gray-400 font-normal">(opcional)</span></label>
          <input type="number" inputMode="numeric" placeholder="Ej: 2015" {...register('anio')} className={field} />
          {errors.anio && <p className={err}>{errors.anio.message}</p>}
        </div>

        <div>
          <label className={lbl}>Patente / N° de serie <span className="text-gray-400 font-normal">(opcional)</span></label>
          <input type="text" {...register('patente_serie')} className={field} />
          {errors.patente_serie && <p className={err}>{errors.patente_serie.message}</p>}
        </div>

        {esImplemento && (
          <div className="md:col-span-2">
            <label className={lbl}>Tractor asociado <span className="text-gray-400 font-normal">(opcional)</span></label>
            <select {...register('tractor_id')} className={field}>
              <option value="">Sin tractor asociado</option>
              {tractores.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.marca} {t.modelo}{t.patente_serie ? ` · ${t.patente_serie}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {submitError && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{submitError}</p>
      )}

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
