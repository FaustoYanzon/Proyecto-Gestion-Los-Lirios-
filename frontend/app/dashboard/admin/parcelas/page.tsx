'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, Loader2 } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  listParcelasAdmin,
  createParcela,
  updateParcela,
  deactivateParcela,
  TIPO_PARCELA_VALUES,
  VARIEDAD_VALUES,
  TIPO_LABELS,
  TIPO_BADGE,
  VARIEDAD_LABELS,
  type ParcelaAdminResponse,
  type TipoParcela,
  type VariedadUva,
} from '@/lib/api/parcelas'
import { useAuthStore } from '@/store/authStore'

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err   = 'mt-1 text-xs text-red-600'

const schema = z.object({
  nombre:       z.string().min(2, 'Mínimo 2 caracteres'),
  tipo:         z.enum(TIPO_PARCELA_VALUES),
  variedad:     z.string().optional(),
  superficie_ha: z.preprocess(
    (v) => (!v || v === '' ? undefined : Number(v)),
    z.number().positive('Debe ser mayor a 0').optional()
  ),
  cabezal_riego: z.string().optional(),
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

// ── Parcela form ──────────────────────────────────────────────────────────────

function ParcelaForm({
  parcela,
  onSuccess,
  onCancel,
}: {
  parcela?: ParcelaAdminResponse
  onSuccess: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const isEdit = !!parcela
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: isEdit
      ? {
          nombre:        parcela.nombre,
          tipo:          parcela.tipo,
          variedad:      parcela.variedad ?? '',
          superficie_ha: parcela.superficie_ha ?? undefined,
          cabezal_riego: parcela.cabezal_riego ?? '',
        }
      : { nombre: '', tipo: 'parral', variedad: '', superficie_ha: undefined, cabezal_riego: '' },
  })

  const tipoW = watch('tipo')

  async function onSubmit(data: FormData) {
    try {
      setSubmitError(null)
      const payload = {
        nombre:        data.nombre,
        tipo:          data.tipo,
        variedad:      (data.variedad || undefined) as VariedadUva | undefined,
        superficie_ha: data.superficie_ha,
        cabezal_riego: data.cabezal_riego || undefined,
      }
      if (isEdit) {
        await updateParcela(parcela.id, payload)
      } else {
        await createParcela(payload)
      }
      queryClient.invalidateQueries({ queryKey: ['parcelas-admin'] })
      queryClient.invalidateQueries({ queryKey: ['parcelas'] })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitError(typeof detail === 'string' ? detail : 'Error al guardar la parcela.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className={label}>Nombre</label>
        <input type="text" {...register('nombre')} className={field} placeholder="Ej: Parral 12, Potrero 3" />
        {errors.nombre && <p className={err}>{errors.nombre.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Tipo</label>
          <select {...register('tipo')} className={field}>
            {TIPO_PARCELA_VALUES.map((t) => (
              <option key={t} value={t}>{TIPO_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Variedad</label>
          <select {...register('variedad')} className={field} disabled={tipoW !== 'parral'}>
            <option value="">— Sin variedad —</option>
            {VARIEDAD_VALUES.map((v) => (
              <option key={v} value={v}>{VARIEDAD_LABELS[v]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Superficie (ha)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            {...register('superficie_ha')}
            className={field}
          />
          {errors.superficie_ha && <p className={err}>{errors.superficie_ha.message}</p>}
        </div>
        <div>
          <label className={label}>Cabezal de riego</label>
          <input
            type="text"
            {...register('cabezal_riego')}
            className={field}
            placeholder="Ej: A, B, MANTO"
            disabled={tipoW === 'cabezal'}
          />
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
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-60 transition-colors"
        >
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? 'Guardar cambios' : 'Crear parcela'}
        </button>
      </div>
    </form>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TIPO_FILTER_OPTIONS: Array<{ value: TipoParcela | ''; label: string }> = [
  { value: '', label: 'Todos los tipos' },
  { value: 'parral', label: 'Parrales' },
  { value: 'potrero', label: 'Potreros' },
  { value: 'pasero', label: 'Paseros' },
  { value: 'cabezal', label: 'Cabezales' },
]

export default function ParcelasPage() {
  const [tipoFilter, setTipoFilter] = useState<TipoParcela | ''>('')
  const [modal, setModal] = useState<'create' | { edit: ParcelaAdminResponse } | null>(null)
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((s) => s.user)
  const isSuperAdmin = currentUser?.role === 'super_admin'

  const { data: parcelas = [], isLoading } = useQuery({
    queryKey: ['parcelas-admin'],
    queryFn: listParcelasAdmin,
  })

  const filtered = tipoFilter ? parcelas.filter((p) => p.tipo === tipoFilter) : parcelas

  async function handleDeactivate(p: ParcelaAdminResponse) {
    if (!window.confirm(`¿Desactivar la parcela "${p.nombre}"? Quedará oculta en todos los módulos.`)) return
    try {
      await deactivateParcela(p.id)
      queryClient.invalidateQueries({ queryKey: ['parcelas-admin'] })
      queryClient.invalidateQueries({ queryKey: ['parcelas'] })
    } catch {
      alert('Error al desactivar la parcela.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Parcelas</h1>
          <p className="text-sm text-gray-500 mt-1">{parcelas.length} parcelas activas en el sistema</p>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => setModal('create')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 transition-colors"
          >
            <Plus size={16} />
            Nueva parcela
          </button>
        )}
      </div>

      {/* Tipo filter chips */}
      <div className="flex gap-2 flex-wrap">
        {TIPO_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setTipoFilter(opt.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tipoFilter === opt.value
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Variedad</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Sup. (ha)</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Cabezal</th>
                {isSuperAdmin && (
                  <th className="px-4 py-3 font-medium text-gray-600 text-center">Acciones</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: isSuperAdmin ? 6 : 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={isSuperAdmin ? 6 : 5} className="px-4 py-10 text-center text-gray-400">
                    {tipoFilter ? `No hay parcelas de tipo "${TIPO_LABELS[tipoFilter as TipoParcela]}"` : 'No hay parcelas activas'}
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{p.nombre}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TIPO_BADGE[p.tipo] ?? 'bg-gray-100 text-gray-600'}`}>
                        {TIPO_LABELS[p.tipo]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {p.variedad ? (VARIEDAD_LABELS[p.variedad] ?? p.variedad) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700">
                      {p.superficie_ha != null ? p.superficie_ha.toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {p.cabezal_riego ?? '—'}
                    </td>
                    {isSuperAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setModal({ edit: p })}
                            title="Editar"
                            className="p-1.5 rounded-md text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            onClick={() => handleDeactivate(p)}
                            title="Desactivar"
                            className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
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
        {!isLoading && filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-400">
            {filtered.length} parcela{filtered.length !== 1 ? 's' : ''}
            {tipoFilter ? ` de tipo ${TIPO_LABELS[tipoFilter as TipoParcela]}` : ''}
          </div>
        )}
      </div>

      {modal === 'create' && (
        <Modal title="Nueva parcela" onClose={() => setModal(null)}>
          <ParcelaForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />
        </Modal>
      )}

      {modal !== null && modal !== 'create' && (
        <Modal title="Editar parcela" onClose={() => setModal(null)}>
          <ParcelaForm
            parcela={modal.edit}
            onSuccess={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  )
}
