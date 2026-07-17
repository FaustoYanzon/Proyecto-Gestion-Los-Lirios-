'use client'

import { useState, useEffect } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { getValvulas, iniciarRiego } from '@/lib/api/riego'
import { formatParcelaLabel } from '@/lib/api/produccion'
import type { ParcelaItem } from '@/lib/api/produccion'

const schema = z.object({
  parcela_id: z.string().min(1, 'Requerido'),
  cabezal: z.string().min(1, 'Requerido'),
  responsable: z.string().min(1, 'Requerido'),
  fertilizante_nombre: z.string().optional(),
  fertilizante_dosis_lt_ha: z.preprocess(
    (v) => (!v || v === '' ? undefined : Number(v)),
    z.number().positive().optional()
  ),
})

type FormData = z.infer<typeof schema>

interface Props {
  parcelas: ParcelaItem[]
  onSuccess: () => void
  onCancel: () => void
}

const field =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err = 'mt-1 text-xs text-red-600'

export default function IniciarRiegoForm({ parcelas, onSuccess, onCancel }: Props) {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [conFertilizante, setConFertilizante] = useState(false)
  const [selectedValvulas, setSelectedValvulas] = useState<Set<number>>(new Set())
  const [valvulasError, setValvulasError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: { parcela_id: '', cabezal: '', responsable: '', fertilizante_nombre: '' },
  })

  const parcelaIdW = watch('parcela_id')
  const parcelaSeleccionada = parcelas.find((p) => p.id === parcelaIdW)
  const valvulasDisponibles = parcelaSeleccionada ? getValvulas(parcelaSeleccionada.nombre) : [1, 2, 3, 4]

  useEffect(() => {
    setValue('cabezal', parcelaSeleccionada?.cabezal_riego ?? '')
  }, [parcelaSeleccionada, setValue])

  const parralesConRiego = parcelas
    .filter((p) => p.is_active && p.cabezal_riego && p.cabezal_riego !== 'MANTO')
    .sort((a, b) => (a.cabezal_riego ?? '').localeCompare(b.cabezal_riego ?? '') || a.nombre.localeCompare(b.nombre))

  function toggleValvula(v: number) {
    setSelectedValvulas((prev) => {
      const next = new Set(prev)
      next.has(v) ? next.delete(v) : next.add(v)
      return next
    })
    setValvulasError(null)
  }

  async function onSubmit(data: FormData) {
    if (selectedValvulas.size === 0) {
      setValvulasError('Seleccioná al menos una válvula')
      return
    }
    try {
      setSubmitError(null)
      await iniciarRiego({
        parcela_id: data.parcela_id,
        cabezal: data.cabezal,
        valvula: Array.from(selectedValvulas).sort().join(','),
        responsable: data.responsable,
        fertilizante_nombre: conFertilizante && data.fertilizante_nombre ? data.fertilizante_nombre : undefined,
        fertilizante_dosis_lt_ha: conFertilizante ? data.fertilizante_dosis_lt_ha : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['riegos-en-curso'] })
      onSuccess()
    } catch {
      setSubmitError('Error al iniciar el riego. Intente nuevamente.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <p className="text-sm text-gray-500">
        Arranca el riego ahora mismo, sin hora de fin — lo vas a poder cerrar después desde &quot;Riegos en curso&quot;.
      </p>

      <div>
        <label className={label}>Parcela</label>
        <select {...register('parcela_id')} className={field}>
          <option value="">Seleccionar parcela...</option>
          {[...new Set(parralesConRiego.map((p) => p.cabezal_riego))].map((cab) => (
            <optgroup key={cab} label={`Cabezal ${cab}`}>
              {parralesConRiego
                .filter((p) => p.cabezal_riego === cab)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatParcelaLabel(p.nombre)}{p.superficie_ha ? ` (${p.superficie_ha} ha)` : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {errors.parcela_id && <p className={err}>{errors.parcela_id.message}</p>}
      </div>

      <input type="hidden" {...register('cabezal')} />
      {parcelaSeleccionada?.cabezal_riego && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium text-gray-700">Cabezal:</span>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            Cabezal {parcelaSeleccionada.cabezal_riego}
          </span>
        </div>
      )}

      <div>
        <label className={label}>Válvulas abiertas</label>
        <div className="flex gap-3 flex-wrap">
          {valvulasDisponibles.map((v) => (
            <label
              key={v}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors select-none text-sm font-medium ${
                selectedValvulas.has(v)
                  ? 'bg-[#faf6ec] border-[#7a1f2c] text-[#7a1f2c]'
                  : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedValvulas.has(v)}
                onChange={() => toggleValvula(v)}
                className="sr-only"
              />
              Válvula {v}
            </label>
          ))}
        </div>
        {valvulasError && <p className={err}>{valvulasError}</p>}
      </div>

      <div>
        <label className={label}>Responsable</label>
        <input type="text" placeholder="Nombre..." {...register('responsable')} className={field} />
        {errors.responsable && <p className={err}>{errors.responsable.message}</p>}
      </div>

      <div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={conFertilizante}
            onChange={(e) => setConFertilizante(e.target.checked)}
            className="rounded border-gray-300 text-[#7a1f2c] focus:ring-[#7a1f2c]"
          />
          <span className="text-sm font-medium text-gray-700">Con fertiriego</span>
        </label>
      </div>

      {conFertilizante && (
        <div className="grid grid-cols-2 gap-4 pl-4 border-l-2 border-blue-100">
          <div>
            <label className={label}>Fertilizante</label>
            <input type="text" placeholder="Nombre del producto" {...register('fertilizante_nombre')} className={field} />
          </div>
          <div>
            <label className={label}>Dosis (L/ha)</label>
            <input type="number" step="0.1" min="0" placeholder="0.0" {...register('fertilizante_dosis_lt_ha')} className={field} />
          </div>
        </div>
      )}

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
          Iniciar riego
        </button>
      </div>
    </form>
  )
}
