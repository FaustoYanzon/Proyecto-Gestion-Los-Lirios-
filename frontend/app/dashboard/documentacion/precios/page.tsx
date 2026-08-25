'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, Loader2 } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  getPreciosTarea,
  createPrecioTarea,
  updatePrecioTarea,
  deletePrecioTarea,
  type PrecioTareaResponse,
} from '@/lib/api/preciosTarea'
import { TAREAS_POR_TEMPORADA, UNIDAD_VALUES, UNIDAD_LABELS, type UnidadMedida } from '@/lib/api/produccion'
import { listParcelasAdmin } from '@/lib/api/parcelas'
import { useContextStore, campanaToAnio } from '@/store/contextStore'

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err   = 'mt-1 text-xs text-red-600'

const TODAS_TAREAS = Object.values(TAREAS_POR_TEMPORADA).flat().filter((t) => t !== 'Otros')
const TAREAS_UNICAS = Array.from(new Set(TODAS_TAREAS)).sort((a, b) => a.localeCompare(b, 'es'))

const GENERAL_VALUE = '__general__'

const createSchema = z.object({
  temporada: z.coerce.number().int().min(2020).max(2100),
  tarea: z.string().min(1, 'Requerido'),
  parcela_id: z.string(),
  unidad_medida: z.enum(UNIDAD_VALUES),
  precio_unitario: z.coerce.number().positive('Debe ser mayor a 0'),
})

const editSchema = z.object({
  precio_unitario: z.coerce.number().positive('Debe ser mayor a 0'),
})

type CreateData = z.infer<typeof createSchema>
type EditData = z.infer<typeof editSchema>

// ── Modal ─────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const handleKey = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }, [onClose])
  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [handleKey])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

// ── Create form ───────────────────────────────────────────────────────────────

