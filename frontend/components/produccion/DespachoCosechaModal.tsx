'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Printer, CheckCircle2, ChevronDown } from 'lucide-react'
import FormError from '@/components/ui/FormError'
import { getParcelas, formatParcelaLabel } from '@/lib/api/produccion'
import { VARIEDAD_VALUES, VARIEDAD_LABELS, type VariedadUva } from '@/lib/api/parcelas'
import {
  createDespachoCosecha, ENVASE_LABELS, PARA_LABELS,
  type DespachoCosechaResponse, type DespachoCosechaCreate, type OrigenCosecha, type ParaDespacho, type MercadoDespacho, type TipoEnvase,
} from '@/lib/api/cosecha'
import {
  getProductores, getCompradores, getUbicacionesPasero, getParametros, errorDetail, abrirRemitoPdf,
} from '@/lib/api/altaProduccion'
import { useAuthStore } from '@/store/authStore'

const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'
const btnPrimary = 'px-4 py-2 bg-[#7a1f2c] text-white rounded-lg text-sm font-semibold hover:bg-[#5a1320] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
const btnSecondary = 'px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors'

const KG_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const fmtKg = (n: number) => KG_FMT.format(n)
const TODAY = () => new Date().toISOString().split('T')[0]

const labelVariedad = (v: string) => (VARIEDAD_LABELS as Record<string, string>)[v] ?? v

const natural = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true })

const PREFIJO_REMITO: Record<ParaDespacho, string> = { bodega: 'BOD', comprador: 'FRE', pasero: 'TRA' }

