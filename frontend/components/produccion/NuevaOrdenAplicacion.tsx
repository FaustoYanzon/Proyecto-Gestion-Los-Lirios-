'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useFieldArray, useForm, useWatch, type Resolver } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react'
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
import { getRondasPendientes, type RondaPendiente } from '@/lib/api/planFitosanitario'
import { VARIEDAD_LABELS, type ParcelaItem } from '@/lib/api/produccion'
import { getInsumos } from '@/lib/api/insumos'
import { getValvulasReales, hoyArgentina, type ValvulaReal } from '@/lib/api/riego'
import InsumoSelect from '@/components/produccion/InsumoSelect'
import RondaCard, { MESES, formatNum, rondaKey } from '@/components/produccion/RondaCard'
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
  // Plan round this line counts against; null = off-plan product.
  numero_aplicacion: z.number().int().nullable(),
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
    dias_carencia: carencia, dias_reingreso: reingreso, numero_aplicacion: null,
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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Campaign runs May→April: months 5-12 belong to `temporada`, 1-4 to the next
// calendar year. Default to today, or to the 1st of the round's month if that
// month has not started yet.
function fechaPorDefecto(mes: number, temporada: number): string {
  const hoy = hoyArgentina()
  const anio = mes >= 5 ? temporada : temporada + 1
  const inicio = `${anio}-${pad2(mes)}-01`
  return hoy < inicio ? inicio : hoy
}

function mesDeFecha(fecha: string): number | null {
  const m = /^\d{4}-(\d{2})-\d{2}$/.exec(fecha)
  return m ? Number(m[1]) : null
}

interface CardParcelaInfo {
  ha_pendientes: number
  parcial: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

type Modo = 'plan' | 'extra'

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
  const esCreacionLibre = !orden && !repaso
  const [modo, setModo] = useState<Modo>('plan')
  const [ronda, setRonda] = useState<RondaPendiente | null>(null)
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

  const { data: rondas = [], isLoading: cargandoRondas, isError: errorRondas } = useQuery({
    queryKey: ['rondas-pendientes', temporada],
    queryFn: () => getRondasPendientes(temporada),
    enabled: esCreacionLibre,
  })

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

  const cardInfo = useMemo(() => {
    if (!ronda) return null
    const map = new Map<string, CardParcelaInfo>()
    for (const v of ronda.variedades) {
      for (const p of v.parcelas) map.set(p.id, { ha_pendientes: Number(p.ha_pendientes), parcial: p.parcial })
    }
    return map
  }, [ronda])

