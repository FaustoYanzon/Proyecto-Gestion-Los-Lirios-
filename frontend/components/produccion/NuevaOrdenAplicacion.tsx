'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useFieldArray, useForm, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react'
import {
  actualizarOrden,
  crearOrden,
  getOrdenAplicacion,
  revisarValvula,
  type OrdenAplicacion,
  type OrdenAplicacionLineaCreate,
  type OrdenAplicacionUpdate,
  type ValvulaARevisar,
} from '@/lib/api/ordenesAplicacion'
import {
  getAvance,
  postContraste,
  type AvanceItem,
  type ContrasteLineaResultado,
  type ContrasteVariedad,
} from '@/lib/api/planFitosanitario'
import { VARIEDAD_LABELS, type ParcelaItem } from '@/lib/api/produccion'
import { getInsumos } from '@/lib/api/insumos'
import { getValvulasReales, hoyArgentina, type ValvulaReal } from '@/lib/api/riego'
import InsumoSelect from '@/components/produccion/InsumoSelect'
import { MESES, formatNum } from '@/components/produccion/formato'
import { A_REVISAR_QUERY_KEY, productosDe } from '@/components/produccion/ARevisarPanel'

const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const fieldSm = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const label = 'block text-sm font-medium text-gray-700 mb-1'
const labelSm = 'block text-[11px] font-medium text-gray-500 mb-0.5'
const err = 'mt-1 text-xs text-red-600'

// Key used for parcels without a variety, so they can still be grouped.
const SIN_VARIEDAD = ''

function variedadLabel(v: string): string {
  return v === SIN_VARIEDAD ? 'Sin variedad' : VARIEDAD_LABELS[v] ?? v
}

// ── Schema ────────────────────────────────────────────────────────────────────

// Days are kept as strings so an empty input is "missing", not a silent 0
// (z.coerce would turn '' into 0).
const diasSchema = z
  .string()
  .trim()
  .min(1, 'Requerido')
  .refine((v) => Number.isInteger(Number(v)) && Number(v) >= 0, 'Entero ≥ 0')

const lineaSchema = z.object({
  insumo_id: z.string().min(1, 'Elegí un producto de la lista'),
  insumo_nombre: z.string(),
  unidad: z.string(),
  dosis_por_ha: z
    .string()
    .trim()
    .min(1, 'Requerido')
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, 'Mayor a 0'),
  dias_carencia: diasSchema,
  dias_reingreso: diasSchema,
  // Whether the user typed carencia/reingreso on this line: untouched lines
  // follow the last typed value.
  carencia_manual: z.boolean(),
  reingreso_manual: z.boolean(),
})

const schema = z.object({
  objetivo: z.string().trim().min(1, 'Requerido'),
  fecha_planificada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Requerido'),
  notas: z.string().optional(),
  lineas: z
    .array(lineaSchema)
    .min(1, 'Agregá al menos un producto')
    .superRefine((lineas, ctx) => {
      const vistos = new Set<string>()
      lineas.forEach((l, i) => {
        if (!l.insumo_id) return
        if (vistos.has(l.insumo_id)) {
          ctx.addIssue({ code: 'custom', message: 'Producto repetido en la orden', path: [i, 'insumo_id'] })
        }
        vistos.add(l.insumo_id)
      })
    }),
})

type FormValues = z.infer<typeof schema>
type LineaForm = FormValues['lineas'][number]

function lineaVacia(carencia = '', reingreso = ''): LineaForm {
  return {
    insumo_id: '', insumo_nombre: '', unidad: '', dosis_por_ha: '',
    dias_carencia: carencia, dias_reingreso: reingreso,
    carencia_manual: false, reingreso_manual: false,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Backend `detail` as-is: a string for 409/422 business rules, or the list of
// pydantic errors for schema validation.
export function apiErrorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (typeof (d as { msg?: unknown })?.msg === 'string' ? (d as { msg: string }).msg : null))
      .filter((m): m is string => !!m)
    if (msgs.length) return msgs.join(' · ')
  }
  return fallback
}

// Season (May→April) and calendar month of an ISO date; the backend measures
// the plan with the same rule, so the form asks about the right month.
function periodoDeFecha(fecha: string): { temporada: number; mes: number } | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(fecha)
  if (!m) return null
  const anio = Number(m[1])
  const mes = Number(m[2])
  return { temporada: mes >= 5 ? anio : anio - 1, mes }
}

function mesAnterior(p: { temporada: number; mes: number }): { temporada: number; mes: number } {
  if (p.mes === 5) return { temporada: p.temporada - 1, mes: 4 }
  return { temporada: p.temporada, mes: p.mes === 1 ? 12 : p.mes - 1 }
}

// Waits for the user to stop typing before the plan contrast is asked.
function useDebounced<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

