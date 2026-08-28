'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X, Loader2, ShieldAlert } from 'lucide-react'
import {
  listTelefonosWhatsapp,
  vincularTelefonoWhatsapp,
  desvincularTelefonoWhatsapp,
} from '@/lib/api/telefonosWhatsapp'
import { listUsers, type UserResponse } from '@/lib/api/usuarios'
import { useAuthStore } from '@/store/authStore'

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'

function formatDate(dt: string) {
  return new Date(dt).toLocaleDateString('es-AR')
}

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

function VincularTelefonoForm({ usuarios, onSuccess, onCancel }: {
  usuarios: UserResponse[]
  onSuccess: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [telefono, setTelefono] = useState('')
  const [userId, setUserId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!telefono.trim() || !userId) {
      setError('Completá el teléfono y seleccioná un usuario.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await vincularTelefonoWhatsapp({ telefono: telefono.trim(), user_id: userId })
      queryClient.invalidateQueries({ queryKey: ['telefonos-whatsapp'] })
      onSuccess()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(detail === 'Ese teléfono ya está vinculado a un usuario' ? detail : 'No se pudo vincular el teléfono.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={label}>Teléfono (con código de país, sin +)</label>
        <input
          type="text"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          className={field}
          placeholder="5492610000000"
        />
      </div>
      <div>
        <label className={label}>Usuario</label>
        <select value={userId} onChange={(e) => setUserId(e.target.value)} className={field}>
          <option value="">Seleccionar...</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={submitting} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 transition-colors">
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Vincular
        </button>
      </div>
    </form>
  )
}

export default function WhatsappAdminPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [eliminandoId, setEliminandoId] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.user)
  const isSuperAdmin = currentUser?.role === 'super_admin'

  const { data: telefonos = [], isLoading } = useQuery({
    queryKey: ['telefonos-whatsapp'],
    queryFn: listTelefonosWhatsapp,
  })

  const { data: usuarios = [] } = useQuery({
    queryKey: ['usuarios'],
    queryFn: listUsers,
  })

  function usuarioLabel(userId: string): string {
    const u = usuarios.find((u) => u.id === userId)
    return u ? `${u.full_name} (${u.username})` : userId
  }

  async function handleEliminar(id: string) {
    if (!window.confirm('¿Desvincular este teléfono? Ese número ya no va a poder cargar gastos por WhatsApp.')) return
    setEliminandoId(id)
    try {
      await desvincularTelefonoWhatsapp(id)
      queryClient.invalidateQueries({ queryKey: ['telefonos-whatsapp'] })
    } finally {
      setEliminandoId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WhatsApp</h1>
          <p className="text-sm text-gray-500 mt-1">Números autorizados a cargar gastos por WhatsApp</p>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={16} />
            Vincular teléfono
          </button>
        )}
      </div>

      {!isSuperAdmin && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
          <ShieldAlert size={16} className="flex-shrink-0" />
          Solo el super administrador puede vincular o desvincular teléfonos.
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Teléfono</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Usuario</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Vinculado</th>
                {isSuperAdmin && (
                  <th className="px-4 py-3 font-medium text-gray-600 text-center">Acciones</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: isSuperAdmin ? 4 : 3 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : telefonos.length === 0 ? (
                <tr>
                  <td colSpan={isSuperAdmin ? 4 : 3} className="px-4 py-10 text-center text-gray-400">
                    No hay teléfonos vinculados todavía
                  </td>
                </tr>
              ) : (
                telefonos.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-gray-800 whitespace-nowrap">+{t.telefono}</td>
                    <td className="px-4 py-3 text-gray-600">{usuarioLabel(t.user_id)}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(t.created_at)}</td>
                    {isSuperAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center">
                          <button
                            onClick={() => handleEliminar(t.id)}
                            disabled={eliminandoId === t.id}
                            title="Desvincular"
                            className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
                          >
                            <Trash2 size={15} />
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
        {!isLoading && telefonos.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-400">
            {telefonos.length} teléfono{telefonos.length !== 1 ? 's' : ''} vinculado{telefonos.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {modalOpen && (
        <Modal title="Vincular teléfono" onClose={() => setModalOpen(false)}>
          <VincularTelefonoForm
            usuarios={usuarios}
            onSuccess={() => setModalOpen(false)}
            onCancel={() => setModalOpen(false)}
          />
        </Modal>
      )}
    </div>
  )
}