  const defaultValues = useMemo<FormValues>(() => {
    if (orden) {
      const lineas: LineaForm[] = (orden.lineas ?? []).map((l) => ({
        insumo_id: l.insumo_id,
        insumo_nombre: l.insumo_nombre,
        unidad: l.insumo_unidad,
        dosis_por_ha: String(Number(l.dosis_por_ha)),
        dias_carencia: String(l.dias_carencia),
        dias_reingreso: String(l.dias_reingreso),
        numero_aplicacion: l.numero_aplicacion ?? null,
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
      // A rework is an extra order: every line is off-plan (numero_aplicacion
      // null) even if the original counted against a plan round.
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
    register, control, handleSubmit, setValue, getValues, reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as Resolver<FormValues>,
    defaultValues,
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' })

  const lineasW = useWatch({ control, name: 'lineas' })
  const fechaW = useWatch({ control, name: 'fecha_planificada' })

  const unidadDe = (l: LineaForm): string =>
    l.unidad || insumos.find((i) => i.id === l.insumo_id)?.unidad || ''

  // ── Mode / card selection ───────────────────────────────────────────────────

  function limpiarParcelas() {
    setVariedadesSel([])
    setSeleccionadas([])
    setValvulasModo(false)
    setValvulasSel([])
  }

  function cambiarModo(m: Modo) {
    if (m === modo) return
    setModo(m)
    setRonda(null)
    setSubmitError(null)
    limpiarParcelas()
    reset({ objetivo: '', fecha_planificada: hoyArgentina(), notas: '', lineas: [lineaVacia()] })
  }

  function elegirRonda(r: RondaPendiente) {
    setRonda(r)
    setSubmitError(null)
    setVariedadesSel(r.variedades.map((v) => v.variedad))
    // Partly covered parcels come unticked: the order applies every line to
    // every parcel, so forcing them would duplicate the lines already applied.
    setSeleccionadas(r.variedades.flatMap((v) => v.parcelas.filter((p) => !p.parcial).map((p) => p.id)))
    setValvulasModo(false)
    setValvulasSel([])
    reset({
      objetivo: r.objetivo,
      fecha_planificada: fechaPorDefecto(r.mes, temporada),
      notas: '',
      lineas: r.lineas.map((l) => ({
        ...lineaVacia(),
        insumo_id: l.insumo_id,
        insumo_nombre: l.insumo_nombre,
        unidad: l.unidad,
        dosis_por_ha: String(Number(l.dosis_por_ha)),
        numero_aplicacion: r.numero_aplicacion,
      })),
    })
  }

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
    // A product added by hand never counts against a plan round.
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
    const delGrupo = parcelas.filter((p) => p.is_active && (p.variedad ?? SIN_VARIEDAD) === v)
    const card = ronda?.variedades.find((rv) => rv.variedad === v)
    if (card) return card.parcelas.filter((p) => !p.parcial).map((p) => p.id)
    return delGrupo.map((p) => p.id)
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
      numero_aplicacion: l.numero_aplicacion,
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
      queryClient.invalidateQueries({ queryKey: ['rondas-pendientes', temporada] })
      onSuccess()
    } catch (e: unknown) {
      setSubmitError(apiErrorMessage(e, orden ? 'Error al guardar la orden.' : 'Error al crear la orden.'))
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const mostrarFormulario = !esCreacionLibre || modo === 'extra' || ronda !== null
  const mesFecha = mesDeFecha(fechaW ?? '')
  const fueraDeMes = ronda !== null && mesFecha !== null && mesFecha !== ronda.mes

  return (
    <div className="space-y-4">
      {esCreacionLibre && (
        <div role="tablist" aria-label="Origen de la orden" className="inline-flex rounded-md border border-gray-300 p-0.5 bg-gray-50">
          {([
            { value: 'plan', label: 'Del plan' },
            { value: 'extra', label: 'Fuera del plan' },
          ] as const).map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={modo === t.value}
              data-testid={`modo-${t.value}`}
              onClick={() => cambiarModo(t.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${
                modo === t.value ? 'bg-[#7a1f2c] text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {esCreacionLibre && modo === 'plan' && ronda === null && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Elegí una ronda pendiente del plan: se cargan sus productos, dosis, variedades y parcelas.
          </p>
          {cargandoRondas ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Cargando rondas…
            </div>
          ) : errorRondas ? (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">No se pudieron cargar las rondas del plan.</p>
          ) : rondas.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
              No quedan rondas pendientes del plan para esta campaña.
              <button type="button" onClick={() => cambiarModo('extra')} className="block mx-auto mt-2 text-[#7a1f2c] font-medium hover:underline">
                Crear una orden fuera del plan
              </button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {rondas.map((r) => <RondaCard key={rondaKey(r)} ronda={r} onSelect={elegirRonda} />)}
            </div>
          )}
          <div className="flex justify-end pt-2 border-t border-gray-100">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {mostrarFormulario && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {ronda && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-[#7a1f2c]/30 bg-[#fbfaf6] px-3 py-2">
              <p className="text-sm text-gray-700 min-w-0">
                <span className="font-semibold text-gray-900">Ronda Nº{ronda.numero_aplicacion}</span> · {ronda.objetivo} ·{' '}
                {MESES[ronda.mes - 1] ?? `Mes ${ronda.mes}`}
              </p>
              <button
                type="button"
                onClick={() => { setRonda(null); limpiarParcelas() }}
                className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-[#7a1f2c] hover:underline"
              >
                <ArrowLeft size={12} /> Cambiar ronda
              </button>
            </div>
          )}

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
          {fueraDeMes && ronda && (
            <p className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2" data-testid="aviso-mes">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              El plan ubica esta ronda en {MESES[ronda.mes - 1]}; la fecha elegida cae en {MESES[(mesFecha ?? 1) - 1]}. Se puede crear igual.
            </p>
          )}

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
                            const anterior = getValues(`lineas.${i}.insumo_id`)
                            setValue(`lineas.${i}.insumo_nombre`, nombre)
                            setValue(`lineas.${i}.insumo_id`, insumoId ?? '', { shouldValidate: !!insumoId })
                            setValue(`lineas.${i}.unidad`, insumo?.unidad ?? '')
                            // A different product no longer matches the plan round.
                            if ((insumoId ?? '') !== anterior) setValue(`lineas.${i}.numero_aplicacion`, null)
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
                    <p className="mt-1.5 text-[11px]">
                      {l.numero_aplicacion != null ? (
                        <span className="font-medium text-[#7a1f2c]">Cuenta para la ronda Nº{l.numero_aplicacion} del plan</span>
                      ) : (
                        <span className="text-gray-400">Fuera del plan</span>
                      )}
                    </p>
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
                    const enCard = ronda?.variedades.some((rv) => rv.variedad === g.variedad) ?? false
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
                            const info = cardInfo?.get(p.id)
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
                                  {info ? (
                                    <span className="text-[11px] text-gray-400 shrink-0">{formatNum(info.ha_pendientes, 2)} ha pend.</span>
                                  ) : p.superficie_ha != null ? (
                                    <span className="text-[11px] text-gray-400 shrink-0">{formatNum(p.superficie_ha, 2)} ha</span>
                                  ) : null}
                                  {info?.parcial && (
                                    <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">
                                      parcial
                                    </span>
                                  )}
                                  {enCard && !info && p.is_active && (
                                    <span className="text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded shrink-0">
                                      al día
                                    </span>
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
