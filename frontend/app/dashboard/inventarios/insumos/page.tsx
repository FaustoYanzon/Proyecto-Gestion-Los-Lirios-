'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, PackagePlus, RotateCcw, Trash2, X, Loader2 } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  getInsumos,
  createInsumo,
  updateInsumo,
  registrarMovimiento,
  type InsumoResponse,
  type UnidadInsumo,
} from '@/lib/api/insumos'
import { useAuthStore } from '@/store/authStore'

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err   = 'mt-1 text-xs text-red-600'

const UNIDAD_VALUES: UnidadInsumo[] = ['lt', 'kg']
const UNIDAD_LABELS: Record<UnidadInsumo, string> = { lt: 'Litros (lt)', kg: 'Kilogramos (kg)' }

const schema = z.object({
  nombre: z.string().min(2, 'Mínimo 2 caracteres'),
  unidad: z.enum(UNIDAD_VALUES as [UnidadInsumo, ...UnidadInsumo[]]),
  categoria: z.string().optional(),
  stock_actual: z.coerce.number().min(0, 'Mínimo 0').optional(),
})

type FormData = z.infer<typeof schema>

const movimientoSchema = z.object({
  cantidad: z.coerce.number().positive('Debe ser mayor a 0'),
  fecha: z.string().min(1, 'Requerido'),
  observacion: z.string().optional(),
})

type MovimientoFormData = z.infer<typeof movimientoSchema>

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

// ── Insumo form ───────────────────────────────────────────────────────────────

