'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { ClipboardList, ClipboardCheck, Plus, Pencil, Trash2, X, Loader2 } from 'lucide-react'
import { useForm, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  getPlanFitosanitario,
  createPlanFitosanitario,
  updatePlanFitosanitario,
  deletePlanFitosanitario,
  getAvance,
  type AvanceItem,
  type EstadoAvance,
  type PlanFitosanitario,
} from '@/lib/api/planFitosanitario'
import { getParcelas, VARIEDAD_LABELS } from '@/lib/api/produccion'
import { MESES, formatNum } from '@/components/produccion/formato'
import InsumoSelect from '@/components/produccion/InsumoSelect'
import type { InsumoResponse } from '@/lib/api/insumos'
import { useCampanaAnio, buildCampanas, campanaToAnio } from '@/store/contextStore'
import { useAuthStore } from '@/store/authStore'

const now = new Date()
// aniosAdelante=1: permite cargar el plan de la próxima campaña antes de
// que empiece.
const AVAILABLE_YEARS = buildCampanas(1).map(campanaToAnio)

// Campaign order: May = 0 ... April = 11.
const ordenCampania = (mes: number): number => (mes - 5 + 12) % 12
const MESES_CAMPANIA = Array.from({ length: 12 }, (_, i) => ((i + 4) % 12) + 1)

// Same palette as the compliance matrix: red under, green on target, blue over.
const ESTADO_CHIP: Record<EstadoAvance, { label: string; clase: string }> = {
  pendiente: { label: 'Sin aplicar', clase: 'bg-red-50 text-red-700 border border-red-200' },
  bajo: { label: 'Por debajo', clase: 'bg-red-50 text-red-700 border border-red-200' },
  ok: { label: 'En plan', clase: 'bg-green-50 text-green-700 border border-green-200' },
  exceso: { label: 'De más', clase: 'bg-blue-50 text-blue-700 border border-blue-200' },
  no_planificado: { label: 'No planificado', clase: 'bg-blue-50 text-blue-700 border border-blue-200' },
}

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const err = 'mt-1 text-xs text-red-600'

const schema = z.object({
  mes: z.coerce.number().int().min(1).max(12),
  insumo_id: z.string().min(1, 'Elegí un insumo de la lista'),
  objetivo: z.string().min(1, 'Requerido'),
  dosis_por_ha: z.coerce.number().positive('Debe ser mayor a 0'),
  notas: z.string().optional(),
})

type FormData = z.infer<typeof schema>

