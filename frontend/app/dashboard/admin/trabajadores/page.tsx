'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, RotateCcw, X, Loader2 } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  listTrabajadoresAdmin,
  createTrabajadorFull,
  updateTrabajador,
  deactivateTrabajador,
  type TrabajadorResponse,
  type RolTrabajador,
} from '@/lib/api/trabajadores'
import { useAuthStore } from '@/store/authStore'

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err   = 'mt-1 text-xs text-red-600'

const ROL_VALUES: RolTrabajador[] = ['obrero', 'tractorista', 'encargado_cuadrilla', 'otro']
const ROL_LABELS: Record<RolTrabajador, string> = {
  obrero: 'Obrero',
  tractorista: 'Tractorista',
  encargado_cuadrilla: 'Encargado de cuadrilla',
  otro: 'Otro',
}

const schema = z.object({
  nombre_completo: z.string().min(2, 'Mínimo 2 caracteres'),
  rol: z.enum(ROL_VALUES as [RolTrabajador, ...RolTrabajador[]]),
  dni: z.string().optional(),
  telefono: z.string().optional(),
})

type FormData = z.infer<typeof schema>

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

// ── Trabajador form ───────────────────────────────────────────────────────────

function TrabajadorForm({
  trabajador,
  onSuccess,
  onCancel,
}: {
  trabajador?: TrabajadorResponse
  onSuccess: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const isEdit = !!trabajador
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: isEdit
      ? {
          nombre_completo: trabajador.nombre_completo,
          rol: trabajador.rol,
          dni: trabajador.dni ?? '',
          telefono: trabajador.telefono ?? '',
        }
      : { nombre_completo: '', rol: 'obrero', dni: '', telefono: '' },
  })

  async function onSubmit(data: FormData) {
    try {
      setSubmitError(null)
      const payload = {
        nombre_completo: data.nombre_completo,
        rol: data.rol,
        dni: data.dni || undefined,
        telefono: data.telefono || undefined,
      }
      if (isEdit) {
        await updateTrabajador(trabajador.id, payload)
      } else {
        await createTrabajadorFull(payload)
      }
      queryClient.invalidateQueries({ queryKey: ['trabajadores-admin'] })
      queryClient.invalidateQueries({ queryKey: ['trabajadores'] })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitError(typeof detail === 'string' ? detail : 'Error al guardar el trabajador.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className={label}>Nombre completo</label>
        <input type="text" {...register('nombre_completo')} className={field} placeholder="Ej: Juan Pérez" autoFocus />
        {errors.nombre_completo && <p className={err}>{errors.nombre_completo.message}</p>}
      </div>

      <div>
        <label className={label}>Rol</label>
        <select {...register('rol')} className={field}>
          {ROL_VALUES.map((r) => (
            <option key={r} value={r}>{ROL_LABELS[r]}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>DNI (opcional)</label>
          <input type="text" {...register('dni')} className={field} placeholder="Ej: 30123456" />
        </div>
        <div>
          <label className={label}>Teléfono (opcional)</label>
          <input type="text" {...register('telefono')} className={field} placeholder="Ej: 264 123-4567" />
        </div>
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
          {isEdit ? 'Guardar cambios' : 'Crear trabajador'}
        </button>
      </div>
    </form>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TrabajadoresAdminPage() {
  const [estadoFilter, setEstadoFilter] = useState<'activos' | 'todos'>('activos')
  const [modal, setModal] = useState<'create' | { edit: TrabajadorResponse } | null>(null)
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.user)
  const isGerencialUp = currentUser?.role === 'super_admin' || currentUser?.role === 'gerencial'

  const { data: trabajadores = [], isLoading } = useQuery({
    queryKey: ['trabajadores-admin'],
    queryFn: listTrabajadoresAdmin,
  })

  const filtered = estadoFilter === 'activos' ? trabajadores.filter((t) => t.is_active) : trabajadores

  async function handleDeactivate(t: TrabajadorResponse) {
    if (!window.confirm(`¿Desactivar a "${t.nombre_completo}"? Deja de aparecer como sugerencia al cargar tareas/riego/fitosanitarios.`)) return
    try {
      await deactivateTrabajador(t.id)
      queryClient.invalidateQueries({ queryKey: ['trabajadores-admin'] })
      queryClient.invalidateQueries({ queryKey: ['trabajadores'] })
    } catch {
      alert('Error al desactivar el trabajador.')
    }
  }

  async function handleReactivate(t: TrabajadorResponse) {
    try {
      await updateTrabajador(t.id, { is_active: true })
      queryClient.invalidateQueries({ queryKey: ['trabajadores-admin'] })
      queryClient.invalidateQueries({ queryKey: ['trabajadores'] })
    } catch {
      alert('Error al reactivar el trabajador.')
    }
  }

  const activos = trabajadores.filter((t) => t.is_active).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trabajadores</h1>
          <p className="text-sm text-gray-500 mt-1">
            {activos} activos de {trabajadores.length} en total · catálogo usado por las sugerencias de Tareas, Riego y Fitosanitarios
          </p>
        </div>
        {isGerencialUp && (
          <button
            onClick={() => setModal('create')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={16} />
            Nuevo trabajador
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
                <th className="text-left px-4 py-3 font-medium text-gray-600">Rol</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">DNI</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Teléfono</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ID</th>
                {isGerencialUp && (
                  <th className="px-4 py-3 font-medium text-gray-600 text-center">Acciones</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: isGerencialUp ? 7 : 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={isGerencialUp ? 7 : 6} className="px-4 py-10 text-center text-gray-400">
                    {estadoFilter === 'activos' ? 'No hay trabajadores activos' : 'No hay trabajadores cargados'}
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{t.nombre_completo}</td>
                    <td className="px-4 py-3 text-gray-600">{ROL_LABELS[t.rol]}</td>
                    <td className="px-4 py-3 text-gray-600">{t.dni ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{t.telefono ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        t.is_active ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-gray-100 text-gray-500 border border-gray-200'
                      }`}>
                        {t.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 font-mono text-xs whitespace-nowrap" title={t.id}>
                      {t.id.slice(0, 8)}…
                    </td>
                    {isGerencialUp && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setModal({ edit: t })}
                            title="Editar"
                            className="p-1.5 rounded-md text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                          >
                            <Pencil size={15} />
                          </button>
                          {t.is_active ? (
                            <button
                              onClick={() => handleDeactivate(t)}
                              title="Desactivar"
                              className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleReactivate(t)}
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
            {filtered.length} trabajador{filtered.length !== 1 ? 'es' : ''}
          </div>
        )}
      </div>

      {modal === 'create' && (
        <Modal title="Nuevo trabajador" onClose={() => setModal(null)}>
          <TrabajadorForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />
        </Modal>
      )}

      {modal !== null && modal !== 'create' && (
        <Modal title="Editar trabajador" onClose={() => setModal(null)}>
          <TrabajadorForm
            trabajador={modal.edit}
            onSuccess={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  )
}