const fmtDosis = (v: number): string => formatNum(Math.round(v * 10000) / 10000, 4)

type ResumenOrden = 'del_plan' | 'parcial' | 'mixta' | 'fuera'

const RESUMEN_ESTILO: Record<ResumenOrden, { texto: string; clase: string }> = {
  del_plan: { texto: 'Orden del plan', clase: 'text-green-800 bg-green-50 border-green-200' },
  parcial: { texto: 'Orden parcial del plan', clase: 'text-amber-800 bg-amber-50 border-amber-200' },
  mixta: { texto: 'Orden mixta: tiene productos fuera del plan', clase: 'text-blue-800 bg-blue-50 border-blue-200' },
  fuera: { texto: 'Orden fuera del plan', clase: 'text-blue-800 bg-blue-50 border-blue-200' },
}

// Whole-order verdict from the per-line contrast (spec section 5).
function resumirContraste(resultados: ContrasteLineaResultado[]): ResumenOrden | null {
  const todas = resultados.flatMap((r) => r.variedades)
  if (todas.length === 0) return null
  const fuera = todas.filter((v) => v.estado === 'fuera_del_plan').length
  if (fuera === todas.length) return 'fuera'
  if (fuera > 0) return 'mixta'
  return todas.every((v) => Number(v.porcentaje_proyectado) >= 95) ? 'del_plan' : 'parcial'
}

function dosisFaltante(item: AvanceItem): number {
  return Math.max(Number(item.dosis_plan ?? 0) - Number(item.dosis_aplicada_promedio), 0)
}

function ContrasteLinea({
  resultado, insumoNombre, unidad, mes, cargando,
}: {
  resultado: ContrasteLineaResultado | undefined
  insumoNombre: string
  unidad: string
  mes: number | null
  cargando: boolean
}) {
  if (!resultado) {
    return (
      <p className="mt-1.5 text-[11px] text-gray-400">
        {cargando ? 'Comparando con el plan…' : 'Elegí parcelas y dosis para ver cómo encaja en el plan.'}
      </p>
    )
  }
  return (
    <ul className="mt-1.5 space-y-0.5 text-[11px]" data-testid="contraste-linea">
      {resultado.variedades.map((v: ContrasteVariedad) => {
        const variedad = variedadLabel(v.variedad)
        const pct = Number(v.porcentaje_proyectado)
        if (v.estado === 'fuera_del_plan') {
          return (
            <li key={v.variedad} className="text-blue-700">
              <strong>Fuera del plan</strong> · {insumoNombre || 'El producto'} no está en el plan de{' '}
              {mes ? MESES[mes - 1] : 'este mes'} para {variedad}
            </li>
          )
        }
        const detalle = `${variedad}: plan ${fmtDosis(Number(v.dosis_plan))} ${unidad}/ha · aplicado ${fmtDosis(
          Number(v.dosis_aplicada_promedio),
        )} · con esta orden ${formatNum(pct, 0)} %`
        if (v.estado === 'excede') {
          return (
            <li key={v.variedad} className="text-blue-700">
              <strong>Excede el plan</strong> · {detalle}
            </li>
          )
        }
        return pct >= 95 ? (
          <li key={v.variedad} className="text-green-700">
            <strong>En plan</strong> · {detalle}
          </li>
        ) : (
          <li key={v.variedad} className="text-amber-700">
            <strong>Cubre parte del plan</strong> · {detalle}
          </li>
        )
      })}
    </ul>
  )
}

