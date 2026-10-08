'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useForm, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { usePaginatedList } from '@/lib/usePaginatedList'
import { getParcelas } from '@/lib/api/produccion'
import { VARIEDAD_VALUES, VARIEDAD_LABELS, type VariedadUva } from '@/lib/api/parcelas'
import { getCosechas, DESTINO_LABELS, type RegistroCosechaResponse } from '@/lib/api/cosecha'
import {
  getIngresosPasero, createIngresoPasero, getStockPasero, getUbicacionesPasero,
  getProductores, getParametros, errorDetail,
} from '@/lib/api/altaProduccion'
import { useCampanaAnio } from '@/store/contextStore'
import FormError from '@/components/ui/FormError'

const PAGE_SIZE = 10
const KG_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fmtKg = (n: number) => KG_FMT.format(n)
const fmtFecha = (iso: string) => iso.split('-').reverse().join('/')
const TODAY = new Date().toISOString().split('T')[0]

const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'
const thCls = 'text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide'
const thRCls = thCls.replace('text-left', 'text-right')

// kg_real viaja como string decimal (hasta 2 decimales); acepta coma.
const schema = z.object({
  fecha: z.string().min(1, 'Requerido'),
  pasero_id: z.string().min(1, 'Elegí un pasero'),
  variedad: z.enum(VARIEDAD_VALUES),
  origen: z.enum(['propio', 'tercero']),
  productor_id: z.string().optional(),
  ubicacion_id: z.string().optional(),
  cosecha_id: z.string().optional(),
  carros: z.coerce.number().int('Debe ser entero').min(1, 'Mínimo 1'),
  fichas: z.union([z.literal(''), z.coerce.number().int('Debe ser entero').positive('Debe ser mayor a 0')]).optional(),
  kg_real: z.string().trim().regex(/^\d+([.,]\d{1,2})?$/, 'Número positivo con hasta 2 decimales')
    .refine((v) => Number(v.replace(',', '.')) > 0, 'Debe ser mayor a 0'),
  observaciones: z.string().optional(),
}).refine((v) => v.origen !== 'tercero' || !!v.productor_id, {
  path: ['productor_id'], message: 'Un ingreso de origen tercero requiere productor',
})
type FormValues = z.infer<typeof schema>

function cosechaLabel(c: RegistroCosechaResponse): string {
  const origen = c.origen === 'tercero' ? (c.proveedor_tercero ?? 'Tercero') : (c.parcela_nombre ?? 'Sin parcela')
  return `${fmtFecha(c.fecha)} · ${origen} · ${c.variedad ?? 'sin variedad'} · ${fmtKg(c.kg_total)} kg (${DESTINO_LABELS[c.destino]})`
}