function Segmented<T extends string>({
  value, options, onChange,
}: {
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            value === o.value
              ? 'bg-[#7a1f2c] text-white border-[#7a1f2c]'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

interface FormState {
  fecha: string
  origen: OrigenCosecha
  parcela_id: string
  productor_id: string
  variedad: VariedadUva | ''
  para: ParaDespacho
  // Solo "comprador": se elige en cada despacho, sin valor por defecto.
  mercado: MercadoDespacho | ''
  comprador_id: string
  pasero_id: string
  ubicacion_id: string
  carros: number
  carro_incompleto: boolean
  tipo_envase: TipoEnvase
  cantidad_envases: number | null
  peso_unitario_kg: number | null
  bruto_kg: number | null
  tara_kg: number | null
  vehiculo_patente: string
  cuadrilla: string
  acarreo: string
  n_ciu: string
  n_remito: string
  observaciones: string
}

const PESO_VACIO = { cantidad_envases: null, peso_unitario_kg: null, bruto_kg: null, tara_kg: null } as const

function emptyForm(): FormState {
  return {
    fecha: TODAY(), origen: 'propio', parcela_id: '', productor_id: '', variedad: '',
    para: 'bodega', mercado: '', comprador_id: '', pasero_id: '', ubicacion_id: '',
    carros: 1, carro_incompleto: false,
    tipo_envase: 'caja', cantidad_envases: null, peso_unitario_kg: null, bruto_kg: null, tara_kg: null,
    vehiculo_patente: '', cuadrilla: '', acarreo: '', n_ciu: '', n_remito: '', observaciones: '',
  }
}

export default function DespachoCosechaModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(emptyForm)
  // Una sola clave por apertura del modal: si se reintenta tras un error no duplica el despacho.
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<DespachoCosechaResponse | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  // ── Datos maestros ──────────────────────────────────────────────────────────
  const rol = useAuthStore((s) => s.user?.role)
  const puedeVerProductores = rol === 'super_admin' || rol === 'gerencial' || rol === 'encargado'

  const { data: parcelas = [] } = useQuery({ queryKey: ['parcelas'], queryFn: getParcelas, staleTime: 300_000 })
  const { data: productores = [] } = useQuery({
    queryKey: ['ap-productores'], queryFn: () => getProductores(), staleTime: 60_000, enabled: puedeVerProductores,
  })
  const { data: compradores = [] } = useQuery({
    queryKey: ['ap-compradores'], queryFn: () => getCompradores(), staleTime: 60_000,
  })
  const { data: ubicaciones = [] } = useQuery({
    queryKey: ['ap-ubicaciones', form.pasero_id],
    queryFn: () => getUbicacionesPasero(form.pasero_id),
    enabled: form.para === 'pasero' && !!form.pasero_id,
    staleTime: 60_000,
  })
  const { data: parametros } = useQuery({
    queryKey: ['ap-parametros'], queryFn: getParametros, staleTime: 60_000,
    enabled: form.para === 'pasero',
  })

  const parrales = useMemo(
    () => parcelas.filter((p) => p.tipo === 'parral' && p.is_active).sort((a, b) => natural(a.nombre, b.nombre)),
    [parcelas],
  )
  const paseros = useMemo(
    () => parcelas.filter((p) => p.tipo === 'pasero' && p.is_active).sort((a, b) => natural(a.nombre, b.nombre)),
    [parcelas],
  )
  const productoresActivos = useMemo(
    () => productores.filter((p) => p.is_active).sort((a, b) => natural(a.nombre, b.nombre)),
    [productores],
  )
  const compradoresActivos = useMemo(
    () => compradores.filter((c) => c.is_active).sort((a, b) => natural(a.nombre, b.nombre)),
    [compradores],
  )

  const parcela = parrales.find((p) => p.id === form.parcela_id)
  const variedadParral = parcela?.variedad ?? null
  const variedadEfectiva = form.origen === 'propio' ? (variedadParral ?? form.variedad) : form.variedad

  // ── Peso (derivado, no se escribe) ──────────────────────────────────────────
  // Propio -> pasero: entra por carros y se pesa en la báscula (neto = báscula - tara x carros).
  // Resto: chasis se pesa con bruto y tara; cualquier otro envase es cantidad x peso unitario.
  const esPasero = form.para === 'pasero'
  const propioAPasero = form.origen === 'propio' && esPasero
  const esChasis = form.tipo_envase === 'chasis'
  const taraCarros = propioAPasero && parametros ? parametros.tara_carro * form.carros : null
  const round2 = (n: number) => Math.round(n * 100) / 100
  let kgTotal: number | null = null
  if (propioAPasero) {
    if (form.bruto_kg != null && taraCarros != null) kgTotal = round2(form.bruto_kg - taraCarros)
  } else if (esChasis) {
    if (form.bruto_kg != null && form.tara_kg != null) kgTotal = round2(form.bruto_kg - form.tara_kg)
  } else if (form.cantidad_envases != null && form.peso_unitario_kg != null) {
    kgTotal = round2(form.cantidad_envases * form.peso_unitario_kg)
  }

  // ── Cambios con efecto sobre otros campos ──────────────────────────────────
  function cambiarOrigen(o: OrigenCosecha) {
    setForm((f) => ({
      ...f, origen: o, variedad: '', ...PESO_VACIO,
      // Un tercero solo puede ir a pasero.
      para: o === 'tercero' ? 'pasero' : f.para,
    }))
  }
  // Chasis se pesa (bruto/tara); el resto es cantidad x peso unitario: no arrastrar cifras del otro modo.
  function cambiarEnvase(t: TipoEnvase) {
    setForm((f) => ({ ...f, tipo_envase: t, ...((t === 'chasis') !== (f.tipo_envase === 'chasis') ? PESO_VACIO : {}) }))
  }
  function cambiarPara(p: ParaDespacho) {
    setForm((f) => ({ ...f, para: p, mercado: '', comprador_id: '', pasero_id: '', ubicacion_id: '', ...PESO_VACIO }))
  }

  const kgOk = kgTotal != null && kgTotal > 0
  const deOk = form.origen === 'propio'
    ? !!form.parcela_id
    : !!form.productor_id
  const variedadOk = form.origen === 'tercero' ? !!form.variedad : true
  const paraOk = esPasero
    ? !!form.pasero_id
    : !!form.comprador_id && (form.para !== 'comprador' || !!form.mercado)
  const puedeGuardar = !!form.fecha && deOk && variedadOk && paraOk && kgOk && !saving

  const fichasEstimadas = esPasero && form.carro_incompleto && parametros && kgOk && parametros.kg_por_ficha > 0
    ? Math.round((kgTotal as number) / parametros.kg_por_ficha)
    : null

  const compradorNombre = compradoresActivos.find((c) => c.id === form.comprador_id)?.nombre
  const paseroNombre = paseros.find((p) => p.id === form.pasero_id)?.nombre
  const deNombre = form.origen === 'propio'
    ? (parcela ? formatParcelaLabel(parcela.nombre) : null)
    : productoresActivos.find((p) => p.id === form.productor_id)?.nombre ?? null

  async function guardar() {
    if (!puedeGuardar) return
    setSaving(true)
    setError(null)
    try {
      const payload: DespachoCosechaCreate = {
        fecha: form.fecha,
        para: form.para,
        mercado: form.para === 'comprador' && form.mercado ? form.mercado : null,
        origen: form.origen,
        parcela_id: form.origen === 'propio' ? form.parcela_id : null,
        productor_id: form.origen === 'tercero' ? form.productor_id : null,
        // Propio con parral que ya tiene variedad: la define el parral.
        variedad: form.origen === 'propio' && variedadParral ? null : (form.variedad || null),
        comprador_id: esPasero ? null : form.comprador_id,
        pasero_id: esPasero ? form.pasero_id : null,
        ubicacion_id: esPasero ? (form.ubicacion_id || null) : null,
        vehiculo_patente: form.vehiculo_patente.trim() || null,
        cuadrilla: form.cuadrilla.trim() || null,
        acarreo: form.acarreo.trim() || null,
        n_ciu: form.n_ciu.trim() || null,
        n_remito: form.n_remito.trim() || null,
        observaciones: form.observaciones.trim() || null,
        idempotency_key: idempotencyKey,
      }
      if (propioAPasero) {
        // El servidor resta tara_carro x carros al peso de báscula.
        payload.carros = form.carros
        payload.carro_incompleto = form.carro_incompleto
        payload.bruto_kg = form.bruto_kg
      } else if (esChasis) {
        payload.tipo_envase = 'chasis'
        payload.bruto_kg = form.bruto_kg
        payload.tara_kg = form.tara_kg
      } else {
        payload.tipo_envase = form.tipo_envase
        payload.cantidad_envases = form.cantidad_envases
        payload.peso_unitario_kg = form.peso_unitario_kg
      }
      const res = await createDespachoCosecha(payload)
      for (const key of [
        'cosecha-list', 'cosecha-totales', 'cosecha-semanas', 'cosecha-mapa',
        'ap-remitos', 'ap-lotes', 'ap-cosechas-remito', 'ap-cosechas-pasa',
        'ap-stock', 'ap-ingresos',
      ]) {
        qc.invalidateQueries({ queryKey: [key] })
      }
      setResultado(res)
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      setSaving(false)
    }
  }

  async function imprimir(remitoId: string) {
    setPdfError(null)
    try {
      await abrirRemitoPdf(remitoId)
    } catch (e) {
      setPdfError(errorDetail(e, 'No se pudo abrir el PDF del remito'))
    }
  }

  // ── Panel de éxito ──────────────────────────────────────────────────────────
  if (resultado) {
    const r = resultado.remito
    return (
      <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
          <div className="p-6 space-y-4 text-center">
            <CheckCircle2 size={40} className="mx-auto text-green-600" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">Despacho registrado</h2>
              <p className="text-sm text-gray-600 mt-1">
                Remito <b className="font-mono">{r.numero}</b> · {fmtKg(r.kg_total)} kg
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {r.comprador_nombre ?? r.pasero_nombre ?? ''}
                {resultado.ingreso_pasero ? ' · ingreso al pasero registrado' : ''}
              </p>
            </div>
            {pdfError && <FormError description={pdfError} />}
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
            <button onClick={() => imprimir(r.id)} className={`${btnPrimary} flex items-center gap-2`}>
              <Printer size={15} /> Imprimir remito
            </button>
            <button onClick={onClose} className={btnSecondary}>Cerrar</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Formulario ──────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Nuevo despacho</h2>
          <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 1. Fecha */}
          <div className="max-w-xs">
            <label className={labelCls}>Fecha <span className="text-red-500">*</span></label>
            <input type="date" value={form.fecha} onChange={(e) => set('fecha', e.target.value)} className={inputCls} />
          </div>

          {/* 2. DE */}
          <section className="space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">De</p>
            <Segmented
              value={form.origen}
              onChange={cambiarOrigen}
              options={[
                { value: 'propio', label: 'Propio' },
                { value: 'tercero', label: 'Tercero', disabled: !puedeVerProductores },
              ]}
            />
            {form.origen === 'propio' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Parral <span className="text-red-500">*</span></label>
                  <select value={form.parcela_id} onChange={(e) => set('parcela_id', e.target.value)} className={inputCls}>
                    <option value="">— Seleccionar —</option>
                    {parrales.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Variedad</label>
                  {variedadParral ? (
                    <p className="text-sm text-gray-800 py-1.5">{labelVariedad(variedadParral)}</p>
                  ) : (
                    <select value={form.variedad} onChange={(e) => set('variedad', e.target.value as VariedadUva | '')} className={inputCls}>
                      <option value="">{form.parcela_id ? 'El parral no tiene variedad — elegir' : '—'}</option>
                      {VARIEDAD_VALUES.map((v) => <option key={v} value={v}>{VARIEDAD_LABELS[v]}</option>)}
                    </select>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Productor <span className="text-red-500">*</span></label>
                  <select value={form.productor_id} onChange={(e) => set('productor_id', e.target.value)} className={inputCls}>
                    <option value="">— Seleccionar —</option>
                    {productoresActivos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Variedad <span className="text-red-500">*</span></label>
                  <select value={form.variedad} onChange={(e) => set('variedad', e.target.value as VariedadUva | '')} className={inputCls}>
                    <option value="">— Seleccionar —</option>
                    {VARIEDAD_VALUES.map((v) => <option key={v} value={v}>{VARIEDAD_LABELS[v]}</option>)}
                  </select>
                </div>
              </div>
            )}
          </section>

          {/* 3. PARA */}
          <section className="space-y-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Para</p>
            <Segmented
              value={form.para}
              onChange={cambiarPara}
              options={(Object.keys(PARA_LABELS) as ParaDespacho[]).map((k) => ({
                value: k, label: PARA_LABELS[k], disabled: form.origen === 'tercero' && k !== 'pasero',
              }))}
            />
            {form.origen === 'tercero' && (
              <p className="text-xs text-gray-500">La uva de terceros solo puede ir a un pasero.</p>
            )}
            {esPasero ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Pasero <span className="text-red-500">*</span></label>
                  <select
                    value={form.pasero_id}
                    onChange={(e) => setForm((f) => ({ ...f, pasero_id: e.target.value, ubicacion_id: '' }))}
                    className={inputCls}
                  >
                    <option value="">— Seleccionar —</option>
                    {paseros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Ubicación (opcional)</label>
                  <select
                    value={form.ubicacion_id}
                    onChange={(e) => set('ubicacion_id', e.target.value)}
                    disabled={!form.pasero_id}
                    className={inputCls}
                  >
                    <option value="">Sin ubicación</option>
                    {ubicaciones.map((u) => <option key={u.id} value={u.id}>Hilera {u.hilera} · Parte {u.parte}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <div className="max-w-sm">
                <label className={labelCls}>
                  {form.para === 'bodega' ? 'Bodega' : 'Comprador'} <span className="text-red-500">*</span>
                </label>
                <select value={form.comprador_id} onChange={(e) => set('comprador_id', e.target.value)} className={inputCls}>
                  <option value="">— Seleccionar —</option>
                  {compradoresActivos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
                {form.para === 'comprador' && (
                  <div className="mt-3">
                    <label className={labelCls}>Mercado <span className="text-red-500">*</span></label>
                    <Segmented<MercadoDespacho | ''>
                      value={form.mercado}
                      options={[
                        { value: 'interno', label: 'Mercado interno' },
                        { value: 'exportacion', label: 'Exportación' },
                      ]}
                      onChange={(v) => set('mercado', v)}
                    />
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 4. PESO */}
          {propioAPasero ? (
            <section className="space-y-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Carros y peso</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <label className={labelCls}>Carros <span className="text-red-500">*</span></label>
                  <input type="number" min="1" step="1" value={form.carros}
                    onChange={(e) => set('carros', Math.max(1, Math.floor(Number(e.target.value) || 1)))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Peso en báscula (kg) <span className="text-red-500">*</span></label>
                  <input type="number" step="0.1" min="0" value={form.bruto_kg ?? ''}
                    onChange={(e) => set('bruto_kg', e.target.value ? Number(e.target.value) : null)} className={inputCls} />
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 pb-1.5">
                  <input type="checkbox" checked={form.carro_incompleto} onChange={(e) => set('carro_incompleto', e.target.checked)} />
                  El carro no está completo
                </label>
              </div>
              <p className="text-xs text-gray-500">
                {parametros
                  ? <>Tara: {fmtKg(parametros.tara_carro)} kg × {form.carros} carro{form.carros === 1 ? '' : 's'} = {fmtKg(taraCarros as number)} kg. </>
                  : null}
                Kg de uva: <b className={kgOk ? 'text-gray-800' : 'text-gray-400'}>{kgTotal != null ? `${fmtKg(kgTotal)} kg` : '—'}</b>
                {kgTotal != null && kgTotal <= 0 ? <span className="text-red-600"> (la báscula debe superar la tara)</span> : null}
              </p>
              {form.carro_incompleto && (
                <p className="text-xs text-gray-600">
                  {fichasEstimadas != null
                    ? <>Fichas estimadas ≈ <b>{fichasEstimadas}</b> ({fmtKg(kgTotal as number)} kg ÷ {fmtKg(parametros!.kg_por_ficha)} kg por ficha). </>
                    : null}
                  No se calcula merma.
                </p>
              )}
            </section>
          ) : (
            <section className="space-y-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Peso</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
                <div className="col-span-2 md:col-span-1">
                  <label className={labelCls}>Tipo de envase</label>
                  <select value={form.tipo_envase} onChange={(e) => cambiarEnvase(e.target.value as TipoEnvase)} className={inputCls}>
                    {(Object.entries(ENVASE_LABELS) as [TipoEnvase, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                {esChasis ? (
                  <>
                    <div>
                      <label className={labelCls}>Bruto kg <span className="text-red-500">*</span></label>
                      <input type="number" step="0.1" min="0" value={form.bruto_kg ?? ''}
                        onChange={(e) => set('bruto_kg', e.target.value ? Number(e.target.value) : null)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Tara kg <span className="text-red-500">*</span></label>
                      <input type="number" step="0.1" min="0" value={form.tara_kg ?? ''}
                        onChange={(e) => set('tara_kg', e.target.value ? Number(e.target.value) : null)} className={inputCls} />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className={labelCls}>Cantidad <span className="text-red-500">*</span></label>
                      <input type="number" step="0.5" min="0" value={form.cantidad_envases ?? ''}
                        onChange={(e) => set('cantidad_envases', e.target.value ? Number(e.target.value) : null)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Peso unitario kg <span className="text-red-500">*</span></label>
                      <input type="number" step="0.1" min="0" value={form.peso_unitario_kg ?? ''}
                        onChange={(e) => set('peso_unitario_kg', e.target.value ? Number(e.target.value) : null)} className={inputCls} />
                    </div>
                  </>
                )}
                <div className="col-span-2 md:col-span-1">
                  <label className={labelCls}>Kg total</label>
                  <p className="rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-800">
                    {kgTotal != null ? fmtKg(kgTotal) : '—'}
                  </p>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                {esChasis ? 'El chasis se pesa: kg total = bruto − tara.' : 'Kg total = cantidad × peso unitario.'}
              </p>
            </section>
          )}

          {/* 5. Transporte y observaciones (opcional) */}
          <details className="group rounded-lg border border-gray-200">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700">
              <span>Transporte y observaciones <span className="text-xs font-normal text-gray-400">(opcional)</span></span>
              <ChevronDown size={16} className="text-gray-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 pb-4">
              <div>
                <label className={labelCls}>Vehículo / patente</label>
                <input type="text" maxLength={20} value={form.vehiculo_patente} onChange={(e) => set('vehiculo_patente', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Cuadrilla</label>
                <input type="text" maxLength={150} value={form.cuadrilla} onChange={(e) => set('cuadrilla', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Acarreo</label>
                <input type="text" maxLength={150} value={form.acarreo} onChange={(e) => set('acarreo', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>N° CIU / Guía Única</label>
                <input type="text" maxLength={50} value={form.n_ciu} onChange={(e) => set('n_ciu', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>N° de remito en papel</label>
                <input type="text" maxLength={50} value={form.n_remito} onChange={(e) => set('n_remito', e.target.value)} className={inputCls} />
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>Observaciones</label>
                <textarea rows={2} maxLength={500} value={form.observaciones} onChange={(e) => set('observaciones', e.target.value)} className={inputCls} />
              </div>
            </div>
          </details>

          {/* 7. Resumen */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">
              Se va a crear: cosecha + remito {PREFIJO_REMITO[form.para]}{esPasero ? ' + ingreso al pasero' : ''}
            </p>
            <p className="text-xs mt-1">
              {kgOk ? `${fmtKg(kgTotal as number)} kg` : 'Sin peso'}
              {variedadEfectiva ? ` de ${labelVariedad(variedadEfectiva)}` : ''}
              {deNombre ? ` · de ${deNombre}` : ''}
              {esPasero
                ? (paseroNombre ? ` → ${paseroNombre}` : '')
                : (compradorNombre ? ` → ${compradorNombre}` : '')}
            </p>
          </div>

          {error && <FormError description={error} />}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={!puedeGuardar} className={btnPrimary}>
            {saving ? 'Guardando...' : 'Registrar despacho'}
          </button>
        </div>
      </div>
    </div>
  )
}