function CreatePrecioForm({
  temporadaDefault,
  parcelas,
  onSuccess,
  onCancel,
}: {
  temporadaDefault: number
  parcelas: { id: string; nombre: string }[]
  onSuccess: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateData>({
    resolver: zodResolver(createSchema) as Resolver<CreateData>,
    defaultValues: {
      temporada: temporadaDefault,
      tarea: '',
      parcela_id: GENERAL_VALUE,
      unidad_medida: 'dias',
      precio_unitario: undefined,
    },
  })

  async function onSubmit(data: CreateData) {
    try {
      setSubmitError(null)
      await createPrecioTarea({
        temporada: data.temporada,
        tarea: data.tarea,
        parcela_id: data.parcela_id === GENERAL_VALUE ? null : data.parcela_id,
        unidad_medida: data.unidad_medida,
        precio_unitario: data.precio_unitario,
      })
      queryClient.invalidateQueries({ queryKey: ['precios-tarea'] })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitError(typeof detail === 'string' ? detail : 'Error al crear el precio.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className={label}>Campaña (año de inicio)</label>
        <input type="number" {...register('temporada')} className={field} placeholder="Ej: 2026" />
        {errors.temporada && <p className={err}>{errors.temporada.message}</p>}
      </div>
      <div>
        <label className={label}>Tarea</label>
        <select {...register('tarea')} className={field}>
          <option value="">Seleccionar...</option>
          {TAREAS_UNICAS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {errors.tarea && <p className={err}>{errors.tarea.message}</p>}
      </div>
      <div>
        <label className={label}>Parral</label>
        <select {...register('parcela_id')} className={field}>
          <option value={GENERAL_VALUE}>General (todos los parrales sin regla propia)</option>
          {parcelas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <div>
        <label className={label}>Unidad</label>
        <select {...register('unidad_medida')} className={field}>
          {UNIDAD_VALUES.map((u) => <option key={u} value={u}>{UNIDAD_LABELS[u]}</option>)}
        </select>
      </div>
      <div>
        <label className={label}>Precio unitario</label>
        <input type="number" step="0.01" min="0" {...register('precio_unitario')} className={field} placeholder="0.00" />
        {errors.precio_unitario && <p className={err}>{errors.precio_unitario.message}</p>}
      </div>
      {submitError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{submitError}</p>}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 transition-colors">
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Crear precio
        </button>
      </div>
    </form>
  )
}

// ── Edit form (solo el precio -- el resto define la regla, no se edita) ────────

function EditPrecioForm({
  precio,
  onSuccess,
  onCancel,
}: {
  precio: PrecioTareaResponse
  onSuccess: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<EditData>({
    resolver: zodResolver(editSchema) as Resolver<EditData>,
    defaultValues: { precio_unitario: precio.precio_unitario },
  })

  async function onSubmit(data: EditData) {
    try {
      setSubmitError(null)
      await updatePrecioTarea(precio.id, { precio_unitario: data.precio_unitario })
      queryClient.invalidateQueries({ queryKey: ['precios-tarea'] })
      onSuccess()
    } catch {
      setSubmitError('Error al guardar el precio.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-600 space-y-1">
        <div><span className="font-medium text-gray-900">Campaña:</span> {precio.temporada}/{precio.temporada + 1}</div>
        <div><span className="font-medium text-gray-900">Tarea:</span> {precio.tarea}</div>
        <div><span className="font-medium text-gray-900">Parral:</span> {precio.parcela_nombre ?? 'General'}</div>
        <div><span className="font-medium text-gray-900">Unidad:</span> {UNIDAD_LABELS[precio.unidad_medida]}</div>
      </div>
      <div>
        <label className={label}>Precio unitario</label>
        <input type="number" step="0.01" min="0" {...register('precio_unitario')} className={field} autoFocus />
        {errors.precio_unitario && <p className={err}>{errors.precio_unitario.message}</p>}
      </div>
      {submitError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{submitError}</p>}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 transition-colors">
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Guardar cambios
        </button>
      </div>
    </form>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DocumentacionPreciosPage() {
  const campanaGlobal = useContextStore((s) => s.campana)
  const temporadaDefault = campanaToAnio(campanaGlobal)
  const [temporada, setTemporada] = useState(temporadaDefault)
  const [tareaFilter, setTareaFilter] = useState<string>('')
  const [modal, setModal] = useState<'create' | { edit: PrecioTareaResponse } | null>(null)
  const queryClient = useQueryClient()

  // Re-sincroniza con la campaña del selector global -- ajustado durante el
  // render, no en un useEffect, ver react-hooks/set-state-in-effect.
  const [prevCampanaGlobal, setPrevCampanaGlobal] = useState(campanaGlobal)
  if (prevCampanaGlobal !== campanaGlobal) {
    setPrevCampanaGlobal(campanaGlobal)
    setTemporada(temporadaDefault)
  }

  const { data: precios = [], isLoading } = useQuery({
    queryKey: ['precios-tarea', temporada, tareaFilter],
    queryFn: () => getPreciosTarea({ temporada, tarea: tareaFilter || undefined }),
  })

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas-admin'],
    queryFn: listParcelasAdmin,
  })
  const parcelasActivas = parcelas.filter((p) => p.is_active)

  async function handleDelete(p: PrecioTareaResponse) {
    if (!window.confirm(`¿Borrar el precio de "${p.tarea}" (${p.parcela_nombre ?? 'General'})?`)) return
    try {
      await deletePrecioTarea(p.id)
      queryClient.invalidateQueries({ queryKey: ['precios-tarea'] })
    } catch {
      alert('Error al borrar el precio.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Precios por Tarea</h1>
          <p className="text-sm text-gray-500 mt-1">
            Maestro de precios de referencia — autocompleta el precio al cargar una tarea, sigue siendo editable ahí.
          </p>
        </div>
        <button
          onClick={() => setModal('create')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
        >
          <Plus size={16} />
          Nuevo precio
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={temporada}
          onChange={(e) => setTemporada(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]"
        >
          {[temporadaDefault - 2, temporadaDefault - 1, temporadaDefault, temporadaDefault + 1].map((a) => (
            <option key={a} value={a}>{a}/{a + 1}</option>
          ))}
        </select>
        <select
          value={tareaFilter}
          onChange={(e) => setTareaFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]"
        >
          <option value="">Todas las tareas</option>
          {TAREAS_UNICAS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tarea</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Parral</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Unidad</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Precio</th>
                <th className="px-4 py-3 font-medium text-gray-600 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : precios.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                    No hay precios cargados para esta campaña
                  </td>
                </tr>
              ) : (
                precios.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{p.tarea}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {p.parcela_nombre ?? <span className="italic text-gray-400">General</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{UNIDAD_LABELS[p.unidad_medida as UnidadMedida]}</td>
                    <td className="px-4 py-3 text-right text-gray-900 font-mono">
                      {p.precio_unitario.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => setModal({ edit: p })}
                          title="Editar precio"
                          className="p-1.5 rounded-md text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDelete(p)}
                          title="Borrar"
                          className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!isLoading && precios.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-400">
            {precios.length} precio{precios.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {modal === 'create' && (
        <Modal title="Nuevo precio" onClose={() => setModal(null)}>
          <CreatePrecioForm
            temporadaDefault={temporada}
            parcelas={parcelasActivas}
            onSuccess={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}

      {modal !== null && modal !== 'create' && (
        <Modal title="Editar precio" onClose={() => setModal(null)}>
          <EditPrecioForm precio={modal.edit} onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </div>
  )
}
