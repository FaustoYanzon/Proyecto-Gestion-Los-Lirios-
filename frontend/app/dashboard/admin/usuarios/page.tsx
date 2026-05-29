'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, X, Loader2, ShieldAlert } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  listUsers,
  createUser,
  updateUser,
  ROLE_VALUES,
  ROLE_LABELS,
  type UserResponse,
  type UserRole,
} from '@/lib/api/usuarios'
import { useAuthStore } from '@/store/authStore'

const ROLE_BADGE: Record<UserRole, string> = {
  super_admin: 'bg-purple-50 text-purple-700',
  gerencial:   'bg-blue-50 text-blue-700',
  encargado:   'bg-green-50 text-green-700',
  regador:     'bg-cyan-50 text-cyan-700',
  obrero:      'bg-gray-100 text-gray-600',
}

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err   = 'mt-1 text-xs text-red-600'

const createSchema = z.object({
  email:     z.string().email('Email inválido'),
  full_name: z.string().min(2, 'Mínimo 2 caracteres'),
  role:      z.enum(ROLE_VALUES),
  password:  z.string().min(8, 'Mínimo 8 caracteres'),
})

const editSchema = z.object({
  full_name: z.string().min(2, 'Mínimo 2 caracteres'),
  role:      z.enum(ROLE_VALUES),
  is_active: z.boolean(),
  password:  z.union([z.string().min(8, 'Mínimo 8 caracteres'), z.literal('')]),
})

type CreateData = z.infer<typeof createSchema>
type EditData   = z.infer<typeof editSchema>

function formatDate(dt: string) {
  return new Date(dt).toLocaleDateString('es-AR')
}

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

function CreateUserForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateData>({
    resolver: zodResolver(createSchema) as Resolver<CreateData>,
    defaultValues: { email: '', full_name: '', role: 'obrero', password: '' },
  })

  async function onSubmit(data: CreateData) {
    try {
      setSubmitError(null)
      await createUser(data)
      queryClient.invalidateQueries({ queryKey: ['usuarios'] })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitError(detail === 'Email already registered' ? 'Ya existe un usuario con ese email.' : 'Error al crear el usuario.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className={label}>Nombre completo</label>
        <input type="text" {...register('full_name')} className={field} placeholder="Juan Pérez" />
        {errors.full_name && <p className={err}>{errors.full_name.message}</p>}
      </div>
      <div>
        <label className={label}>Email</label>
        <input type="email" {...register('email')} className={field} placeholder="usuario@loslirios.com" />
        {errors.email && <p className={err}>{errors.email.message}</p>}
      </div>
      <div>
        <label className={label}>Rol</label>
        <select {...register('role')} className={field}>
          {ROLE_VALUES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>
      <div>
        <label className={label}>Contraseña</label>
        <input type="password" {...register('password')} className={field} placeholder="Mínimo 8 caracteres" />
        {errors.password && <p className={err}>{errors.password.message}</p>}
      </div>
      {submitError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{submitError}</p>}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 transition-colors">
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Crear usuario
        </button>
      </div>
    </form>
  )
}

// ── Edit form ─────────────────────────────────────────────────────────────────

function EditUserForm({ user, onSuccess, onCancel }: { user: UserResponse; onSuccess: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<EditData>({
    resolver: zodResolver(editSchema) as Resolver<EditData>,
    defaultValues: {
      full_name: user.full_name,
      role:      user.role,
      is_active: user.is_active,
      password:  '',
    },
  })

  async function onSubmit(data: EditData) {
    try {
      setSubmitError(null)
      const payload: Parameters<typeof updateUser>[1] = {
        full_name: data.full_name,
        role:      data.role,
        is_active: data.is_active,
      }
      if (data.password) payload.password = data.password
      await updateUser(user.id, payload)
      queryClient.invalidateQueries({ queryKey: ['usuarios'] })
      onSuccess()
    } catch {
      setSubmitError('Error al guardar los cambios.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className={label}>Nombre completo</label>
        <input type="text" {...register('full_name')} className={field} />
        {errors.full_name && <p className={err}>{errors.full_name.message}</p>}
      </div>
      <div className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
        <span className="font-medium text-gray-700">Email: </span>{user.email}
      </div>
      <div>
        <label className={label}>Rol</label>
        <select {...register('role')} className={field}>
          {ROLE_VALUES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>
      <div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" {...register('is_active')} className="rounded border-gray-300 text-[#7a1f2c] focus:ring-[#7a1f2c]" />
          <span className="text-sm font-medium text-gray-700">Usuario activo</span>
        </label>
      </div>
      <div>
        <label className={label}>
          Nueva contraseña{' '}
          <span className="font-normal text-gray-400">(dejar vacío para no cambiar)</span>
        </label>
        <input type="password" {...register('password')} className={field} placeholder="Mínimo 8 caracteres" />
        {errors.password && <p className={err}>{errors.password.message}</p>}
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

export default function UsuariosPage() {
  const [modal, setModal] = useState<'create' | { edit: UserResponse } | null>(null)
  const currentUser = useAuthStore((s) => s.user)
  const isSuperAdmin = currentUser?.role === 'super_admin'

  const { data: usuarios = [], isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn: listUsers,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
          <p className="text-sm text-gray-500 mt-1">Gestión de acceso al sistema</p>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => setModal('create')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={16} />
            Nuevo usuario
          </button>
        )}
      </div>

      {!isSuperAdmin && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
          <ShieldAlert size={16} className="flex-shrink-0" />
          Solo el super administrador puede crear o modificar usuarios.
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Rol</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Alta</th>
                {isSuperAdmin && (
                  <th className="px-4 py-3 font-medium text-gray-600 text-center">Acciones</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: isSuperAdmin ? 6 : 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : usuarios.length === 0 ? (
                <tr>
                  <td colSpan={isSuperAdmin ? 6 : 5} className="px-4 py-10 text-center text-gray-400">
                    No hay usuarios registrados
                  </td>
                </tr>
              ) : (
                usuarios.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{u.full_name}</td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_BADGE[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${u.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {u.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(u.created_at)}</td>
                    {isSuperAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center">
                          <button
                            onClick={() => setModal({ edit: u })}
                            title="Editar"
                            className="p-1.5 rounded-md text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                          >
                            <Pencil size={15} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!isLoading && usuarios.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-400">
            {usuarios.length} usuario{usuarios.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {modal === 'create' && (
        <Modal title="Nuevo usuario" onClose={() => setModal(null)}>
          <CreateUserForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />
        </Modal>
      )}

      {modal !== null && modal !== 'create' && (
        <Modal title="Editar usuario" onClose={() => setModal(null)}>
          <EditUserForm user={modal.edit} onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />
        </Modal>
      )}
    </div>
  )
}