export default function PaseroPage() {
  const qc = useQueryClient()
  const [temporada] = useCampanaAnio()
  const [paseroFiltro, setPaseroFiltro] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const { data: parcelas = [] } = useQuery({ queryKey: ['parcelas'], queryFn: getParcelas, staleTime: 300_000 })
  const paseros = parcelas.filter((p) => p.tipo === 'pasero' && p.is_active)
  const nombrePasero = (id: string) => parcelas.find((p) => p.id === id)?.nombre ?? '–'

  const { data: productores = [] } = useQuery({
    queryKey: ['ap-productores'], queryFn: () => getProductores(), staleTime: 60_000,
  })
  const productoresActivos = productores.filter((p) => p.is_active)
  const nombreProductor = (id: string | null) => (id ? productores.find((p) => p.id === id)?.nombre ?? '–' : '–')

  const { data: parametros } = useQuery({ queryKey: ['ap-parametros'], queryFn: getParametros, staleTime: 60_000 })

  const { data: stock = [], error: stockError } = useQuery({
    queryKey: ['ap-stock', paseroFiltro],
    queryFn: () => getStockPasero(paseroFiltro || undefined),
    staleTime: 30_000,
  })

  const { data: ingresos = [], isLoading, error: loadError } = useQuery({
    queryKey: ['ap-ingresos', paseroFiltro],
    queryFn: () => getIngresosPasero({ pasero_id: paseroFiltro || undefined }),
    staleTime: 30_000,
  })
  const { page, setPage, totalPages, paged } = usePaginatedList(ingresos, PAGE_SIZE)

  // Cosechas con destino a pasa de la campaña elegida (candidatas para vincular).
  const { data: cosechasPasa = [] } = useQuery({
    queryKey: ['ap-cosechas-pasa', temporada],
    queryFn: async () => {
      const [pasas, rama] = await Promise.all([
        getCosechas({ temporada, destino: 'PASAS', limit: 500 }),
        getCosechas({ temporada, destino: 'RAMA_PASA', limit: 500 }),
      ])
      return [...pasas, ...rama].sort((a, b) => b.fecha.localeCompare(a.fecha))
    },
    staleTime: 60_000,
    enabled: showModal,
  })

  const {
    register, handleSubmit, reset, control, formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues: { fecha: TODAY, origen: 'propio', carros: 1, variedad: 'flame' },
  })

  const w = useWatch({ control })
  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ap-ubicaciones', w.pasero_id ?? ''],
    queryFn: () => getUbicacionesPasero(w.pasero_id),
    enabled: showModal && !!w.pasero_id,
    staleTime: 60_000,
  })

  // Vista previa: fichas = fichas informadas o carros × fichas por carro.
  const carros = Number(w.carros) || 0
  const fichasInf = w.fichas === '' || w.fichas == null ? null : Number(w.fichas)
  const kgRealNum = Number(String(w.kg_real ?? '').replace(',', '.')) || 0
  const fichas = fichasInf ?? (parametros ? carros * parametros.fichas_por_carro : null)
  const kgTeorico = fichas != null && parametros ? fichas * parametros.kg_por_ficha : null
  const merma = kgTeorico != null && kgRealNum > 0 ? kgTeorico - kgRealNum : null

  function openCreate() {
    reset({
      fecha: TODAY, origen: 'propio', carros: 1, variedad: 'flame',
      pasero_id: paseroFiltro, productor_id: '', ubicacion_id: '', cosecha_id: '',
      fichas: '', kg_real: '', observaciones: '',
    })
    setApiError(null)
    setShowModal(true)
  }

  async function onSubmit(v: FormValues) {
    setApiError(null)
    try {
      await createIngresoPasero({
        fecha: v.fecha,
        pasero_id: v.pasero_id,
        variedad: v.variedad,
        kg_real: v.kg_real.trim().replace(',', '.'),
        carros: v.carros,
        fichas: v.fichas === '' || v.fichas == null ? null : v.fichas,
        origen: v.origen,
        productor_id: v.productor_id || null,
        ubicacion_id: v.ubicacion_id || null,
        cosecha_id: v.cosecha_id || null,
        observaciones: v.observaciones?.trim() || null,
      })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['ap-ingresos'] }),
        qc.invalidateQueries({ queryKey: ['ap-stock'] }),
      ])
      setShowModal(false)
    } catch (e) {
      setApiError(errorDetail(e))
    }
  }

  const totalReal = ingresos.reduce((s, i) => s + i.kg_real, 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Ingreso al pasero</h1>
          <p className="text-sm text-gray-500 mt-0.5">Uva fresca que entra al pasero, pesada en báscula</p>
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
            <Plus size={16} /> Nuevo ingreso
          </button>
        </div>
      </div>

      {/* Stock de uva por pasero y variedad */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Stock de uva por variedad</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Pasa esperada = uva consumida ÷ {parametros ? fmtKg(parametros.ratio_uva_pasa) : 'ratio'}. Diferencia = levantada − esperada.
          </p>
        </div>
        {stockError ? (
          <div className="p-4"><FormError description={errorDetail(stockError, 'No se pudo cargar el stock')} /></div>
        ) : stock.length === 0 ? (
          <p className="px-5 py-8 text-center text-gray-400 text-sm">Todavía no hay uva ingresada</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls}>Pasero</th>
                  <th className={thCls}>Variedad</th>
                  <th className={thRCls}>Uva ingresada kg</th>
                  <th className={thRCls}>Uva consumida kg</th>
                  <th className={thRCls}>Uva disponible kg</th>
                  <th className={thRCls}>Pasa levantada kg</th>
                  <th className={thRCls}>Pasa esperada kg</th>
                  <th className={thRCls}>Diferencia kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {stock.map((s) => (
                  <tr key={`${s.pasero_id}-${s.variedad}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-900">{s.pasero_nombre}</td>
                    <td className="px-4 py-2.5 text-gray-600">{VARIEDAD_LABELS[s.variedad] ?? s.variedad}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(s.uva_ingresada_kg)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(s.uva_consumida_kg)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-green-700">{fmtKg(s.uva_disponible_kg)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(s.pasa_levantada_kg)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(s.pasa_esperada_kg)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${s.diferencia_pasa_kg < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                      {fmtKg(s.diferencia_pasa_kg)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ingresos */}
      {loadError && <FormError description={errorDetail(loadError, 'No se pudo cargar el listado')} />}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Ingresos</h3>
          <span className="text-xs text-gray-400">{ingresos.length} registros</span>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
          </div>
        ) : ingresos.length === 0 ? (
          <p className="px-5 py-10 text-center text-gray-400 text-sm">No hay ingresos registrados</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className={thCls}>Fecha</th>
                  <th className={thCls}>Pasero</th>
                  <th className={thCls}>Variedad</th>
                  <th className={thCls}>Origen</th>
                  <th className={thRCls}>Carros</th>
                  <th className={thRCls}>Fichas</th>
                  <th className={thRCls}>Kg teórico</th>
                  <th className={thRCls}>Kg báscula</th>
                  <th className={thRCls}>Merma kg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paged.map((i) => (
                  <tr key={i.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtFecha(i.fecha)}</td>
                    <td className="px-4 py-2.5 text-gray-900">{nombrePasero(i.pasero_id)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{VARIEDAD_LABELS[i.variedad] ?? i.variedad}</td>
                    <td className="px-4 py-2.5">
                      {i.origen === 'tercero' ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                          Tercero: {nombreProductor(i.productor_id)}
                        </span>
                      ) : (
                        <span className="text-gray-600">Propio{i.productor_id ? `: ${nombreProductor(i.productor_id)}` : ''}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{i.carros}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{i.fichas}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-700">{fmtKg(i.kg_teorico)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-gray-900">{fmtKg(i.kg_real)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${i.merma_kg < 0 ? 'text-amber-700' : 'text-gray-700'}`}>
                      {fmtKg(i.merma_kg)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={7} className="px-4 py-2.5 text-xs font-semibold text-gray-500 text-right">TOTAL</td>
                  <td className="px-4 py-2.5 text-right font-bold font-mono text-green-700">{fmtKg(totalReal)} kg</td>
                  <td />
                </tr>
              </tfoot>
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
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, ingresos.length)} de {ingresos.length}
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
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900">Nuevo ingreso al pasero</h2>
              <button type="button" onClick={() => setShowModal(false)} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Fecha <span className="text-red-500">*</span></label>
                  <input type="date" {...register('fecha')} className={inputCls} />
                  {errors.fecha && <p className="mt-1 text-xs text-red-600">{errors.fecha.message}</p>}
                </div>
                <div>
                  <label className={labelCls}>Pasero <span className="text-red-500">*</span></label>
                  <select {...register('pasero_id')} className={inputCls}>
                    <option value="">— Seleccionar —</option>
                    {paseros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                  {errors.pasero_id && <p className="mt-1 text-xs text-red-600">{errors.pasero_id.message}</p>}
                </div>
                <div>
                  <label className={labelCls}>Variedad <span className="text-red-500">*</span></label>
                  <select {...register('variedad')} className={inputCls}>
                    {VARIEDAD_VALUES.map((v: VariedadUva) => <option key={v} value={v}>{VARIEDAD_LABELS[v]}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Ubicación (hilera / parte)</label>
                  <select {...register('ubicacion_id')} className={inputCls} disabled={!w.pasero_id}>
                    <option value="">Sin ubicación</option>
                    {ubicaciones.map((u) => <option key={u.id} value={u.id}>Hilera {u.hilera} · Parte {u.parte}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Origen</label>
                  <select {...register('origen')} className={inputCls}>
                    <option value="propio">Propio</option>
                    <option value="tercero">Tercero</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>
                    Productor {w.origen === 'tercero' && <span className="text-red-500">*</span>}
                  </label>
                  <select {...register('productor_id')} className={inputCls}>
                    <option value="">Sin productor</option>
                    {productoresActivos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                  {errors.productor_id && <p className="mt-1 text-xs text-red-600">{errors.productor_id.message}</p>}
                </div>
                <div>
                  <label className={labelCls}>Carros <span className="text-red-500">*</span></label>
                  <input type="number" min={1} step={1} {...register('carros')} className={inputCls} />
                  {errors.carros && <p className="mt-1 text-xs text-red-600">{errors.carros.message}</p>}
                </div>
                <div>
                  <label className={labelCls}>Fichas (solo si el carro no está completo)</label>
                  <input
                    type="number" min={1} step={1} {...register('fichas')}
                    placeholder={parametros ? `Por defecto ${carros * parametros.fichas_por_carro}` : ''}
                    className={inputCls}
                  />
                  {errors.fichas && <p className="mt-1 text-xs text-red-600">{errors.fichas.message}</p>}
                </div>
                <div>
                  <label className={labelCls}>Kg báscula <span className="text-red-500">*</span></label>
                  <input type="text" inputMode="decimal" {...register('kg_real')} className={inputCls} />
                  {errors.kg_real && <p className="mt-1 text-xs text-red-600">{errors.kg_real.message}</p>}
                </div>
                <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-sm self-end">
                  <p className="text-gray-600">
                    Kg teórico: <span className="font-mono font-semibold text-gray-900">{kgTeorico != null ? fmtKg(kgTeorico) : '–'}</span>
                    {fichas != null && parametros && (
                      <span className="text-xs text-gray-400"> ({fichas} fichas × {fmtKg(parametros.kg_por_ficha)} kg)</span>
                    )}
                  </p>
                  <p className="text-gray-600">
                    Merma: <span className={`font-mono font-semibold ${merma != null && merma < 0 ? 'text-amber-700' : 'text-gray-900'}`}>
                      {merma != null ? `${fmtKg(merma)} kg` : '–'}
                    </span>
                  </p>
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>Cosecha de origen (opcional, destino Pasas o Rama Pasa)</label>
                  <select {...register('cosecha_id')} className={inputCls}>
                    <option value="">Sin vincular</option>
                    {cosechasPasa.map((c) => <option key={c.id} value={c.id}>{cosechaLabel(c)}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Cosechas de la campaña {temporada}/{temporada + 1}.</p>
                </div>
                <div className="md:col-span-2">
                  <label className={labelCls}>Observaciones</label>
                  <textarea rows={2} {...register('observaciones')} className={inputCls} />
                </div>
              </div>
              {apiError && <div className="mt-4"><FormError description={apiError} /></div>}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
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
