'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { usePaginatedList } from '@/lib/usePaginatedList'
import { getParcelas } from '@/lib/api/produccion'
import { getUbicacionesPasero, createUbicacionPasero, errorDetail } from '@/lib/api/altaProduccion'
import FormError from '@/components/ui/FormError'

const PAGE_SIZE = 10

const schema = z.object({
  pasero_id: z.string().min(1, 'Elegí un pasero'),
  hilera: z.coerce.number().int('Debe ser entero').positive('Debe ser mayor a 0'),
  parte: z.coerce.number().int('Debe ser entero').positive('Debe ser mayor a 0'),
})
type FormValues = z.infer<typeof schema>

const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'
const thCls = 'text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide'

export default function UbicacionesPage() {
  const qc = useQueryClient()
  const [paseroFiltro, setPaseroFiltro] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const { data: parcelas = [] } = useQuery({ queryKey: ['parcelas'], queryFn: getParcelas, staleTime: 300_000 })
  const paseros = parcelas.filter((p) => p.tipo === 'pasero' && p.is_active)
  const nombrePasero = (id: string) => parcelas.find((p) => p.id === id)?.nombre ?? '–'

  const { data: ubicaciones = [], isLoading, error: loadError } = useQuery({
    queryKey: ['ap-ubicaciones', paseroFiltro],
    queryFn: () => getUbicacionesPasero(paseroFiltro || undefined),
    staleTime: 60_000,
  })
  const { page, setPage, totalPages, paged } = usePaginatedList(ubicaciones, PAGE_SIZE)

  const {
    register, handleSubmit, reset, formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: { pasero_id: '' },
  })

  function openCreate() {
    reset({ pasero_id: paseroFiltro, hilera: undefined, parte: undefined })
    setApiError(null)
    setShowModal(true)
  }

  async function onSubmit(v: FormValues) {
    setApiError(null)
    try {
      await createUbicacionPasero(v)
      await qc.invalidateQueries({ queryKey: ['ap-ubicaciones'] })
      setShowModal(false)
    } catch (e) {
      setApiError(errorDetail(e))
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Ubicaciones del pasero</h1>
          <p className="text-sm text-gray-500 mt-0.5">Hilera y parte donde se descarga la uva</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={paseroFiltro}
            onChange={(e) => setPaseroFiltro(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]"
          >
            <option value="">Todos los paseros</option>
            {paseros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-[#7a1f2c] text-white text-sm font-semibold rounded-lg hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={16} /> Nueva ubicación
          </button>
        </div>
      </div>

      {loadError && <FormError description={errorDetail(loadError, 'No se pudo cargar el listado')} />}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Ubicaciones</h3>
          <span className="text-xs text-gray-400">{ubicaciones.length} registros</span>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : ubicaciones.length === 0 ? (
          <p className="px-5 py-10 text-center text-gray-400 text-sm">No hay ubicaciones cargadas</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls}>Pasero</th>
                  <th className={`${thCls} text-right`}>Hilera</th>
                  <th className={`${thCls} text-right`}>Parte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paged.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-900">{nombrePasero(u.pasero_id)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{u.hilera}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{u.parte}</td>
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
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, ubicaciones.length)} de {ubicaciones.length}
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
          <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Nueva ubicación</h2>
              <button type="button" onClick={() => setShowModal(false)} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className={labelCls}>Pasero <span className="text-red-500">*</span></label>
                <select {...register('pasero_id')} className={inputCls}>
                  <option value="">— Seleccionar —</option>
                  {paseros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                {errors.pasero_id && <p className="mt-1 text-xs text-red-600">{errors.pasero_id.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Hilera <span className="text-red-500">*</span></label>
                  <input type="number" min={1} step={1} {...register('hilera')} className={inputCls} />
                  {errors.hilera && <p className="mt-1 text-xs text-red-600">{errors.hilera.message}</p>}
                </div>
                <div>
                  <label className={labelCls}>Parte <span className="text-red-500">*</span></label>
                  <input type="number" min={1} step={1} {...register('parte')} className={inputCls} />
                  {errors.parte && <p className="mt-1 text-xs text-red-600">{errors.parte.message}</p>}
                </div>
              </div>
              {apiError && <FormError description={apiError} />}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-[#7a1f2c] text-white rounded-lg text-sm font-semibold hover:bg-[#5a1320] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {isSubmitting ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
