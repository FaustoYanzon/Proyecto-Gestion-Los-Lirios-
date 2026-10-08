'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, X, ChevronLeft, ChevronRight, Power } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { usePaginatedList } from '@/lib/usePaginatedList'
import { useAuthStore } from '@/store/authStore'
import {
  errorDetail, TIPO_PRODUCTOR_LABELS,
  type TipoProductor,
} from '@/lib/api/altaProduccion'
import FormError from '@/components/ui/FormError'

const PAGE_SIZE = 10

export interface MaestroItem {
  id: string
  nombre: string
  tipo?: TipoProductor
  cuit?: string | null
  contacto?: string | null
  is_active: boolean
}

export interface MaestroFormValues {
  nombre: string
  tipo?: TipoProductor
  cuit?: string | null
  contacto?: string | null
}

interface Props {
  titulo: string
  singular: string
  queryKey: string
  /** Muestra el selector propio/externo (solo productores). */
  conTipo?: boolean
  /** Muestra CUIT y contacto (productores y compradores). */
  conContacto?: boolean
  fetchAll: () => Promise<MaestroItem[]>
  onCreate: (v: MaestroFormValues) => Promise<unknown>
  onUpdate: (id: string, v: Partial<MaestroFormValues> & { is_active?: boolean }) => Promise<unknown>
}

const schema = z.object({
  nombre: z.string().trim().min(1, 'Requerido').max(150, 'Máximo 150 caracteres'),
  tipo: z.enum(['propio', 'externo']).optional(),
  cuit: z.string().nullish(),
  contacto: z.string().nullish(),
})

const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'
const thCls = 'text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide'

type Filtro = 'activos' | 'inactivos' | 'todos'

