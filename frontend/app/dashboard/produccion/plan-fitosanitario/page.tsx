'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Plus, Pencil, Trash2, X, Loader2 } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  getPlanFitosanitario,
  createPlanFitosanitario,
  updatePlanFitosanitario,
  deletePlanFitosanitario,
  type PlanFitosanitario,
} from '@/lib/api/planFitosanitario'
import { getParcelas, VARIEDAD_LABELS } from '@/lib/api/produccion'
import InsumoSelect from '@/components/produccion/InsumoSelect'
import type { InsumoResponse } from '@/lib/api/insumos'
import { useContextStore, campanaToAnio } from '@/store/contextStore'
import { useAuthStore } from '@/store/authStore'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const AVAILABLE_YEARS = [DEFAULT_YEAR - 1, DEFAULT_YEAR, DEFAULT_YEAR + 1]

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err = 'mt-1 text-xs text-red-600'

const schema = z.object({
  numero_aplicacion: z.coerce.number().int().min(1, 'Mínimo 1'),
  mes: z.coerce.number().int().min(1).max(12),
  insumo_id: z.string().min(1, 'Elegí un insumo de la lista'),
  objetivo: z.string().min(1, 'Requerido'),
  dosis_por_ha: z.coerce.number().positive('Debe ser mayor a 0'),
  notas: z.string().optional(),
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

// ── Form ──────────────────────────────────────────────────────────────────────

function PlanForm({
  plan,
  temporada,
  variedadesDisponibles,
  variedadActiva,
  onSuccess,
  onCancel,
}: {
  plan?: PlanFitosanitario
  temporada: number
  variedadesDisponibles: string[]
  variedadActiva: string
  onSuccess: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const isEdit = !!plan
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [insumoNombre, setInsumoNombre] = useState(plan?.insumo_nombre ?? '')
  const [insumoInfo, setInsumoInfo] = useState<InsumoResponse | null>(null)
  const [variedadesSeleccionadas, setVariedadesSeleccionadas] = useState<string[]>(
    isEdit ? [] : [variedadActiva]
  )
  const [variedadEdit, setVariedadEdit] = useState(plan?.variedad ?? variedadActiva)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema) as Resolver<FormData>,
    defaultValues: isEdit
      ? {
          numero_aplicacion: plan.numero_aplicacion,
          mes: plan.mes,
          insumo_id: plan.insumo_id,
          objetivo: plan.objetivo,
          dosis_por_ha: plan.dosis_por_ha,
          notas: plan.notas ?? '',
        }
      : { numero_aplicacion: 1, mes: now.getMonth() + 1, insumo_id: '', objetivo: '', notas: '' },
  })

  const insumoIdW = watch('insumo_id')

  async function onSubmit(data: FormData) {
    try {
      setSubmitError(null)
      if (isEdit) {
        await updatePlanFitosanitario(plan.id, {
          ...data,
          variedad: variedadEdit,
          notas: data.notas || undefined,
        })
      } else {
        if (variedadesSeleccionadas.length === 0) {
          setSubmitError('Elegí al menos una variedad.')
          return
        }
        await createPlanFitosanitario({
          ...data,
          temporada,
          variedades: variedadesSeleccionadas,
          notas: data.notas || undefined,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['plan-fitosanitario', temporada] })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitError(typeof detail === 'string' ? detail : 'Error al guardar.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Nº aplicación</label>
          <input type="number" min="1" {...register('numero_aplicacion')} className={field} />
          {errors.numero_aplicacion && <p className={err}>{errors.numero_aplicacion.message}</p>}
        </div>
        <div>
          <label className={label}>Mes</label>
          <select {...register('mes')} className={field}>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={label}>Producto</label>
        <InsumoSelect
          value={insumoNombre}
          insumoId={insumoIdW}
          onChange={(nombre, insumoId, insumo) => {
            setInsumoNombre(nombre)
            setInsumoInfo(insumo ?? null)
            setValue('insumo_id', insumoId ?? '', { shouldValidate: true })
          }}
          className={field}
          error={errors.insumo_id?.message}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Objetivo / Plaga</label>
          <input type="text" placeholder="Ej: Oidio" {...register('objetivo')} className={field} />
          {errors.objetivo && <p className={err}>{errors.objetivo.message}</p>}
        </div>
        <div>
          <label className={label}>
            Dosis {insumoInfo ? `(${insumoInfo.unidad}/ha)` : plan?.insumo_unidad ? `(${plan.insumo_unidad}/ha)` : '/ha'}
          </label>
          <input type="number" step="0.01" min="0" placeholder="0.00" {...register('dosis_por_ha')} className={field} />
          {errors.dosis_por_ha && <p className={err}>{errors.dosis_por_ha.message}</p>}
        </div>
      </div>

      {isEdit ? (
        <div>
          <label className={label}>Variedad</label>
          <select value={variedadEdit} onChange={(e) => setVariedadEdit(e.target.value)} className={field}>
            {variedadesDisponibles.map((v) => (
              <option key={v} value={v}>{VARIEDAD_LABELS[v] ?? v}</option>
            ))}
          </select>
        </div>
      ) : (
        <div>
          <label className={label}>¿A qué variedades aplica?</label>
          <div className="grid grid-cols-2 gap-2 border border-gray-200 rounded-md p-3">
            {variedadesDisponibles.map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={variedadesSeleccionadas.includes(v)}
                  onChange={(e) => {
                    setVariedadesSeleccionadas((prev) =>
                      e.target.checked ? [...prev, v] : prev.filter((x) => x !== v)
                    )
                  }}
                />
                {VARIEDAD_LABELS[v] ?? v}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className={label}>Notas (opcional)</label>
        <textarea rows={2} {...register('notas')} className={field} />
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
          {isEdit ? 'Guardar cambios' : 'Agregar aplicación'}
        </button>
      </div>
    </form>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PlanFitosanitarioPage() {
  const campanaGlobal = useContextStore((s) => s.campana)
  const [temporada, setTemporada] = useState(() => campanaToAnio(campanaGlobal))

  // Ajustado durante el render (no en un useEffect) para no disparar
  // cascading renders — mismo patrón que metas/page.tsx.
  const [prevCampanaGlobal, setPrevCampanaGlobal] = useState(campanaGlobal)
  if (prevCampanaGlobal !== campanaGlobal) {
    setPrevCampanaGlobal(campanaGlobal)
    setTemporada(campanaToAnio(campanaGlobal))
  }

  const currentUser = useAuthStore((s) => s.user)
  const isGerencialUp = currentUser?.role === 'super_admin' || currentUser?.role === 'gerencial'

  const [variedadActiva, setVariedadActiva] = useState<string | null>(null)
  const [modal, setModal] = useState<'create' | { edit: PlanFitosanitario } | null>(null)
  const queryClient = useQueryClient()

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas'],
    queryFn: getParcelas,
    staleTime: 300_000,
  })

  const { data: planes = [], isLoading } = useQuery({
    queryKey: ['plan-fitosanitario', temporada],
    queryFn: () => getPlanFitosanitario(temporada),
  })

  const variedadesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const p of parcelas) if (p.is_active && p.variedad) set.add(p.variedad)
    for (const pl of planes) set.add(pl.variedad)
    return Array.from(set).sort((a, b) => (VARIEDAD_LABELS[a] ?? a).localeCompare(VARIEDAD_LABELS[b] ?? b))
  }, [parcelas, planes])

  const activa = variedadActiva && variedadesDisponibles.includes(variedadActiva)
    ? variedadActiva
    : variedadesDisponibles[0]

  const filasVariedad = useMemo(
    () => planes
      .filter((p) => p.variedad === activa)
      .sort((a, b) => a.numero_aplicacion - b.numero_aplicacion || a.mes - b.mes),
    [planes, activa],
  )

  async function handleDelete(id: string) {
    if (!window.confirm('¿Eliminar esta aplicación del plan?')) return
    try {
      await deletePlanFitosanitario(id)
      queryClient.invalidateQueries({ queryKey: ['plan-fitosanitario', temporada] })
    } catch {
      alert('Error al eliminar.')
    }
  }

  const colSpan = isGerencialUp ? 7 : 6

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-gray-700" />
            <h1 className="text-2xl font-semibold text-gray-900">Plan Fitosanitario</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Programa de aplicaciones por variedad, cargado a mano cada temporada
          </p>
        </div>
        <select
          value={temporada}
          onChange={(e) => setTemporada(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>Campaña {y}/{y + 1}</option>)}
        </select>
      </div>

      {variedadesDisponibles.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
          No hay variedades activas todavía — cargá parcelas con variedad primero.
        </div>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap">
            {variedadesDisponibles.map((v) => (
              <button
                key={v}
                onClick={() => setVariedadActiva(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activa === v
                    ? 'bg-[#7a1f2c] text-white'
                    : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {VARIEDAD_LABELS[v] ?? v}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {filasVariedad.length} aplicación{filasVariedad.length !== 1 ? 'es' : ''} planificada{filasVariedad.length !== 1 ? 's' : ''}
              {activa && <> para {VARIEDAD_LABELS[activa] ?? activa}</>}
            </p>
            {isGerencialUp && (
              <button
                onClick={() => setModal('create')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
              >
                <Plus size={16} />
                Agregar aplicación
              </button>
            )}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Nº Apl.</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Mes</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Producto</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Objetivo</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Dosis/ha</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Notas</th>
                    {isGerencialUp && (
                      <th className="px-4 py-3 font-medium text-gray-600 text-center">Acciones</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {isLoading ? (
                    <tr><td colSpan={colSpan} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>
                  ) : filasVariedad.length === 0 ? (
                    <tr>
                      <td colSpan={colSpan} className="px-4 py-10 text-center text-gray-400">
                        Sin aplicaciones planificadas para {activa ? (VARIEDAD_LABELS[activa] ?? activa) : 'esta variedad'}
                      </td>
                    </tr>
                  ) : (
                    filasVariedad.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-gray-800">{p.numero_aplicacion}</td>
                        <td className="px-4 py-2.5 text-gray-600">{MESES[p.mes - 1]}</td>
                        <td className="px-4 py-2.5 text-gray-800 font-medium">{p.insumo_nombre}</td>
                        <td className="px-4 py-2.5 text-gray-600">{p.objetivo}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-gray-700">{p.dosis_por_ha} {p.insumo_unidad}</td>
                        <td className="px-4 py-2.5 text-gray-500 max-w-[160px] truncate">{p.notas ?? '—'}</td>
                        {isGerencialUp && (
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => setModal({ edit: p })}
                                title="Editar"
                                className="p-1.5 rounded-md text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                onClick={() => handleDelete(p.id)}
                                title="Eliminar"
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
          </div>
        </>
      )}

      {modal === 'create' && activa && (
        <Modal title={`Agregar aplicación — ${VARIEDAD_LABELS[activa] ?? activa}`} onClose={() => setModal(null)}>
          <PlanForm
            temporada={temporada}
            variedadesDisponibles={variedadesDisponibles}
            variedadActiva={activa}
            onSuccess={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}

      {modal !== null && modal !== 'create' && (
        <Modal title="Editar aplicación" onClose={() => setModal(null)}>
          <PlanForm
            plan={modal.edit}
            temporada={temporada}
            variedadesDisponibles={variedadesDisponibles}
            variedadActiva={activa ?? modal.edit.variedad}
            onSuccess={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
    </div>
  )
}
