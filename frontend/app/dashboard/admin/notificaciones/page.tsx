'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Send, Loader2, BellRing } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { listUsers, ROLE_LABELS, type UserResponse } from '@/lib/api/usuarios'
import { enviarNotificacion } from '@/lib/api/notificaciones'
import { useAuthStore } from '@/store/authStore'

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err   = 'mt-1 text-xs text-red-600'

const schema = z.object({
  titulo: z.string().min(1, 'Requerido').max(100, 'Máximo 100 caracteres'),
  cuerpo: z.string().min(1, 'Requerido').max(300, 'Máximo 300 caracteres'),
})

type FormData = z.infer<typeof schema>

export default function NotificacionesPage() {
  const currentUser = useAuthStore((s) => s.user)
  const isSuperAdmin = currentUser?.role === 'super_admin'

  const [destino, setDestino] = useState<'todos' | 'especificos'>('todos')
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [resultado, setResultado] = useState<{ enviados: number } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  const { data: usuarios = [] } = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
    enabled: isSuperAdmin && destino === 'especificos',
  })

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: { titulo: '', cuerpo: '' },
  })

  const tituloW = watch('titulo')
  const cuerpoW = watch('cuerpo')

  function toggleUsuario(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function onSubmit(data: FormData) {
    setSendError(null)
    setResultado(null)
    if (destino === 'especificos' && seleccionados.size === 0) {
      setSendError('Elegí al menos un usuario destinatario.')
      return
    }
    try {
      const res = await enviarNotificacion({
        titulo: data.titulo,
        cuerpo: data.cuerpo,
        user_ids: destino === 'especificos' ? Array.from(seleccionados) : undefined,
      })
      setResultado({ enviados: res.enviados })
      reset()
      setSeleccionados(new Set())
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      if (status === 404) {
        setSendError('Nadie tiene la app mobile con notificaciones habilitadas todavía (sin tokens registrados).')
      } else {
        setSendError(typeof detail === 'string' ? detail : 'Error al enviar la notificación.')
      }
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Notificaciones</h1>
        <p className="text-sm text-gray-500 mt-1">
          Envía un push a la app mobile de los usuarios que la tengan instalada con notificaciones habilitadas.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 space-y-4">
        <div>
          <label className={label}>Destinatarios</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDestino('todos')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                destino === 'todos' ? 'bg-[#7a1f2c] text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              Todos los usuarios
            </button>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => setDestino('especificos')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  destino === 'especificos' ? 'bg-[#7a1f2c] text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                Usuarios específicos
              </button>
            )}
          </div>
        </div>

        {destino === 'especificos' && (
          <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-56 overflow-y-auto">
            {usuarios.length === 0 ? (
              <p className="px-3 py-3 text-sm text-gray-400">Cargando usuarios…</p>
            ) : (
              usuarios.map((u: UserResponse) => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={seleccionados.has(u.id)}
                    onChange={() => toggleUsuario(u.id)}
                    className="rounded border-gray-300 text-[#7a1f2c] focus:ring-[#7a1f2c]"
                  />
                  <span className="font-medium text-gray-800">{u.full_name}</span>
                  <span className="text-gray-400">· {ROLE_LABELS[u.role]}</span>
                </label>
              ))
            )}
          </div>
        )}

        <div>
          <label className={label}>Título</label>
          <input type="text" placeholder="Ej: Corte de agua mañana" {...register('titulo')} className={field} maxLength={100} />
          {errors.titulo && <p className={err}>{errors.titulo.message}</p>}
          <p className="text-xs text-gray-400 mt-1 text-right">{tituloW?.length ?? 0}/100</p>
        </div>

        <div>
          <label className={label}>Mensaje</label>
          <textarea rows={3} placeholder="Detalle del aviso..." {...register('cuerpo')} className={field} maxLength={300} />
          {errors.cuerpo && <p className={err}>{errors.cuerpo.message}</p>}
          <p className="text-xs text-gray-400 mt-1 text-right">{cuerpoW?.length ?? 0}/300</p>
        </div>

        {sendError && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{sendError}</p>
        )}
        {resultado && (
          <p className="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-2 rounded-md">
            <BellRing size={14} />
            Enviado a {resultado.enviados} dispositivo{resultado.enviados !== 1 ? 's' : ''}.
          </p>
        )}

        <div className="flex items-center justify-end pt-2 border-t border-gray-100">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 transition-colors"
          >
            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Enviar
          </button>
        </div>
      </form>
    </div>
  )
}