function InsumoForm({
  insumo,
  onSuccess,
  onCancel,
}: {
  insumo?: InsumoResponse
  onSuccess: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const isEdit = !!insumo
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: isEdit
      ? { nombre: insumo.nombre, unidad: insumo.unidad, categoria: insumo.categoria ?? '' }
      : { nombre: '', unidad: 'lt', categoria: '', stock_actual: 0 },
  })

  async function onSubmit(data: FormData) {
    try {
      setSubmitError(null)
      if (isEdit) {
        await updateInsumo(insumo.id, { nombre: data.nombre, unidad: data.unidad, categoria: data.categoria || undefined })
      } else {
        await createInsumo({
          nombre: data.nombre,
          unidad: data.unidad,
          categoria: data.categoria || undefined,
          stock_actual: data.stock_actual ?? 0,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['insumos-admin'] })
      queryClient.invalidateQueries({ queryKey: ['insumos'] })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitError(typeof detail === 'string' ? detail : 'Error al guardar el insumo.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className={label}>Nombre</label>
        <input type="text" {...register('nombre')} className={field} placeholder="Ej: Azufre Micronizado" autoFocus />
        {errors.nombre && <p className={err}>{errors.nombre.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Unidad</label>
          <select {...register('unidad')} className={field}>
            {UNIDAD_VALUES.map((u) => (
              <option key={u} value={u}>{UNIDAD_LABELS[u]}</option>
            ))}
          </select>
        </div>
        {!isEdit && (
          <div>
            <label className={label}>Stock inicial</label>
            <input type="number" step="0.01" min="0" {...register('stock_actual')} className={field} placeholder="0.00" />
          </div>
        )}
      </div>

      <div>
        <label className={label}>Categoría (opcional)</label>
        <input type="text" {...register('categoria')} className={field} placeholder="Ej: OIDIO, NUTR, HERBICIDA..." />
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
          {isEdit ? 'Guardar cambios' : 'Crear insumo'}
        </button>
      </div>
    </form>
  )
}

// ── Reposición form ───────────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0]

function ReposicionForm({ insumo, onSuccess, onCancel }: { insumo: InsumoResponse; onSuccess: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<MovimientoFormData>({
    resolver: zodResolver(movimientoSchema) as Resolver<MovimientoFormData>,
    defaultValues: { fecha: today, observacion: '' },
  })

  async function onSubmit(data: MovimientoFormData) {
    try {
      setSubmitError(null)
      await registrarMovimiento(insumo.id, { tipo: 'ingreso', cantidad: data.cantidad, fecha: data.fecha, observacion: data.observacion || undefined })
      queryClient.invalidateQueries({ queryKey: ['insumos-admin'] })
      queryClient.invalidateQueries({ queryKey: ['insumos'] })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitError(typeof detail === 'string' ? detail : 'Error al registrar la reposición.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <p className="text-sm text-gray-500">
        Stock actual: <span className="font-semibold text-gray-800">{insumo.stock_actual} {insumo.unidad}</span>
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Cantidad a sumar ({insumo.unidad})</label>
          <input type="number" step="0.01" min="0" {...register('cantidad')} className={field} placeholder="0.00" autoFocus />
          {errors.cantidad && <p className={err}>{errors.cantidad.message}</p>}
        </div>
        <div>
          <label className={label}>Fecha</label>
          <input type="date" {...register('fecha')} className={field} />
          {errors.fecha && <p className={err}>{errors.fecha.message}</p>}
        </div>
      </div>
      <div>
        <label className={label}>Observación (opcional)</label>
        <input type="text" {...register('observacion')} className={field} placeholder="Ej: Compra a proveedor X" />
      </div>

      {submitError && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{submitError}</p>
      )}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 transition-colors">
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Registrar reposición
        </button>
      </div>
    </form>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InsumosAdminPage() {
  const [estadoFilter, setEstadoFilter] = useState<'activos' | 'todos'>('activos')
  const [modal, setModal] = useState<'create' | { edit: InsumoResponse } | { reponer: InsumoResponse } | null>(null)
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.user)
  const isEncargadoUp = ['super_admin', 'gerencial', 'encargado', 'regador'].includes(currentUser?.role ?? '')

  const { data: insumos = [], isLoading } = useQuery({
    queryKey: ['insumos-admin'],
    queryFn: () => getInsumos(),
  })

  const filtered = estadoFilter === 'activos' ? insumos.filter((i) => i.is_active) : insumos

  async function handleDeactivate(i: InsumoResponse) {
    if (!window.confirm(`¿Desactivar "${i.nombre}"? Deja de aparecer como sugerencia al cargar Fitosanitarios.`)) return
    try {
      await updateInsumo(i.id, { is_active: false })
      queryClient.invalidateQueries({ queryKey: ['insumos-admin'] })
      queryClient.invalidateQueries({ queryKey: ['insumos'] })
    } catch {
      alert('Error al desactivar el insumo.')
    }
  }

  async function handleReactivate(i: InsumoResponse) {
    try {
      await updateInsumo(i.id, { is_active: true })
      queryClient.invalidateQueries({ queryKey: ['insumos-admin'] })
      queryClient.invalidateQueries({ queryKey: ['insumos'] })
    } catch {
      alert('Error al reactivar el insumo.')
    }
  }

  const activos = insumos.filter((i) => i.is_active).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Insumos</h1>
          <p className="text-sm text-gray-500 mt-1">
            {activos} activos de {insumos.length} en total · catálogo y stock usado en Fitosanitarios
          </p>
        </div>
        {isEncargadoUp && (
          <button
            onClick={() => setModal('create')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={16} />
            Nuevo insumo
          </button>
        )}
      </div>

      <div className="flex gap-2">
        {(['activos', 'todos'] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setEstadoFilter(opt)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              estadoFilter === opt
                ? 'bg-[#7a1f2c] text-white'
                : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {opt === 'activos' ? 'Activos' : 'Todos'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Categoría</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Stock actual</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                {isEncargadoUp && (
                  <th className="px-4 py-3 font-medium text-gray-600 text-center">Acciones</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: isEncargadoUp ? 5 : 4 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={isEncargadoUp ? 5 : 4} className="px-4 py-10 text-center text-gray-400">
                    {estadoFilter === 'activos' ? 'No hay insumos activos' : 'No hay insumos cargados'}
                  </td>
                </tr>
              ) : (
                filtered.map((i) => (
                  <tr key={i.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{i.nombre}</td>
                    <td className="px-4 py-3 text-gray-600">{i.categoria ?? '—'}</td>
                    <td className={`px-4 py-3 text-right font-mono whitespace-nowrap ${i.stock_actual < 0 ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                      {i.stock_actual} {i.unidad}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        i.is_active ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-100 text-gray-500 border border-gray-200'
                      }`}>
                        {i.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    {isEncargadoUp && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setModal({ reponer: i })}
                            title="Registrar reposición"
                            className="p-1.5 rounded-md text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                          >
                            <PackagePlus size={15} />
                          </button>
                          <button
                            onClick={() => setModal({ edit: i })}
                            title="Editar"
                            className="p-1.5 rounded-md text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                          >
                            <Pencil size={15} />
                          </button>
                          {i.is_active ? (
                            <button
                              onClick={() => handleDeactivate(i)}
                              title="Desactivar"
                              className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleReactivate(i)}
                              title="Reactivar"
                              className="p-1.5 rounded-md text-gray-400 hover:text-green-700 hover:bg-green-50 transition-colors"
                            >
                              <RotateCcw size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!isLoading && filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-400">
            {filtered.length} insumo{filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {modal === 'create' && (
        <Modal title="Nuevo insumo" onClose={() => setModal(null)}>
          <InsumoForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />
        </Modal>
      )}

      {modal !== null && modal !== 'create' && 'edit' in modal && (
        <Modal title="Editar insumo" onClose={() => setModal(null)}>
          <InsumoForm insumo={modal.edit} onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />
        </Modal>
      )}

      {modal !== null && modal !== 'create' && 'reponer' in modal && (
        <Modal title={`Reponer stock — ${modal.reponer.nombre}`} onClose={() => setModal(null)}>
          <ReposicionForm insumo={modal.reponer} onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </div>
  )
}
