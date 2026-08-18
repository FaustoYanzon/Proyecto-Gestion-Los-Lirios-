'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getValvulasReales, iniciarRiego } from '@/lib/api/riego'
import { formatParcelaLabel } from '@/lib/api/produccion'
import type { ParcelaItem } from '@/lib/api/produccion'
import { newIdempotencyKey } from '@/lib/idempotency'
import { getTrabajadores, resolveTrabajadorId } from '@/lib/api/trabajadores'
import ResponsableInput from './ResponsableInput'

const schema = z.object({
  parcela_id: z.string().min(1, 'Requerido'),
  cabezal: z.string().min(1, 'Requerido'),
  responsable: z.string().min(1, 'Requerido'),
  responsable_id: z.string().optional(),
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
  const submittingRef = useRef(false)
  const idempotencyKeyRef = useRef(newIdempotencyKey())
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [conFertilizante, setConFertilizante] = useState(false)
  const [selectedValvulas, setSelectedValvulas] = useState<Set<string>>(new Set())
  const [valvulasError, setValvulasError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: { parcela_id: '', cabezal: '', responsable: '', responsable_id: undefined, fertilizante_nombre: '' },
  })

  const { data: trabajadoresDb = [] } = useQuery({
    queryKey: ['trabajadores'],
    queryFn: getTrabajadores,
    staleTime: 60_000,
  })
  // Catálogo real de válvulas — 57 filas, se trae entero una vez y se filtra
  // client-side por parcela (evita un request por cada cambio de parcela).
  const { data: valvulasReales = [] } = useQuery({
    queryKey: ['valvulas'],
    queryFn: () => getValvulasReales(),
    staleTime: 5 * 60_000,
  })
  const responsableW = watch('responsable')
  const responsableIdW = watch('responsable_id')
  const parcelaIdW = watch('parcela_id')
  const valvulasDisponibles = useMemo(
    () => valvulasReales.filter((v) => v.parcela_id === parcelaIdW),
    [valvulasReales, parcelaIdW]
  )
  // El cabezal es un atributo de la válvula, no de la parcela — una misma
  // parcela puede tener válvulas en cabezales distintos (caso real: Parral 2).
  const cabezalesSeleccionados = useMemo(
    () => new Set(valvulasDisponibles.filter((v) => selectedValvulas.has(v.nombre)).map((v) => v.cabezal)),
    [valvulasDisponibles, selectedValvulas]
  )
  const cabezalMixto = cabezalesSeleccionados.size > 1
  const cabezalDerivado = cabezalesSeleccionados.size === 1 ? [...cabezalesSeleccionados][0] : null

  useEffect(() => {
    setValue('cabezal', cabezalDerivado != null ? String(cabezalDerivado) : '')
  }, [cabezalDerivado, setValue])

  // Solo parcelas con al menos una válvula cargada en el catálogo real.
  const parcelaIdsConValvulas = useMemo(() => new Set(valvulasReales.map((v) => v.parcela_id)), [valvulasReales])
  const parralesConRiego = parcelas
    .filter((p) => p.is_active && parcelaIdsConValvulas.has(p.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  function toggleValvula(v: string) {
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
    if (cabezalMixto) {
      setValvulasError('Estas válvulas pertenecen a cabezales distintos — cargalas en riegos separados')
      return
    }
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      setSubmitError(null)
      const responsableId = await resolveTrabajadorId(data.responsable, data.responsable_id, trabajadoresDb)
      // Nombres reales en orden oeste->este (mismo orden que valvulasDisponibles).
      const valvulaOrdenada = valvulasDisponibles
        .filter((v) => selectedValvulas.has(v.nombre))
        .map((v) => v.nombre)
        .join(',')
      await iniciarRiego({
        parcela_id: data.parcela_id,
        cabezal: data.cabezal,
        valvula: valvulaOrdenada,
        responsable: data.responsable,
        responsable_id: responsableId,
        fertilizante_nombre: conFertilizante && data.fertilizante_nombre ? data.fertilizante_nombre : undefined,
        fertilizante_dosis_lt_ha: conFertilizante ? data.fertilizante_dosis_lt_ha : undefined,
        idempotency_key: idempotencyKeyRef.current,
      })
      queryClient.invalidateQueries({ queryKey: ['riegos-en-curso'] })
      onSuccess()
    } catch {
      setSubmitError('Error al iniciar el riego. Intente nuevamente.')
    } finally {
      submittingRef.current = false
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
          {parralesConRiego.map((p) => (
            <option key={p.id} value={p.id}>
              {formatParcelaLabel(p.nombre)}{p.superficie_ha ? ` (${p.superficie_ha} ha)` : ''}
            </option>
          ))}
        </select>
        {errors.parcela_id && <p className={err}>{errors.parcela_id.message}</p>}
      </div>

      <input type="hidden" {...register('cabezal')} />
      {cabezalDerivado != null && !cabezalMixto && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium text-gray-700">Cabezal:</span>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            Cabezal {cabezalDerivado}
          </span>
        </div>
      )}
      {cabezalMixto && (
        <p className="text-xs text-red-600">
          Estas válvulas pertenecen a cabezales distintos ({[...cabezalesSeleccionados].sort().join(', ')}) — cargalas en riegos separados.
        </p>
      )}

      <div>
        <label className={label}>Válvulas abiertas</label>
        <div className="flex gap-3 flex-wrap">
          {valvulasDisponibles.map((v) => (
            <label
              key={v.nombre}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors select-none text-sm font-medium ${
                selectedValvulas.has(v.nombre)
                  ? 'bg-[#faf6ec] border-[#7a1f2c] text-[#7a1f2c]'
                  : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
              }`}
            >
              <input
                type="checkbox"
                checked={selectedValvulas.has(v.nombre)}
                onChange={() => toggleValvula(v.nombre)}
                className="sr-only"
              />
              Válvula {v.nombre}
              <span className="text-xs text-gray-400">(cab. {v.cabezal})</span>
            </label>
          ))}
          {parcelaIdW && valvulasDisponibles.length === 0 && (
            <p className="text-xs text-gray-400">Esta parcela no tiene válvulas cargadas todavía.</p>
          )}
        </div>
        {valvulasError && <p className={err}>{valvulasError}</p>}
      </div>

      <div>
        <label className={label}>Responsable</label>
        <ResponsableInput
          value={responsableW}
          trabajadorId={responsableIdW}
          onChange={(nombre, trabajadorId) => {
            setValue('responsable', nombre)
            setValue('responsable_id', trabajadorId)
          }}
          className={field}
          error={errors.responsable?.message}
        />
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
