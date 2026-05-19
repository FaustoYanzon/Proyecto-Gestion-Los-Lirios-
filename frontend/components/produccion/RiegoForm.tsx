'use client'

import { useState, useEffect } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Droplets } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  calcMm,
  getValvulas,
  createRiego,
  updateRiego,
  type RiegoResponse,
} from '@/lib/api/riego'
import { formatParcelaLabel } from '@/lib/api/produccion'
import type { ParcelaItem } from '@/lib/api/produccion'

const schema = z.object({
  fecha_inicio: z.string().min(1, 'Requerido'),
  hora_inicio: z.string().min(1, 'Requerido'),
  fecha_fin: z.string().min(1, 'Requerido'),
  hora_fin: z.string().min(1, 'Requerido'),
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
  riego?: RiegoResponse
  parcelas: ParcelaItem[]
  onSuccess: () => void
  onCancel: () => void
}

const today = new Date().toISOString().split('T')[0]

const field =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err = 'mt-1 text-xs text-red-600'

function extractDate(dt: string): string {
  if (!dt) return today
  return dt.includes('T') ? dt.split('T')[0] : dt.slice(0, 10)
}

function extractTime(dt: string): string {
  if (!dt) return ''
  return dt.includes('T') ? dt.split('T')[1].slice(0, 5) : dt.slice(11, 16)
}

export default function RiegoForm({ riego, parcelas, onSuccess, onCancel }: Props) {
  const queryClient = useQueryClient()
  const isEdit = !!riego
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [conFertilizante, setConFertilizante] = useState(!!riego?.fertilizante_nombre)

  // Válvulas — managed separately as Set since checkboxes need custom handling
  const [selectedValvulas, setSelectedValvulas] = useState<Set<number>>(
    isEdit
      ? new Set(riego.valvula.split(',').map(Number).filter(Boolean))
      : new Set()
  )
  const [valvulasError, setValvulasError] = useState<string | null>(null)

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
          fecha_inicio: extractDate(riego.inicio),
          hora_inicio: extractTime(riego.inicio),
          fecha_fin: extractDate(riego.fin),
          hora_fin: extractTime(riego.fin),
          parcela_id: riego.parcela_id,
          cabezal: riego.cabezal,
          responsable: riego.responsable,
          fertilizante_nombre: riego.fertilizante_nombre ?? '',
          fertilizante_dosis_lt_ha: riego.fertilizante_dosis_lt_ha ?? undefined,
        }
      : {
          fecha_inicio: today,
          hora_inicio: '',
          fecha_fin: today,
          hora_fin: '',
          parcela_id: '',
          cabezal: '',
          responsable: '',
          fertilizante_nombre: '',
        },
  })

  const parcelaIdW = watch('parcela_id')
  const fechaInicioW = watch('fecha_inicio')
  const horaInicioW = watch('hora_inicio')
  const fechaFinW = watch('fecha_fin')
  const horaFinW = watch('hora_fin')

  const parcelaSeleccionada = parcelas.find((p) => p.id === parcelaIdW)
  const valvulasDisponibles = parcelaSeleccionada ? getValvulas(parcelaSeleccionada.nombre) : [1, 2, 3, 4]
  const preview = calcMm(fechaInicioW, horaInicioW, fechaFinW, horaFinW)

  // Auto-populate cabezal from parcela
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
      const inicio = `${data.fecha_inicio}T${data.hora_inicio}:00`
      const fin = `${data.fecha_fin}T${data.hora_fin}:00`
      const mm = calcMm(data.fecha_inicio, data.hora_inicio, data.fecha_fin, data.hora_fin)?.mm
      const valvula = Array.from(selectedValvulas).sort().join(',')

      const payload = {
        fecha: data.fecha_inicio,
        parcela_id: data.parcela_id,
        cabezal: data.cabezal,
        valvula,
        inicio,
        fin,
        mm_aplicados: mm,
        responsable: data.responsable,
        fertilizante_nombre: conFertilizante && data.fertilizante_nombre ? data.fertilizante_nombre : undefined,
        fertilizante_dosis_lt_ha: conFertilizante ? data.fertilizante_dosis_lt_ha : undefined,
      }

      if (isEdit) {
        await updateRiego(riego.id, payload)
      } else {
        await createRiego(payload)
      }

      queryClient.invalidateQueries({ queryKey: ['riegos'] })
      onSuccess()
    } catch {
      setSubmitError('Error al guardar. Intente nuevamente.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

      {/* Inicio */}
      <div>
        <p className={label}>Inicio del riego</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Fecha</label>
            <input type="date" {...register('fecha_inicio')} className={field} />
            {errors.fecha_inicio && <p className={err}>{errors.fecha_inicio.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hora</label>
            <input type="time" {...register('hora_inicio')} className={field} />
            {errors.hora_inicio && <p className={err}>{errors.hora_inicio.message}</p>}
          </div>
        </div>
      </div>

      {/* Fin */}
      <div>
        <p className={label}>Fin del riego</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Fecha</label>
            <input type="date" {...register('fecha_fin')} className={field} />
            {errors.fecha_fin && <p className={err}>{errors.fecha_fin.message}</p>}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Hora</label>
            <input type="time" {...register('hora_fin')} className={field} />
            {errors.hora_fin && <p className={err}>{errors.hora_fin.message}</p>}
          </div>
        </div>
      </div>

      {/* Preview duración + mm */}
      {preview ? (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-md px-4 py-3">
          <Droplets size={18} className="text-blue-500 flex-shrink-0" />
          <div className="text-sm">
            <span className="text-blue-700 font-medium">{preview.horas}h de riego</span>
            <span className="text-blue-400 mx-2">→</span>
            <span className="text-blue-900 font-semibold font-mono">{preview.mm} mm</span>
            <span className="text-blue-400 text-xs ml-2">(16.000 L/ha/h)</span>
          </div>
        </div>
      ) : (fechaInicioW && horaInicioW && fechaFinW && horaFinW) ? (
        <p className="text-xs text-red-500">La fecha/hora de fin debe ser posterior al inicio</p>
      ) : null}

      {/* Parcela */}
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

      {/* Cabezal — read-only, derivado de la parcela */}
      <input type="hidden" {...register('cabezal')} />
      {parcelaSeleccionada?.cabezal_riego && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="font-medium text-gray-700">Cabezal:</span>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            Cabezal {parcelaSeleccionada.cabezal_riego}
          </span>
        </div>
      )}

      {/* Válvulas — checkboxes múltiples */}
      <div>
        <label className={label}>Válvulas abiertas</label>
        <div className="flex gap-3 flex-wrap">
          {valvulasDisponibles.map((v) => (
            <label
              key={v}
              className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors select-none text-sm font-medium ${
                selectedValvulas.has(v)
                  ? 'bg-blue-50 border-blue-400 text-blue-700'
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

      {/* Responsable */}
      <div>
        <label className={label}>Responsable</label>
        <input type="text" placeholder="Nombre..." {...register('responsable')} className={field} />
        {errors.responsable && <p className={err}>{errors.responsable.message}</p>}
      </div>

      {/* Fertilizante toggle */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={conFertilizante}
            onChange={(e) => setConFertilizante(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? 'Guardar cambios' : 'Registrar riego'}
        </button>
      </div>
    </form>
  )
}