export default function MaestroCrud({
  titulo, singular, queryKey, conTipo, conContacto, fetchAll, onCreate, onUpdate,
}: Props) {
  const qc = useQueryClient()
  const role = useAuthStore((s) => s.user?.role)
  // El backend exige gerencial+ para editar/activar; encargado solo crea.
  const puedeEditar = role === 'super_admin' || role === 'gerencial'

  const [filtro, setFiltro] = useState<Filtro>('activos')
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState<MaestroItem | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  const { data: items = [], isLoading, error: loadError } = useQuery({
    queryKey: [queryKey],
    queryFn: fetchAll,
    staleTime: 60_000,
  })

  // Memoizado: usePaginatedList resetea la página cuando cambia la identidad
  // del array, y un filter() nuevo en cada render la haría cambiar siempre.
  const visibles = useMemo(
    () => items.filter((i) =>
      filtro === 'todos' ? true : filtro === 'activos' ? i.is_active : !i.is_active,
    ),
    [items, filtro],
  )
  const { page, setPage, totalPages, paged } = usePaginatedList(visibles, PAGE_SIZE)

  const {
    register, handleSubmit, reset, formState: { errors, isSubmitting },
  } = useForm<MaestroFormValues>({
    resolver: zodResolver(schema) as Resolver<MaestroFormValues>,
    defaultValues: { nombre: '', tipo: 'externo', cuit: '', contacto: '' },
  })

  function openCreate() {
    reset({ nombre: '', tipo: 'externo', cuit: '', contacto: '' })
    setEditItem(null)
    setApiError(null)
    setShowModal(true)
  }

  function openEdit(item: MaestroItem) {
    reset({
      nombre: item.nombre, tipo: item.tipo ?? 'externo',
      cuit: item.cuit ?? '', contacto: item.contacto ?? '',
    })
    setEditItem(item)
    setApiError(null)
    setShowModal(true)
  }

  async function onSubmit(v: MaestroFormValues) {
    setApiError(null)
    const payload: MaestroFormValues = { nombre: v.nombre.trim() }
    if (conTipo) payload.tipo = v.tipo
    if (conContacto) {
      // Vacío => null: al editar permite borrar CUIT/contacto; al crear equivale a omitirlo.
      payload.cuit = v.cuit?.trim() || null
      payload.contacto = v.contacto?.trim() || null
    }
    try {
      if (editItem) {
        await onUpdate(editItem.id, payload)
      } else {
        await onCreate(payload)
      }
      await qc.invalidateQueries({ queryKey: [queryKey] })
      setShowModal(false)
    } catch (e) {
      setApiError(errorDetail(e))
    }
  }

  async function toggleActivo(item: MaestroItem) {
    try {
      await onUpdate(item.id, { is_active: !item.is_active })
      await qc.invalidateQueries({ queryKey: [queryKey] })
    } catch (e) {
      window.alert(errorDetail(e))
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{titulo}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Alta de producción · maestros</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as Filtro)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]"
          >
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
            <option value="todos">Todos</option>
          </select>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-[#7a1f2c] text-white text-sm font-semibold rounded-lg hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={16} /> Nuevo {singular}
          </button>
        </div>
      </div>

      {loadError && <FormError description={errorDetail(loadError, 'No se pudo cargar el listado')} />}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">{titulo}</h3>
          <span className="text-xs text-gray-400">{visibles.length} registros</span>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : visibles.length === 0 ? (
          <p className="px-5 py-10 text-center text-gray-400 text-sm">No hay registros para mostrar</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls}>Nombre</th>
                  {conTipo && <th className={thCls}>Tipo</th>}
                  {conContacto && <th className={thCls}>CUIT</th>}
                  {conContacto && <th className={thCls}>Contacto</th>}
                  <th className={thCls}>Estado</th>
                  {puedeEditar && <th className={`${thCls} text-right`}>Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paged.map((i) => (
                  <tr key={i.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-900 font-medium">{i.nombre}</td>
                    {conTipo && (
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                          i.tipo === 'propio' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                        }`}>
                          {i.tipo ? TIPO_PRODUCTOR_LABELS[i.tipo] : '–'}
                        </span>
                      </td>
                    )}
                    {conContacto && <td className="px-4 py-2.5 text-gray-600">{i.cuit ?? '–'}</td>}
                    {conContacto && <td className="px-4 py-2.5 text-gray-600">{i.contacto ?? '–'}</td>}
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                        i.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {i.is_active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    {puedeEditar && (
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(i)}
                            title="Editar"
                            className="p-1.5 rounded text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => toggleActivo(i)}
                            title={i.is_active ? 'Desactivar' : 'Activar'}
                            className={`p-1.5 rounded text-gray-400 transition-colors ${
                              i.is_active ? 'hover:text-red-600 hover:bg-red-50' : 'hover:text-green-700 hover:bg-green-50'
                            }`}
                          >
                            <Power size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && totalPages > 1 && (
          <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="text-xs text-gray-500">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visibles.length)} de {visibles.length}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900">
                {editItem ? `Editar ${singular}` : `Nuevo ${singular}`}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className={labelCls}>Nombre <span className="text-red-500">*</span></label>
                <input type="text" {...register('nombre')} className={inputCls} />
                {errors.nombre && <p className="mt-1 text-xs text-red-600">{errors.nombre.message}</p>}
              </div>
              {conTipo && (
                <div>
                  <label className={labelCls}>Tipo</label>
                  <select {...register('tipo')} className={inputCls}>
                    {(Object.entries(TIPO_PRODUCTOR_LABELS) as [TipoProductor, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              )}
              {conContacto && (
                <>
                  <div>
                    <label className={labelCls}>CUIT</label>
                    <input type="text" {...register('cuit')} placeholder="20-12345678-9" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Contacto</label>
                    <input type="text" {...register('contacto')} placeholder="Teléfono, mail o persona" className={inputCls} />
                  </div>
                </>
              )}
              {apiError && <FormError description={apiError} />}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 bg-[#7a1f2c] text-white rounded-lg text-sm font-semibold hover:bg-[#5a1320] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
