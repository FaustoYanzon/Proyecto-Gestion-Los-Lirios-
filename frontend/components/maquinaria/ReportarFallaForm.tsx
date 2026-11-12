'use client'

import { useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createOrden,
  getMaquinas,
  getMaquinariaErrorMessage,
  uploadFotoOrden,
  GRAVEDAD_FALLA_LABELS,
  GRAVEDAD_FALLA_VALUES,
} from '@/lib/api/maquinaria'
import { MAX_FOTOS } from './OrdenFotos'
import { btnPrimary, btnSecondary, errCls, inputCls, labelCls } from './ordenUi'

const schema = z.object({
  maquina_id: z.string().min(1, 'Requerido'),
  descripcion: z.string().trim().min(1, 'Requerido').max(2000),
  gravedad: z.enum(GRAVEDAD_FALLA_VALUES, { error: 'Requerido' }),
})

type FormData = z.infer<typeof schema>

interface Props {
  onSuccess: () => void
  onCancel: () => void
}

export default function ReportarFallaForm({ onSuccess, onCancel }: Props) {
  const queryClient = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  // One key per form instance: a retry after a network error returns the same order.
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  // Set once the order exists, so a retry only re-uploads the photos.
  const [createdOrdenId, setCreatedOrdenId] = useState<string | null>(null)
  const [uploadedCount, setUploadedCount] = useState(0)

  // The API only returns active machines by default.
  const { data: maquinas = [], isLoading: loadingMaquinas } = useQuery({
    queryKey: ['maquinaria', 'maquinas', 'activas'],
    queryFn: () => getMaquinas(),
    staleTime: 30_000,
  })

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: { maquina_id: '', descripcion: '', gravedad: 'sigue_trabajando' },
  })

  async function onSubmit(data: FormData) {
    setSubmitError(null)
    let ordenId = createdOrdenId
    try {
      if (!ordenId) {
        const orden = await createOrden({ ...data, idempotency_key: idempotencyKey })
        ordenId = orden.id
        setCreatedOrdenId(orden.id)
      }
    } catch (e) {
      setSubmitError(getMaquinariaErrorMessage(e, 'No se pudo reportar la falla.'))
      return
    }
    // Photos go after the order exists (offline-friendly flow: JSON first, files later).
    try {
      let done = uploadedCount
      for (const file of files.slice(uploadedCount)) {
        await uploadFotoOrden(ordenId, file)
        done += 1
        setUploadedCount(done)
      }
    } catch (e) {
      queryClient.invalidateQueries({ queryKey: ['maquinaria'] })
      setSubmitError(
        `La falla se reportó, pero falló la subida de fotos: ${getMaquinariaErrorMessage(e, 'error de conexión')}. ` +
          'Podés reintentar o agregarlas desde el detalle de la orden.'
      )
      return
    }
    queryClient.invalidateQueries({ queryKey: ['maquinaria'] })
    onSuccess()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className={labelCls}>Máquina</label>
        <select {...register('maquina_id')} className={inputCls} disabled={loadingMaquinas}>
          <option value="">{loadingMaquinas ? 'Cargando...' : 'Seleccionar...'}</option>
          {maquinas.map((m) => (
            <option key={m.id} value={m.id}>
              {m.marca} {m.modelo}{m.patente_serie ? ` · ${m.patente_serie}` : ''}
            </option>
          ))}
        </select>
        {errors.maquina_id && <p className={errCls}>{errors.maquina_id.message}</p>}
      </div>

      <div>
        <label className={labelCls}>Descripción de la falla</label>
        <textarea rows={4} {...register('descripcion')} className={inputCls} />
        {errors.descripcion && <p className={errCls}>{errors.descripcion.message}</p>}
      </div>

      <div>
        <label className={labelCls}>Gravedad</label>
        <select {...register('gravedad')} className={inputCls}>
          {GRAVEDAD_FALLA_VALUES.map((g) => (
            <option key={g} value={g}>{GRAVEDAD_FALLA_LABELS[g]}</option>
          ))}
        </select>
        {errors.gravedad && <p className={errCls}>{errors.gravedad.message}</p>}
      </div>

      <div>
        <label className={labelCls}>
          Fotos <span className="text-gray-400 font-normal">(opcional, hasta {MAX_FOTOS})</span>
        </label>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={createdOrdenId !== null}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FOTOS))}
          className="block w-full text-sm text-gray-700"
        />
        {files.length > 0 && (
          <p className="mt-1 text-xs text-gray-500">{files.length} foto(s) seleccionada(s)</p>
        )}
      </div>

      {submitError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{submitError}</p>}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} className={btnSecondary}>Cancelar</button>
        <button type="submit" disabled={isSubmitting} className={btnPrimary}>
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          {createdOrdenId ? 'Reintentar fotos' : 'Reportar falla'}
        </button>
      </div>
    </form>
  )
}