function PendientePlan({
  titulo, items, enOrden, onAgregar, vacio,
}: {
  titulo: string
  items: AvanceItem[]
  enOrden: Set<string>
  onAgregar: (item: AvanceItem) => void
  vacio: string
}) {
  if (items.length === 0 && !vacio) return null
  return (
    <div className="rounded-md border border-gray-200 bg-[#fbfaf6] px-3 py-2">
      <p className="text-xs font-semibold text-gray-800">{titulo}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-gray-500">{vacio}</p>
      ) : (
        <ul className="mt-1 divide-y divide-gray-100">
          {items.map((i) => {
            const yaEsta = enOrden.has(i.insumo_id)
            return (
              <li key={`${i.variedad}|${i.insumo_id}`} className="flex items-center justify-between gap-3 py-1 text-xs">
                <span className="min-w-0 text-gray-700">
                  <span className="font-medium text-red-700">{i.estado === 'pendiente' ? 'Sin aplicar' : 'Incompleto'}</span>
                  {' · '}
                  {variedadLabel(i.variedad)} · {i.insumo_nombre} · faltan {fmtDosis(dosisFaltante(i))} {i.unidad ?? ''}/ha
                </span>
                <button
                  type="button"
                  disabled={yaEsta}
                  onClick={() => onAgregar(i)}
                  data-testid="agregar-pendiente"
                  className="shrink-0 font-medium text-[#7a1f2c] hover:underline disabled:text-gray-400 disabled:no-underline"
                >
                  {yaEsta ? 'Ya está en la orden' : 'Agregar'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface NuevaOrdenAplicacionProps {
  temporada: number
  // All parcels (active and inactive): used to group by variety and to show
  // inactive parcels an existing order still has.
  parcelas: ParcelaItem[]
  // Edit this order (any origin) instead of creating a new one.
  orden?: OrdenAplicacion
  // Rework order for one valve: fixed parcel/valve, marks it reviewed on create.
  repaso?: ValvulaARevisar
  onSuccess: () => void
  onCancel: () => void
}

// A rework preloads every line of the original order (with its carencia and
// reingreso, which the a-revisar item does not carry), so fetch it first and
// mount the form once it is known: useForm only reads defaultValues on mount.
export default function NuevaOrdenAplicacion(props: NuevaOrdenAplicacionProps) {
  const { repaso, temporada } = props
  const { data: repasoOrden, isLoading, isError } = useQuery({
    queryKey: ['ordenes-aplicacion', 'detalle', repaso?.orden_id],
    queryFn: () => getOrdenAplicacion(repaso?.orden_id ?? ''),
    enabled: !!repaso,
    staleTime: 30_000,
    retry: 1,
  })

  if (!repaso) return <FormularioOrden {...props} />
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
        <Loader2 size={14} className="animate-spin" /> Cargando la orden original…
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {isError && (
        <p className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          No se pudo cargar la orden original: se precargan los productos de la válvula; completá carencia y reingreso.
        </p>
      )}
      <FormularioOrden
        {...props}
        // The rework belongs to the campaign of the original order, not to the
        // one selected in the page header.
        temporada={repasoOrden?.temporada ?? temporada}
        repasoOrden={repasoOrden ?? null}
      />
    </div>
  )
}

function FormularioOrden({
  temporada, parcelas, orden, repaso, repasoOrden = null, onSuccess, onCancel,
}: NuevaOrdenAplicacionProps & { repasoOrden?: OrdenAplicacion | null }) {
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const parcelaById = useMemo(() => {
    const map = new Map<string, ParcelaItem>()
    for (const p of parcelas) map.set(p.id, p)
    // Parcels of the order the list does not know (e.g. filtered out): keep
    // them visible so they can be unticked.
    for (const op of orden?.parcelas ?? []) {
      if (!map.has(op.parcela_id)) {
        map.set(op.parcela_id, {
          id: op.parcela_id, nombre: op.parcela_nombre, tipo: '', variedad: null, finca: null,
          cabezal_riego: null, superficie_ha: null, is_active: false,
        })
      }
    }
    return map
  }, [parcelas, orden])

  const ordenParcelaIds = useMemo(() => new Set(orden?.parcelas.map((p) => p.parcela_id) ?? []), [orden])

  const [variedadesSel, setVariedadesSel] = useState<string[]>(() => {
    if (!orden) return []
    // The API's `variedades` covers the case where the parcel list has not
    // loaded yet; the lookup adds parcels without a variety.
    const set = new Set<string>(orden.variedades ?? [])
    for (const op of orden.parcelas) {
      const p = parcelas.find((x) => x.id === op.parcela_id)
      if (p) set.add(p.variedad ?? SIN_VARIEDAD)
    }
    return Array.from(set)
  })
  const [seleccionadas, setSeleccionadas] = useState<string[]>(() => orden?.parcelas.map((p) => p.parcela_id) ?? [])
  const [valvulasModo, setValvulasModo] = useState(false)
  const [valvulasSel, setValvulasSel] = useState<string[]>([])

  // Same cache key as InsumoSelect; used to know the unit of preloaded lines.
  const { data: insumos = [] } = useQuery({
    queryKey: ['insumos', 'fitosanitario'],
    queryFn: () => getInsumos(true, 'fitosanitario'),
    staleTime: 60_000,
  })

  const { data: valvulas = [] } = useQuery({
    queryKey: ['valvulas'],
    queryFn: () => getValvulasReales(),
    staleTime: 300_000,
    enabled: !repaso,
  })

  const valvulasPorParcela = useMemo(() => {
    const map = new Map<string, ValvulaReal[]>()
    for (const v of valvulas) {
      const list = map.get(v.parcela_id) ?? []
      list.push(v)
      map.set(v.parcela_id, list)
    }
    return map
  }, [valvulas])

  const defaultValues = useMemo<FormValues>(() => {
    if (orden) {
      const lineas: LineaForm[] = (orden.lineas ?? []).map((l) => ({
        insumo_id: l.insumo_id,
        insumo_nombre: l.insumo_nombre,
        unidad: l.insumo_unidad,
        dosis_por_ha: String(Number(l.dosis_por_ha)),
        dias_carencia: String(l.dias_carencia),
        dias_reingreso: String(l.dias_reingreso),
        carencia_manual: true,
        reingreso_manual: true,
      }))
      return {
        objetivo: orden.objetivo,
        fecha_planificada: orden.fecha_planificada,
        notas: orden.notas ?? '',
        lineas: lineas.length ? lineas : [lineaVacia()],
      }
    }
    if (repaso) {
      // A rework preloads the original lines; the plan contrast is recomputed.
      const originales = repasoOrden?.lineas ?? []
      const lineas: LineaForm[] = originales.length
        ? originales.map((l) => ({
            ...lineaVacia(String(l.dias_carencia), String(l.dias_reingreso)),
            insumo_id: l.insumo_id,
            insumo_nombre: l.insumo_nombre,
            unidad: l.insumo_unidad,
            dosis_por_ha: String(Number(l.dosis_por_ha)),
            carencia_manual: true,
            reingreso_manual: true,
          }))
        : productosDe(repaso).map((p) => ({
            ...lineaVacia(),
            insumo_id: p.insumo_id,
            insumo_nombre: p.insumo_nombre,
            dosis_por_ha: String(Number(p.dosis_por_ha)),
          }))
      return {
        objetivo: repaso.objetivo,
        fecha_planificada: hoyArgentina(),
        notas: `Repaso: válvula ${repaso.valvula_nombre} de ${repaso.parcela_nombre}`,
        lineas,
      }
    }
    return { objetivo: '', fecha_planificada: hoyArgentina(), notas: '', lineas: [lineaVacia()] }
  }, [orden, repaso, repasoOrden])

  const {
    register, control, handleSubmit, setValue, getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues,
  })
  const { fields, append, remove, update } = useFieldArray({ control, name: 'lineas' })

  const lineasW = useWatch({ control, name: 'lineas' })
  const fechaW = useWatch({ control, name: 'fecha_planificada' })

  const unidadDe = (l: LineaForm): string =>
    l.unidad || insumos.find((i) => i.id === l.insumo_id)?.unidad || ''

  // ── Lines ───────────────────────────────────────────────────────────────────

  // Typing carencia/reingreso on one line copies it to the lines the user has
  // not typed on yet (never to an invented default).
  function propagarDias(campo: 'dias_carencia' | 'dias_reingreso', index: number, valor: string) {
    const flag = campo === 'dias_carencia' ? 'carencia_manual' : 'reingreso_manual'
    setValue(`lineas.${index}.${flag}`, true)
    getValues('lineas').forEach((l, j) => {
      if (j !== index && !l[flag]) setValue(`lineas.${j}.${campo}`, valor, { shouldValidate: !!valor })
    })
  }

  function agregarProducto() {
    const actuales = getValues('lineas')
    const ultimaCarencia = [...actuales].reverse().find((l) => l.dias_carencia !== '')?.dias_carencia ?? ''
    const ultimoReingreso = [...actuales].reverse().find((l) => l.dias_reingreso !== '')?.dias_reingreso ?? ''
    append(lineaVacia(ultimaCarencia, ultimoReingreso))
  }

  // ── Parcels / valves ──────────────────────────────────────────────────────

  const variedadesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const p of parcelas) if (p.is_active && p.variedad) set.add(p.variedad)
    for (const v of variedadesSel) set.add(v)
    return Array.from(set).sort((a, b) => variedadLabel(a).localeCompare(variedadLabel(b)))
  }, [parcelas, variedadesSel])

  const grupos = useMemo(
    () =>
      variedadesSel.map((v) => {
        const lista = Array.from(parcelaById.values())
          .filter((p) => (p.variedad ?? SIN_VARIEDAD) === v && (p.is_active || ordenParcelaIds.has(p.id)))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
        return { variedad: v, parcelas: lista }
      }),
    [variedadesSel, parcelaById, ordenParcelaIds],
  )

  function parcelasPorDefecto(v: string): string[] {
    return parcelas.filter((p) => p.is_active && (p.variedad ?? SIN_VARIEDAD) === v).map((p) => p.id)
  }

  function toggleVariedad(v: string) {
    if (variedadesSel.includes(v)) {
      const fuera = new Set(
        Array.from(parcelaById.values()).filter((p) => (p.variedad ?? SIN_VARIEDAD) === v).map((p) => p.id),
      )
      setVariedadesSel(variedadesSel.filter((x) => x !== v))
      setSeleccionadas(seleccionadas.filter((id) => !fuera.has(id)))
    } else {
      const nuevas = parcelasPorDefecto(v)
      setVariedadesSel([...variedadesSel, v])
      setSeleccionadas(Array.from(new Set([...seleccionadas, ...nuevas])))
      if (valvulasModo) agregarValvulasDe(nuevas)
    }
  }

  function agregarValvulasDe(parcelaIds: string[]) {
    const ids = parcelaIds.flatMap((pid) => (valvulasPorParcela.get(pid) ?? []).map((v) => v.id))
    setValvulasSel((prev) => Array.from(new Set([...prev, ...ids])))
  }

  function toggleParcela(id: string, checked: boolean) {
    setSeleccionadas(checked ? [...seleccionadas, id] : seleccionadas.filter((x) => x !== id))
    if (checked && valvulasModo) agregarValvulasDe([id])
  }

  function setGrupo(ids: string[], checked: boolean) {
    const set = new Set(ids)
    setSeleccionadas(checked ? Array.from(new Set([...seleccionadas, ...ids])) : seleccionadas.filter((x) => !set.has(x)))
    if (checked && valvulasModo) agregarValvulasDe(ids)
  }

  function toggleValvulasModo(on: boolean) {
    setValvulasModo(on)
    if (!on) {
      setValvulasSel([])
      return
    }
    // Start from what the order already has (edit), else every valve.
    const ids: string[] = []
    for (const pid of seleccionadas) {
      const actuales = orden?.parcelas.find((op) => op.parcela_id === pid)?.valvulas ?? []
      if (actuales.length) ids.push(...actuales.map((v) => v.valvula_id))
      else ids.push(...(valvulasPorParcela.get(pid) ?? []).map((v) => v.id))
    }
    setValvulasSel(Array.from(new Set(ids)))
  }

  // An existing order restricted to some valves keeps them when the valve
  // picker stays off (the backend leaves the rows of kept parcels as they are).
  const ordenConValvulasPuntuales = useMemo(() => {
    if (!orden || valvulas.length === 0) return false
    return orden.parcelas.some((op) => {
      const total = valvulasPorParcela.get(op.parcela_id)?.length ?? 0
      return op.valvulas.length > 0 && op.valvulas.length < total
    })
  }, [orden, valvulas.length, valvulasPorParcela])

  const haSeleccionadas = seleccionadas.reduce((acc, id) => acc + Number(parcelaById.get(id)?.superficie_ha ?? 0), 0)

  // ── Plan contrast (no preload: the plan is shown next to what is typed) ─────

  const periodo = periodoDeFecha(fechaW ?? '')
  const parcelaIdsContraste = repaso ? [repaso.parcela_id] : Array.from(new Set(seleccionadas))
  const lineasContraste = (lineasW ?? [])
    .filter((l) => l.insumo_id && Number(l.dosis_por_ha) > 0)
    .map((l) => ({ insumo_id: l.insumo_id, dosis_por_ha: Number(l.dosis_por_ha) }))
  const contrasteKey = useDebounced(
    parcelaIdsContraste.length > 0 && lineasContraste.length > 0 && periodo
      ? JSON.stringify({
          fecha: fechaW,
          parcelas: parcelaIdsContraste.map((pid) => ({
            parcela_id: pid,
            valvula_ids: repaso
              ? [repaso.valvula_id]
              : valvulasModo
                ? valvulas.filter((v) => v.parcela_id === pid && valvulasSel.includes(v.id)).map((v) => v.id)
                : [],
          })),
          lineas: lineasContraste,
        })
      : '',
  )
  const { data: contraste = [], isFetching: contrasteCargando } = useQuery({
    queryKey: ['plan-contraste', contrasteKey],
    queryFn: () => postContraste(JSON.parse(contrasteKey)),
    enabled: !!contrasteKey,
    placeholderData: (previo) => previo,
    staleTime: 15_000,
    retry: 1,
  })
  const resultadoDe = (insumoId: string): ContrasteLineaResultado | undefined =>
    contrasteKey ? contraste.find((r) => r.insumo_id === insumoId) : undefined
  const resumenOrden = contrasteKey
    ? resumirContraste(contraste.filter((r) => lineasContraste.some((l) => l.insumo_id === r.insumo_id)))
    : null

  const variedadesPlan = variedadesSel.filter((v) => v !== SIN_VARIEDAD)
  const anterior = periodo ? mesAnterior(periodo) : null
  const { data: avanceMes = [], isError: errorAvance } = useQuery({
    queryKey: ['plan-avance', periodo?.temporada, periodo?.mes],
    queryFn: () => getAvance(periodo?.temporada ?? temporada, periodo?.mes),
    enabled: !!periodo && variedadesPlan.length > 0,
    staleTime: 30_000,
  })
  const { data: avanceAnterior = [] } = useQuery({
    queryKey: ['plan-avance', anterior?.temporada, anterior?.mes],
    queryFn: () => getAvance(anterior?.temporada ?? temporada, anterior?.mes),
    enabled: !!anterior && variedadesPlan.length > 0,
    staleTime: 30_000,
  })
  const faltantesDe = (items: AvanceItem[]) =>
    items.filter((i) => variedadesPlan.includes(i.variedad) && (i.estado === 'pendiente' || i.estado === 'bajo'))
  const insumosEnOrden = new Set((lineasW ?? []).map((l) => l.insumo_id).filter(Boolean))

  function agregarDesdePlan(item: AvanceItem) {
    const actuales = getValues('lineas')
    const ultimaCarencia = [...actuales].reverse().find((l) => l.dias_carencia !== '')?.dias_carencia ?? ''
    const ultimoReingreso = [...actuales].reverse().find((l) => l.dias_reingreso !== '')?.dias_reingreso ?? ''
    const nueva: LineaForm = {
      ...lineaVacia(ultimaCarencia, ultimoReingreso),
      insumo_id: item.insumo_id,
      insumo_nombre: item.insumo_nombre,
      unidad: item.unidad ?? '',
      dosis_por_ha: String(Math.round(dosisFaltante(item) * 10000) / 10000),
    }
    // The empty first line the form starts with is replaced, not kept.
    if (actuales.length === 1 && !actuales[0].insumo_id) update(0, nueva)
    else append(nueva)
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function onSubmit(data: FormValues) {
    setSubmitError(null)
    const parcelaIds = repaso ? [repaso.parcela_id] : Array.from(new Set(seleccionadas))
    if (parcelaIds.length === 0) {
      setSubmitError('Elegí al menos una parcela.')
      return
    }

    let valvulaIds: string[] | undefined
    if (repaso) {
      valvulaIds = [repaso.valvula_id]
    } else if (valvulasModo) {
      const elegidas = new Set(valvulasSel)
      valvulaIds = valvulas.filter((v) => elegidas.has(v.id) && parcelaIds.includes(v.parcela_id)).map((v) => v.id)
      // Backend rule: with explicit valves every parcel needs at least one.
      const sinValvula = parcelaIds.filter((pid) => !valvulas.some((v) => v.parcela_id === pid && elegidas.has(v.id)))
      if (sinValvula.length) {
        const nombres = sinValvula.map((pid) => parcelaById.get(pid)?.nombre ?? pid).join(', ')
        setSubmitError(
          `Con válvulas elegidas, cada parcela necesita al menos una: ${nombres}. Elegí sus válvulas, destildalas o desactivá "Elegir válvulas".`,
        )
        return
      }
    }

    const lineas: OrdenAplicacionLineaCreate[] = data.lineas.map((l) => ({
      insumo_id: l.insumo_id,
      dosis_por_ha: Number(l.dosis_por_ha),
      dias_carencia: Number(l.dias_carencia),
      dias_reingreso: Number(l.dias_reingreso),
    }))
    // Never send `variedad`: explicit parcels may span several varieties.
    const body: OrdenAplicacionUpdate = {
      objetivo: data.objetivo.trim(),
      fecha_planificada: data.fecha_planificada,
      notas: data.notas?.trim() || null,
      lineas,
      parcela_ids: parcelaIds,
      valvula_ids: valvulaIds,
    }

    try {
      if (orden) {
        await actualizarOrden(orden.id, body)
      } else {
        await crearOrden({ ...body, temporada })
        if (repaso) {
          await revisarValvula(repaso.id)
          queryClient.invalidateQueries({ queryKey: A_REVISAR_QUERY_KEY })
        }
      }
      queryClient.invalidateQueries({ queryKey: ['ordenes-aplicacion', temporada] })
      queryClient.invalidateQueries({ queryKey: ['plan-avance'] })
      onSuccess()
    } catch (e: unknown) {
      setSubmitError(apiErrorMessage(e, orden ? 'Error al guardar la orden.' : 'Error al crear la orden.'))
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {(
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>Objetivo / Plaga</label>
              <input type="text" placeholder="Ej: Curación tintos" {...register('objetivo')} className={field} />
              {errors.objetivo && <p className={err}>{errors.objetivo.message}</p>}
            </div>
            <div>
              <label className={label}>Fecha planificada</label>
              <input type="date" {...register('fecha_planificada')} className={field} data-testid="fecha-planificada" />
              {errors.fecha_planificada && <p className={err}>{errors.fecha_planificada.message}</p>}
            </div>
          </div>
          {/* Products */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700">Productos (dosis por ha)</span>
              <button
                type="button"
                onClick={agregarProducto}
                data-testid="agregar-producto"
                className="inline-flex items-center gap-1 text-xs font-medium text-[#7a1f2c] hover:underline"
              >
                <Plus size={13} /> Agregar producto
              </button>
            </div>
            {resumenOrden && (
              <p
                data-testid="resumen-plan"
                className={`mb-2 inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${RESUMEN_ESTILO[resumenOrden].clase}`}
              >
                {RESUMEN_ESTILO[resumenOrden].texto}
              </p>
            )}
            <div className="space-y-2">
              {fields.map((f, i) => {
                const l = lineasW?.[i] ?? f
                const e = errors.lineas?.[i]
                const unidad = unidadDe(l)
                return (
                  <div key={f.id} className="rounded-md border border-gray-200 p-2.5" data-testid="linea-producto">
                    <div className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-start">
                      <div className="col-span-2 sm:col-span-5">
                        <label className={labelSm}>Producto</label>
                        <InsumoSelect
                          value={l.insumo_nombre}
                          insumoId={l.insumo_id || undefined}
                          onChange={(nombre, insumoId, insumo) => {
                            setValue(`lineas.${i}.insumo_nombre`, nombre)
                            setValue(`lineas.${i}.insumo_id`, insumoId ?? '', { shouldValidate: !!insumoId })
                            setValue(`lineas.${i}.unidad`, insumo?.unidad ?? '')
                          }}
                          className={fieldSm}
                          error={e?.insumo_id?.message}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={labelSm}>Dosis {unidad ? `(${unidad}/ha)` : '/ha'}</label>
                        <input type="number" step="any" min="0" inputMode="decimal" {...register(`lineas.${i}.dosis_por_ha`)} className={fieldSm} />
                        {e?.dosis_por_ha && <p className={err}>{e.dosis_por_ha.message}</p>}
                      </div>
                      <div className="sm:col-span-2">
                        <label className={labelSm}>Carencia (días)</label>
                        <input
                          type="number" min="0" step="1" inputMode="numeric"
                          {...register(`lineas.${i}.dias_carencia`, {
                            onChange: (ev) => propagarDias('dias_carencia', i, ev.target.value),
                          })}
                          className={fieldSm}
                        />
                        {e?.dias_carencia && <p className={err}>{e.dias_carencia.message}</p>}
                      </div>
                      <div className="sm:col-span-2">
                        <label className={labelSm}>Reingreso (días)</label>
                        <input
                          type="number" min="0" step="1" inputMode="numeric"
                          {...register(`lineas.${i}.dias_reingreso`, {
                            onChange: (ev) => propagarDias('dias_reingreso', i, ev.target.value),
                          })}
                          className={fieldSm}
                        />
                        {e?.dias_reingreso && <p className={err}>{e.dias_reingreso.message}</p>}
                      </div>
                      <div className="col-span-2 sm:col-span-1 flex sm:justify-center sm:pt-5">
                        <button
                          type="button"
                          onClick={() => remove(i)}
                          disabled={fields.length === 1}
                          aria-label={`Quitar ${l.insumo_nombre || 'producto'}`}
                          className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <ContrasteLinea
                      resultado={resultadoDe(l.insumo_id)} insumoNombre={l.insumo_nombre} unidad={unidad}
                      mes={periodo?.mes ?? null} cargando={contrasteCargando}
                    />
                  </div>
                )
              })}
            </div>
            {errors.lineas?.root?.message && <p className={err}>{errors.lineas.root.message}</p>}
            {errors.lineas?.message && <p className={err}>{errors.lineas.message}</p>}
            {fields.length > 1 && (
              <p className="mt-1 text-[11px] text-gray-400">
                La carencia y el reingreso que escribas se copian a los productos que todavía no editaste.
              </p>
            )}
          </div>

          {/* Parcels */}
          {repaso ? (
            <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
              Repaso de la válvula <strong>{repaso.valvula_nombre}</strong> de {repaso.parcela_nombre}. Al crear la orden,
              queda marcada como revisada.
            </p>
          ) : (
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-sm font-medium text-gray-700">Variedades y parcelas</span>
                <span className="text-xs text-gray-500" data-testid="resumen-parcelas">
                  {seleccionadas.length} {seleccionadas.length === 1 ? 'parcela' : 'parcelas'} · {formatNum(haSeleccionadas, 2)} ha
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {variedadesDisponibles.map((v) => {
                  const activa = variedadesSel.includes(v)
                  return (
                    <button
                      key={v || 'sin-variedad'}
                      type="button"
                      onClick={() => toggleVariedad(v)}
                      aria-pressed={activa}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        activa
                          ? 'bg-[#7a1f2c] text-white border-[#7a1f2c]'
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {variedadLabel(v)}
                    </button>
                  )
                })}
              </div>

              {grupos.length === 0 ? (
                <p className="text-xs text-gray-400 border border-dashed border-gray-300 rounded-md px-3 py-3 text-center">
                  Elegí una o más variedades.
                </p>
              ) : (
                <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-72 overflow-y-auto">
                  {grupos.map((g) => {
                    const ids = g.parcelas.map((p) => p.id)
                    const marcadas = ids.filter((id) => seleccionadas.includes(id)).length
                    return (
                      <div key={g.variedad || 'sin-variedad'} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-gray-800">
                            {variedadLabel(g.variedad)}{' '}
                            <span className="font-normal text-gray-400">{marcadas}/{ids.length}</span>
                          </span>
                          <span className="flex gap-2 text-[11px]">
                            <button type="button" onClick={() => setGrupo(ids, true)} className="text-[#7a1f2c] hover:underline">Todas</button>
                            <button type="button" onClick={() => setGrupo(ids, false)} className="text-gray-500 hover:underline">Ninguna</button>
                          </span>
                        </div>
                        {g.parcelas.length === 0 && <p className="text-xs text-gray-400">Sin parcelas activas para esta variedad.</p>}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                          {g.parcelas.map((p) => {
                            const checked = seleccionadas.includes(p.id)
                            const vs = valvulasPorParcela.get(p.id) ?? []
                            return (
                              <div key={p.id} className="text-sm">
                                <label className="flex items-center gap-2 text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(ev) => toggleParcela(p.id, ev.target.checked)}
                                  />
                                  <span className="truncate">{p.nombre}</span>
                                  {p.superficie_ha != null && (
                                    <span className="text-[11px] text-gray-400 shrink-0">{formatNum(p.superficie_ha, 2)} ha</span>
                                  )}
                                  {!p.is_active && (
                                    <span className="text-[10px] font-medium text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded shrink-0">
                                      inactiva
                                    </span>
                                  )}
                                </label>
                                {valvulasModo && checked && (
                                  <div className="ml-6 mt-1 mb-1 flex flex-wrap gap-1">
                                    {vs.length === 0 && <span className="text-[11px] text-red-600">Sin válvulas</span>}
                                    {vs.map((v) => {
                                      const on = valvulasSel.includes(v.id)
                                      return (
                                        <button
                                          key={v.id}
                                          type="button"
                                          aria-pressed={on}
                                          onClick={() =>
                                            setValvulasSel(on ? valvulasSel.filter((x) => x !== v.id) : [...valvulasSel, v.id])
                                          }
                                          className={`px-1.5 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                                            on
                                              ? 'bg-[#7a1f2c]/10 text-[#7a1f2c] border-[#7a1f2c]/40'
                                              : 'bg-white text-gray-400 border-gray-200 hover:text-gray-600'
                                          }`}
                                        >
                                          {v.nombre}
                                        </button>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {valvulas.length > 0 && (
                <label className="mt-2 flex items-center gap-2 text-sm text-gray-700 w-fit">
                  <input
                    type="checkbox"
                    checked={valvulasModo}
                    onChange={(ev) => toggleValvulasModo(ev.target.checked)}
                    data-testid="elegir-valvulas"
                  />
                  Elegir válvulas (si no, la orden incluye todas las de cada parcela)
                </label>
              )}
              {ordenConValvulasPuntuales && !valvulasModo && (
                <p className="mt-1 text-[11px] text-gray-500">
                  Esta orden tiene válvulas puntuales: se mantienen salvo que actives &quot;Elegir válvulas&quot;.
                </p>
              )}
            </div>
          )}

          {variedadesPlan.length > 0 && periodo && (
            <div className="space-y-2" data-testid="pendiente-plan">
              {errorAvance && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  No se pudo cargar el avance del plan; podés crear la orden igual.
                </p>
              )}
              <PendientePlan
                titulo={`Pendiente del plan de ${MESES[periodo.mes - 1]}`}
                items={faltantesDe(avanceMes)} enOrden={insumosEnOrden} onAgregar={agregarDesdePlan}
                vacio="El plan de este mes está al día para las variedades elegidas."
              />
              {anterior && faltantesDe(avanceAnterior).length > 0 && (
                <PendientePlan
                  titulo={`Quedó pendiente de ${MESES[anterior.mes - 1]}`}
                  items={faltantesDe(avanceAnterior)} enOrden={insumosEnOrden} onAgregar={agregarDesdePlan}
                  vacio=""
                />
              )}
            </div>
          )}

          <div>
            <label className={label}>Notas (opcional)</label>
            <textarea rows={2} {...register('notas')} className={field} />
          </div>

          {submitError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md" data-testid="error-orden">{submitError}</p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              data-testid="guardar-orden"
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 transition-colors"
            >
              {isSubmitting && <Loader2 size={14} className="animate-spin" />}
              {orden ? 'Guardar cambios' : 'Crear orden'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