type ModalState = { create: number | null } | { edit: PlanFitosanitario } | null

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
  mesInicial,
  onSuccess,
  onCancel,
}: {
  plan?: PlanFitosanitario
  temporada: number
  variedadesDisponibles: string[]
  variedadActiva: string
  mesInicial?: number
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
          mes: plan.mes,
          insumo_id: plan.insumo_id,
          objetivo: plan.objetivo,
          dosis_por_ha: plan.dosis_por_ha,
          notas: plan.notas ?? '',
        }
      : { mes: mesInicial ?? now.getMonth() + 1, insumo_id: '', objetivo: '', notas: '' },
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
      queryClient.invalidateQueries({ queryKey: ['plan-avance', temporada] })
      onSuccess()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setSubmitError(typeof detail === 'string' ? detail : 'Error al guardar.')
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <label className={label}>Mes</label>
        <select {...register('mes')} className={field}>
          {MESES_CAMPANIA.map((m) => <option key={m} value={m}>{MESES[m - 1]}</option>)}
        </select>
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
            Dosis objetivo {insumoInfo ? `(${insumoInfo.unidad}/ha)` : plan?.insumo_unidad ? `(${plan.insumo_unidad}/ha)` : '/ha'}
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
          {isEdit ? 'Guardar cambios' : 'Agregar al plan'}
        </button>
      </div>
    </form>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PlanFitosanitarioPage() {
  const [temporada, setTemporada] = useCampanaAnio()

  const currentUser = useAuthStore((s) => s.user)
  const isGerencialUp = currentUser?.role === 'super_admin' || currentUser?.role === 'gerencial'

  const [variedadActiva, setVariedadActiva] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
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

  const { data: avance = [] } = useQuery({
    queryKey: ['plan-avance', temporada, 'todo'],
    queryFn: () => getAvance(temporada),
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

  // Rows of the active variety grouped by month, in campaign order.
  const porMes = useMemo(() => {
    const grupos = new Map<number, PlanFitosanitario[]>()
    for (const p of planes.filter((x) => x.variedad === activa)) {
      grupos.set(p.mes, [...(grupos.get(p.mes) ?? []), p])
    }
    return Array.from(grupos.entries())
      .sort(([a], [b]) => ordenCampania(a) - ordenCampania(b))
      .map(([mes, filas]) => ({
        mes,
        filas: [...filas].sort((a, b) => a.insumo_nombre.localeCompare(b.insumo_nombre)),
      }))
  }, [planes, activa])

  const totalFilas = porMes.reduce((n, g) => n + g.filas.length, 0)

  // (variety, month, product) -> progress, shown next to each target dose.
  const avancePorClave = useMemo(() => {
    const mapa = new Map<string, AvanceItem>()
    for (const a of avance) mapa.set(`${a.variedad}|${a.mes}|${a.insumo_id}`, a)
    return mapa
  }, [avance])

  const mesActual = now.getMonth() + 1

  async function handleDelete(id: string) {
    if (!window.confirm('¿Eliminar este producto del plan?')) return
    try {
      await deletePlanFitosanitario(id)
      queryClient.invalidateQueries({ queryKey: ['plan-fitosanitario', temporada] })
      queryClient.invalidateQueries({ queryKey: ['plan-avance', temporada] })
    } catch {
      alert('Error al eliminar.')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-gray-700" />
            <h1 className="text-2xl font-semibold text-gray-900">Plan Fitosanitario</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Dosis objetivo por hectárea, por variedad, mes y producto. Lo aplicado en el mes se descuenta del objetivo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/produccion/cumplimiento-fitosanitario"
            className="flex items-center gap-1.5 text-sm font-medium text-[#7a1f2c] hover:underline"
          >
            <ClipboardCheck size={15} />
            Ver cumplimiento →
          </Link>
          <select
            value={temporada}
            onChange={(e) => setTemporada(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>Campaña {y}/{y + 1}</option>)}
          </select>
        </div>
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
              {totalFilas} producto{totalFilas !== 1 ? 's' : ''} en el plan
              {activa && <> de {VARIEDAD_LABELS[activa] ?? activa}</>}
            </p>
            {isGerencialUp && (
              <button
                onClick={() => setModal({ create: null })}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
              >
                <Plus size={16} />
                Agregar al plan
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-8 text-center text-gray-400">Cargando…</div>
          ) : porMes.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
              Sin productos planificados para {activa ? (VARIEDAD_LABELS[activa] ?? activa) : 'esta variedad'}
            </div>
          ) : (
            <div className="space-y-4">
              {porMes.map(({ mes, filas }) => (
                <section
                  key={mes}
                  data-testid="plan-mes"
                  className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
                >
                  <header className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                    <h2 className="text-sm font-semibold text-gray-800">
                      {MESES[mes - 1]}
                      {mes === mesActual && (
                        <span className="ml-2 rounded-full bg-[#7a1f2c] px-2 py-0.5 text-[10px] font-medium text-white">Mes actual</span>
                      )}
                    </h2>
                    {isGerencialUp && (
                      <button
                        onClick={() => setModal({ create: mes })}
                        className="flex items-center gap-1 text-xs font-medium text-[#7a1f2c] hover:underline"
                      >
                        <Plus size={13} /> Producto en {MESES[mes - 1]}
                      </button>
                    )}
                  </header>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                          <th className="px-4 py-2 font-medium">Producto</th>
                          <th className="px-3 py-2 font-medium">Objetivo</th>
                          <th className="px-3 py-2 font-medium text-right">Dosis/ha</th>
                          <th className="px-3 py-2 font-medium">Avance del mes</th>
                          {isGerencialUp && <th className="px-4 py-2 font-medium text-center">Acciones</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filas.map((p) => {
                          const av = activa ? avancePorClave.get(`${activa}|${mes}|${p.insumo_id}`) : undefined
                          const chip = av ? ESTADO_CHIP[av.estado] : null
                          return (
                            <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-4 py-2.5 font-medium text-gray-800">
                                {p.insumo_nombre}
                                {p.notas && <span className="block text-xs font-normal text-gray-500">{p.notas}</span>}
                              </td>
                              <td className="px-3 py-2.5 text-gray-600">{p.objetivo}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-gray-700">
                                {formatNum(p.dosis_por_ha, 2)} {p.insumo_unidad}
                              </td>
                              <td className="px-3 py-2.5">
                                {chip && av ? (
                                  <span
                                    data-testid="plan-avance-chip"
                                    data-estado={av.estado}
                                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.clase}`}
                                  >
                                    {chip.label}{av.porcentaje !== null ? ` · ${formatNum(av.porcentaje, 0)} %` : ''}
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-300">–</span>
                                )}
                              </td>
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
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {modal !== null && 'create' in modal && activa && (
        <Modal title={`Agregar al plan — ${VARIEDAD_LABELS[activa] ?? activa}`} onClose={() => setModal(null)}>
          <PlanForm
            mesInicial={modal.create ?? undefined}
            temporada={temporada}
            variedadesDisponibles={variedadesDisponibles}
            variedadActiva={activa}
            onSuccess={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}

      {modal !== null && 'edit' in modal && (
        <Modal title="Editar dosis del plan" onClose={() => setModal(null)}>
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
