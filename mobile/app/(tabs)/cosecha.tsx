// Cosecha: listado + despacho "De -> Para" por pasos (cosecha + remito BOD/FRE/TRA
// + ingreso al pasero en una sola transacción). Acá viven también los accesos de
// Alta de producción (ingresos al pasero, lotes de pasa). Solo encargado o
// superior (el backend responde 403 a regador/obrero). Requiere conexión.
//
// Al pasero la uva entra únicamente en carros, de a uno: se declara el peso real
// del carro en la báscula y la app resta la tara (parámetro del sistema).
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Modal,
  FlatList,
  TextInput,
} from 'react-native'
import { useRouter } from 'expo-router'
import { ICONS, ICON_STROKE } from '../../lib/icons'
import { colors } from '../../lib/theme'
import { getCosechas, deleteCosecha } from '../../lib/api'
import { newIdempotencyKey } from '../../lib/idempotency'
import { useAuthStore } from '../../store/authStore'
import { Wizard, type WizardStep } from '../../components/Wizard'
import SelectField, { type SelectOption } from '../../components/SelectField'
import {
  VARIEDADES, puedeAltaProduccion, fmtKg, hoyISO, kgToString, errorDetail,
  getProductores, getCompradores, getParametros, getPaseros, getParrales, getUbicacionesPasero,
  createDespachoCosecha, abrirRemitoPdf, PARA_LABELS, ENVASE_LABELS, PREFIJO_REMITO, MERCADO_LABELS,
  type Productor, type Comprador, type ParametrosProduccion, type UbicacionPasero,
  type ParaDespacho, type MercadoDespacho, type TipoEnvaseDespacho, type DespachoCosechaResultado, type OrigenIngreso,
} from '../../lib/altaProduccion'
import type { RegistroCosecha, VariedadUva, Parcela } from '../../lib/types'
import { DESTINO_LABELS, DESTINO_COLORS, VARIEDAD_LABELS } from '../../lib/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const nowInit = new Date()
const TEMPORADA = nowInit.getMonth() >= 4 ? nowInit.getFullYear() : nowInit.getFullYear() - 1

const PARA_OPTIONS = Object.keys(PARA_LABELS) as ParaDespacho[]
const ENVASE_OPTIONS = Object.entries(ENVASE_LABELS) as [TipoEnvaseDespacho, string][]
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/

function fmtFecha(iso: string): string {
  return iso.split('-').reverse().join('/')
}

// Texto -> número (acepta coma); null si vacío o inválido.
function parseNum(t: string): number | null {
  const n = parseFloat(t.trim().replace(',', '.'))
  return t.trim() === '' || isNaN(n) ? null : n
}

const redondear = (n: number): number => Math.round(n * 100) / 100

// ── Estado del formulario ─────────────────────────────────────────────────────

interface DespachoForm {
  fecha: string
  origen: OrigenIngreso
  parcela_id: string
  productor_id: string
  variedad: VariedadUva | ''
  para: ParaDespacho
  // Solo "Uva en fresco": se elige en cada despacho, sin valor por defecto.
  mercado: MercadoDespacho | ''
  comprador_id: string
  pasero_id: string
  ubicacion_id: string
  // Pasero: peso real del carro en la báscula (la tara se resta aparte).
  peso_carro: string
  carro_incompleto: boolean
  // Bodega / uva en fresco.
  tipo_envase: TipoEnvaseDespacho
  cantidad_envases: string
  peso_unitario_kg: string
  bruto_kg: string
  tara_kg: string
  kg_total: string
  vehiculo_patente: string
  cuadrilla: string
  acarreo: string
  n_ciu: string
  n_remito: string
  observaciones: string
}

function emptyForm(): DespachoForm {
  return {
    fecha: hoyISO(), origen: 'propio', parcela_id: '', productor_id: '', variedad: '',
    para: 'bodega', mercado: '', comprador_id: '', pasero_id: '', ubicacion_id: '',
    peso_carro: '', carro_incompleto: false,
    tipo_envase: 'caja', cantidad_envases: '', peso_unitario_kg: '', bruto_kg: '', tara_kg: '', kg_total: '',
    vehiculo_patente: '', cuadrilla: '', acarreo: '', n_ciu: '', n_remito: '', observaciones: '',
  }
}

// kg_total se autocompleta desde envases (cantidad x peso unitario) o bruto - tara.
function conPeso(
  form: DespachoForm,
  field: 'cantidad_envases' | 'peso_unitario_kg' | 'bruto_kg' | 'tara_kg',
  value: string,
): DespachoForm {
  const next = { ...form, [field]: value }
  if (field === 'cantidad_envases' || field === 'peso_unitario_kg') {
    const c = parseNum(next.cantidad_envases)
    const p = parseNum(next.peso_unitario_kg)
    if (c != null && p != null && c > 0 && p > 0) next.kg_total = String(redondear(c * p))
  } else {
    const b = parseNum(next.bruto_kg)
    const t = parseNum(next.tara_kg)
    if (b != null && t != null && b > t) next.kg_total = String(redondear(b - t))
  }
  return next
}

// ── Maestros (contexto para los pasos del wizard) ─────────────────────────────

interface Maestros {
  parrales: Parcela[]
  paseros: Parcela[]
  productores: Productor[]
  compradores: Comprador[]
  parametros: ParametrosProduccion | null
}

const MaestrosCtx = createContext<Maestros>({
  parrales: [], paseros: [], productores: [], compradores: [], parametros: null,
})

function variedadDe(p: Parcela | undefined): VariedadUva | '' {
  return p?.variedad && VARIEDADES.includes(p.variedad) ? p.variedad : ''
}

// kg de uva netos de un carro: peso en báscula - tara. null si no hay peso válido.
function kgNetoCarro(f: DespachoForm, tara: number): number | null {
  const bruto = parseNum(f.peso_carro)
  if (bruto == null || bruto <= tara) return null
  return redondear(bruto - tara)
}

// ── Pasos del wizard ──────────────────────────────────────────────────────────

type StepProps = { value: DespachoForm; onChange: (next: DespachoForm) => void }

function PasoDe({ value, onChange }: StepProps) {
  const { parrales, productores } = useContext(MaestrosCtx)
  const parral = parrales.find((p) => p.id === value.parcela_id)
  const variedadParral = variedadDe(parral)

  function elegirOrigen(origen: OrigenIngreso) {
    if (origen === value.origen) return
    onChange({
      ...value, origen, parcela_id: '', productor_id: '', variedad: '',
      // Un tercero solo puede ir a un pasero.
      para: origen === 'tercero' ? 'pasero' : value.para,
      comprador_id: origen === 'tercero' ? '' : value.comprador_id,
      mercado: origen === 'tercero' ? '' : value.mercado,
    })
  }

  const parralOpts: SelectOption[] = parrales.map((p) => ({
    value: p.id, label: p.nombre, sub: variedadDe(p) ? VARIEDAD_LABELS[variedadDe(p) as VariedadUva] : undefined,
  }))
  const prodOpts: SelectOption[] = productores.map((p) => ({ value: p.id, label: p.nombre }))
  const variedadOpts: SelectOption[] = VARIEDADES.map((v) => ({ value: v, label: VARIEDAD_LABELS[v] }))

  return (
    <View>
      <Text style={styles.fieldLabel}>FECHA *</Text>
      <TextInput
        style={styles.input}
        value={value.fecha}
        onChangeText={(t) => onChange({ ...value, fecha: t })}
        placeholder="AAAA-MM-DD"
        placeholderTextColor={colors.niebla}
        keyboardType="numeric"
      />

      <Text style={styles.fieldLabel}>ORIGEN</Text>
      <View style={styles.chipGroup}>
        <Chip label="Propio" active={value.origen === 'propio'} onPress={() => elegirOrigen('propio')} />
        <Chip label="Tercero" active={value.origen === 'tercero'} onPress={() => elegirOrigen('tercero')} />
      </View>

      {value.origen === 'propio' ? (
        <>
          <SelectField
            label="Parral *"
            value={value.parcela_id}
            options={parralOpts}
            placeholder="Elegí el parral"
            emptyText="No hay parrales activos"
            onChange={(id) => onChange({ ...value, parcela_id: id, variedad: variedadDe(parrales.find((p) => p.id === id)) })}
          />
          {parral && variedadParral !== '' && (
            <View style={styles.previewBox}>
              <Text style={styles.previewText}>
                Variedad: <Text style={styles.previewValue}>{VARIEDAD_LABELS[variedadParral]}</Text> (según el parral)
              </Text>
            </View>
          )}
          {parral && variedadParral === '' && (
            <SelectField
              label="Variedad * (el parral no la tiene cargada)"
              value={value.variedad}
              options={variedadOpts}
              placeholder="Elegí la variedad"
              onChange={(v) => onChange({ ...value, variedad: v as VariedadUva })}
            />
          )}
        </>
      ) : (
        <>
          <SelectField
            label="Productor *"
            value={value.productor_id}
            options={prodOpts}
            placeholder="Elegí el productor"
            emptyText="No hay productores cargados (se dan de alta desde la web)"
            onChange={(id) => onChange({ ...value, productor_id: id })}
          />
          <SelectField
            label="Variedad *"
            value={value.variedad}
            options={variedadOpts}
            placeholder="Elegí la variedad"
            onChange={(v) => onChange({ ...value, variedad: v as VariedadUva })}
          />
        </>
      )}
    </View>
  )
}

// De y Para van juntos: un solo paso con la ruta de la uva.
function PasoRuta(props: StepProps) {
  return (
    <View>
      <Text style={styles.sectionLabel}>DE</Text>
      <PasoDe {...props} />
      <Text style={[styles.sectionLabel, { marginTop: 6 }]}>PARA</Text>
      <PasoPara {...props} />
    </View>
  )
}

function puedeDe(f: DespachoForm, parrales: Parcela[]): boolean {
  if (!FECHA_REGEX.test(f.fecha)) return false
  if (f.origen === 'propio') {
    if (!f.parcela_id) return false
    return f.variedad !== '' || variedadDe(parrales.find((p) => p.id === f.parcela_id)) !== ''
  }
  return f.productor_id !== '' && f.variedad !== ''
}

function PasoPara({ value, onChange }: StepProps) {
  const { paseros, compradores } = useContext(MaestrosCtx)
  const [ubicaciones, setUbicaciones] = useState<UbicacionPasero[]>([])
  const esPasero = value.para === 'pasero'

  // Ubicaciones del pasero elegido.
  useEffect(() => {
    if (!esPasero || !value.pasero_id) { setUbicaciones([]); return }
    let cancel = false
    getUbicacionesPasero(value.pasero_id)
      .then((u) => { if (!cancel) setUbicaciones(u) })
      .catch(() => { if (!cancel) setUbicaciones([]) })
    return () => { cancel = true }
  }, [esPasero, value.pasero_id])

  function elegirPara(para: ParaDespacho) {
    if (para === value.para) return
    onChange({ ...value, para, mercado: '', comprador_id: '', pasero_id: '', ubicacion_id: '' })
  }

  const paseroOpts: SelectOption[] = paseros.map((p) => ({ value: p.id, label: p.nombre }))
  const compOpts: SelectOption[] = compradores.map((c) => ({ value: c.id, label: c.nombre }))
  const ubicOpts: SelectOption[] = ubicaciones.map((u) => ({ value: u.id, label: `Hilera ${u.hilera} · Parte ${u.parte}` }))

  return (
    <View>
      <View style={styles.chipGroup}>
        {PARA_OPTIONS.map((k) => (
          <Chip
            key={k}
            label={PARA_LABELS[k]}
            active={value.para === k}
            disabled={value.origen === 'tercero' && k !== 'pasero'}
            onPress={() => elegirPara(k)}
          />
        ))}
      </View>
      {value.origen === 'tercero' && (
        <Text style={[styles.muted, { marginBottom: 14 }]}>La uva de terceros solo puede ir a un pasero.</Text>
      )}

      {esPasero ? (
        <>
          <SelectField
            label="Pasero *"
            value={value.pasero_id}
            options={paseroOpts}
            placeholder="Elegí el pasero"
            emptyText="No hay paseros activos"
            onChange={(id) => onChange({ ...value, pasero_id: id, ubicacion_id: '' })}
          />
          {value.pasero_id !== '' && ubicOpts.length > 0 && (
            <SelectField
              label="Ubicación (opcional)"
              value={value.ubicacion_id}
              options={ubicOpts}
              placeholder="Sin ubicación"
              clearLabel="Sin ubicación"
              onChange={(id) => onChange({ ...value, ubicacion_id: id })}
            />
          )}
        </>
      ) : (
        <SelectField
          label={value.para === 'bodega' ? 'Bodega *' : 'Comprador *'}
          value={value.comprador_id}
          options={compOpts}
          placeholder={value.para === 'bodega' ? 'Elegí la bodega' : 'Elegí el comprador'}
          emptyText="No hay compradores cargados"
          onChange={(id) => onChange({ ...value, comprador_id: id })}
        />
      )}

      {value.para === 'comprador' && (
        <>
          <Text style={styles.fieldLabel}>MERCADO *</Text>
          <View style={styles.chipGroup}>
            {(['interno', 'exportacion'] as MercadoDespacho[]).map((m) => (
              <Chip
                key={m}
                label={MERCADO_LABELS[m]}
                active={value.mercado === m}
                onPress={() => onChange({ ...value, mercado: m })}
              />
            ))}
          </View>
        </>
      )}
    </View>
  )
}

const puedePara = (f: DespachoForm): boolean =>
  f.para === 'pasero'
    ? f.pasero_id !== ''
    : f.comprador_id !== '' && (f.para !== 'comprador' || f.mercado !== '')

function PasoPeso({ value, onChange }: StepProps) {
  const { parametros } = useContext(MaestrosCtx)

  // ── Pasero: un carro, peso real en báscula, tara fija ──
  if (value.para === 'pasero') {
    const tara = parametros?.tara_carro ?? null
    const neto = tara != null ? kgNetoCarro(value, tara) : null
    const fichas = value.carro_incompleto && neto != null && parametros && parametros.kg_por_ficha > 0
      ? Math.max(1, Math.round(neto / parametros.kg_por_ficha))
      : null
    return (
      <View>
        <View style={styles.previewBox}>
          <Text style={styles.previewText}>La uva entra al pasero de a <Text style={styles.previewValue}>1 carro</Text>.</Text>
        </View>

        <Text style={styles.fieldLabel}>PESO DEL CARRO EN BÁSCULA (KG) *</Text>
        <TextInput
          style={[styles.input, styles.inputHighlight]}
          value={value.peso_carro}
          onChangeText={(t) => onChange({ ...value, peso_carro: t })}
          placeholder="Peso real del carro cargado"
          placeholderTextColor={colors.niebla}
          keyboardType="decimal-pad"
        />

        <Text style={styles.fieldLabel}>TARA DEL CARRO (KG)</Text>
        <View style={styles.readonlyBox}>
          <Text style={styles.readonlyText}>{tara != null ? `− ${fmtKg(tara)} kg` : 'Cargando…'}</Text>
        </View>

        <Text style={styles.fieldLabel}>KG DE UVA</Text>
        <View style={[styles.readonlyBox, neto != null && styles.readonlyBoxOk]}>
          <Text style={[styles.readonlyText, styles.readonlyTextStrong]}>
            {neto != null ? `${fmtKg(neto)} kg` : '–'}
          </Text>
        </View>
        {tara != null && parseNum(value.peso_carro) != null && neto == null && (
          <Text style={styles.errorInline}>El peso del carro tiene que ser mayor que la tara ({fmtKg(tara)} kg).</Text>
        )}

        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => onChange({ ...value, carro_incompleto: !value.carro_incompleto })}
          activeOpacity={0.7}
        >
          <View style={[styles.checkBox, value.carro_incompleto && styles.checkBoxActive]}>
            {value.carro_incompleto && <Text style={styles.checkMark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>El carro no está completo</Text>
        </TouchableOpacity>
        {value.carro_incompleto && (
          <View style={styles.previewBox}>
            <Text style={styles.previewText}>
              Fichas estimadas por el peso:{' '}
              <Text style={styles.previewValue}>{fichas != null ? `≈ ${fichas}` : '–'}</Text>
              {parametros ? ` (kg ÷ ${fmtKg(parametros.kg_por_ficha)} kg por ficha)` : ''}
            </Text>
            <Text style={styles.previewText}>Con carro incompleto no se calcula merma.</Text>
          </View>
        )}
      </View>
    )
  }

  // ── Bodega / uva en fresco: envases o bruto - tara ──
  return (
    <View>
      <Text style={styles.fieldLabel}>TIPO DE ENVASE</Text>
      <View style={styles.chipGroup}>
        {ENVASE_OPTIONS.map(([k, label]) => (
          <Chip key={k} label={label} active={value.tipo_envase === k} onPress={() => onChange({ ...value, tipo_envase: k })} />
        ))}
      </View>

      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.fieldLabel}>CANTIDAD</Text>
          <TextInput
            style={styles.input}
            value={value.cantidad_envases}
            onChangeText={(t) => onChange(conPeso(value, 'cantidad_envases', t))}
            placeholder="0"
            placeholderTextColor={colors.niebla}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.fieldLabel}>PESO UNIT. KG</Text>
          <TextInput
            style={styles.input}
            value={value.peso_unitario_kg}
            onChangeText={(t) => onChange(conPeso(value, 'peso_unitario_kg', t))}
            placeholder="0"
            placeholderTextColor={colors.niebla}
            keyboardType="decimal-pad"
          />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.fieldLabel}>BRUTO KG</Text>
          <TextInput
            style={styles.input}
            value={value.bruto_kg}
            onChangeText={(t) => onChange(conPeso(value, 'bruto_kg', t))}
            placeholder="Camiones / bins"
            placeholderTextColor={colors.niebla}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.fieldLabel}>TARA KG</Text>
          <TextInput
            style={styles.input}
            value={value.tara_kg}
            onChangeText={(t) => onChange(conPeso(value, 'tara_kg', t))}
            placeholder="0"
            placeholderTextColor={colors.niebla}
            keyboardType="decimal-pad"
          />
        </View>
      </View>

      <Text style={styles.fieldLabel}>KG TOTAL *</Text>
      <TextInput
        style={[styles.input, styles.inputHighlight]}
        value={value.kg_total}
        onChangeText={(t) => onChange({ ...value, kg_total: t })}
        placeholder="Se calcula o se escribe directo"
        placeholderTextColor={colors.niebla}
        keyboardType="decimal-pad"
      />
    </View>
  )
}

function puedePeso(f: DespachoForm, parametros: ParametrosProduccion | null): boolean {
  if (f.para === 'pasero') {
    return parametros != null && kgNetoCarro(f, parametros.tara_carro) != null
  }
  const n = parseNum(f.kg_total)
  return n != null && n > 0 && /^\d+([.,]\d{1,2})?$/.test(f.kg_total.trim())
}

function PasoTransporte({ value, onChange }: StepProps) {
  const set = (k: keyof DespachoForm, v: string) => onChange({ ...value, [k]: v })
  return (
    <View>
      <Text style={[styles.muted, { marginBottom: 14 }]}>Todo es opcional; podés seguir sin completar nada.</Text>
      <Text style={styles.fieldLabel}>VEHÍCULO / PATENTE</Text>
      <TextInput
        style={styles.input}
        value={value.vehiculo_patente}
        onChangeText={(t) => set('vehiculo_patente', t)}
        placeholder="AAA123BB"
        placeholderTextColor={colors.niebla}
        autoCapitalize="characters"
        maxLength={20}
      />
      <Text style={styles.fieldLabel}>CUADRILLA</Text>
      <TextInput
        style={styles.input}
        value={value.cuadrilla}
        onChangeText={(t) => set('cuadrilla', t)}
        placeholder="Nombre de cuadrilla"
        placeholderTextColor={colors.niebla}
        autoCapitalize="words"
        maxLength={150}
      />
      <Text style={styles.fieldLabel}>ACARREO</Text>
      <TextInput
        style={styles.input}
        value={value.acarreo}
        onChangeText={(t) => set('acarreo', t)}
        placeholderTextColor={colors.niebla}
        autoCapitalize="words"
        maxLength={150}
      />
      <Text style={styles.fieldLabel}>N° CIU / GUÍA ÚNICA</Text>
      <TextInput
        style={styles.input}
        value={value.n_ciu}
        onChangeText={(t) => set('n_ciu', t)}
        placeholderTextColor={colors.niebla}
        maxLength={50}
      />
      <Text style={styles.fieldLabel}>N° DE REMITO EN PAPEL</Text>
      <TextInput
        style={styles.input}
        value={value.n_remito}
        onChangeText={(t) => set('n_remito', t)}
        placeholderTextColor={colors.niebla}
        maxLength={50}
      />
      <Text style={styles.fieldLabel}>OBSERVACIONES</Text>
      <TextInput
        style={[styles.input, styles.inputMultiline]}
        value={value.observaciones}
        onChangeText={(t) => set('observaciones', t)}
        placeholder="Observaciones opcionales..."
        placeholderTextColor={colors.niebla}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
        maxLength={500}
      />
    </View>
  )
}

function ResumenRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.resumenRow}>
      <Text style={styles.resumenLabel}>{label}</Text>
      <Text style={styles.resumenValue}>{value}</Text>
    </View>
  )
}

function PasoConfirmar({ value }: StepProps) {
  const { parrales, paseros, productores, compradores, parametros } = useContext(MaestrosCtx)
  const esPasero = value.para === 'pasero'
  const variedad = value.variedad || variedadDe(parrales.find((p) => p.id === value.parcela_id))
  const de = value.origen === 'propio'
    ? parrales.find((p) => p.id === value.parcela_id)?.nombre ?? '–'
    : `Tercero: ${productores.find((p) => p.id === value.productor_id)?.nombre ?? '–'}`
  const para = esPasero
    ? paseros.find((p) => p.id === value.pasero_id)?.nombre ?? '–'
    : compradores.find((c) => c.id === value.comprador_id)?.nombre ?? '–'
  const kg = esPasero
    ? (parametros ? kgNetoCarro(value, parametros.tara_carro) : null)
    : parseNum(value.kg_total)

  return (
    <View>
      <View style={styles.resumenCard}>
        <ResumenRow label="Fecha" value={fmtFecha(value.fecha)} />
        <ResumenRow label="De" value={de} />
        <ResumenRow label="Variedad" value={variedad ? VARIEDAD_LABELS[variedad] : '–'} />
        <ResumenRow label="Para" value={`${PARA_LABELS[value.para]} · ${para}`} />
        {value.para === 'comprador' && value.mercado !== '' ? (
          <ResumenRow label="Mercado" value={MERCADO_LABELS[value.mercado]} />
        ) : null}
        {esPasero ? (
          <>
            <ResumenRow label="Carro" value={`1 carro${value.carro_incompleto ? ' (incompleto)' : ''}`} />
            <ResumenRow label="Peso en báscula" value={`${fmtKg(parseNum(value.peso_carro) ?? 0)} kg`} />
            <ResumenRow label="Tara" value={parametros ? `− ${fmtKg(parametros.tara_carro)} kg` : '–'} />
          </>
        ) : null}
        <ResumenRow label="Kg de uva" value={kg != null ? `${fmtKg(kg)} kg` : '–'} />
      </View>
      <View style={styles.previewBox}>
        <Text style={styles.previewValue}>
          Se va a crear: cosecha + remito {PREFIJO_REMITO[value.para]}{esPasero ? ' + ingreso al pasero' : ''}
        </Text>
        <Text style={styles.previewText}>Revisá los datos: los remitos no se pueden anular.</Text>
      </View>
    </View>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function CosechaScreen() {
  const router = useRouter()
  const role = useAuthStore((s) => s.user?.role)
  const puedeDespachar = puedeAltaProduccion(role)

  const [registros, setRegistros] = useState<RegistroCosecha[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [modalVisible, setModalVisible] = useState(false)
  // Formulario de arranque del wizard (vacío, o el anterior al cargar otro carro).
  const [inicial, setInicial] = useState<DespachoForm>(emptyForm())
  const [wizardKey, setWizardKey] = useState(0)
  const [pasoInicial, setPasoInicial] = useState(0)
  const submittingRef = useRef(false)
  // Una clave por envío: si se reintenta tras un error de red no duplica el despacho.
  const idempotencyKeyRef = useRef(newIdempotencyKey())
  const [resultado, setResultado] = useState<{ res: DespachoCosechaResultado; form: DespachoForm } | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [abriendoPdf, setAbriendoPdf] = useState(false)

  // Maestros
  const [maestros, setMaestros] = useState<Maestros>({
    parrales: [], paseros: [], productores: [], compradores: [], parametros: null,
  })

  // ── Data ────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      const data = await getCosechas({ temporada: TEMPORADA, limit: 10 })
      setRegistros(data)
    } catch {
      Alert.alert('Error', 'No se pudieron cargar los registros')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { if (puedeDespachar) fetchData(); else setLoading(false) }, [fetchData, puedeDespachar])

  // Maestros (todos requieren encargado o superior). Cada uno falla por separado.
  // Se recargan al montar y cada vez que se abre el formulario: la pestaña queda
  // montada y un comprador / productor dado de alta en la web no aparecería.
  const cargarMaestros = useCallback(() => {
    const merge = (patch: Partial<Maestros>) => setMaestros((prev) => ({ ...prev, ...patch }))
    getParrales().then((parrales) => merge({ parrales })).catch(() => { /* sin lista no se puede elegir parral */ })
    getPaseros().then((paseros) => merge({ paseros })).catch(() => { /* idem pasero */ })
    getProductores().then((ps) => merge({ productores: ps.filter((p) => p.is_active) })).catch(() => { /* idem */ })
    getCompradores().then((cs) => merge({ compradores: cs.filter((c) => c.is_active) })).catch(() => { /* idem */ })
    getParametros().then((parametros) => merge({ parametros })).catch(() => { /* sin tara no se puede pesar un carro */ })
  }, [])

  useEffect(() => { if (puedeDespachar) cargarMaestros() }, [puedeDespachar, cargarMaestros])

  function onRefresh() {
    setRefreshing(true)
    fetchData()
  }

  // ── Wizard ──────────────────────────────────────────────────────────────────

  function abrirWizard(desde: DespachoForm, paso = 0) {
    setInicial(desde)
    setPasoInicial(paso)
    cargarMaestros()
    setWizardKey((k) => k + 1)
    setResultado(null)
    setPdfError(null)
    idempotencyKeyRef.current = newIdempotencyKey()
    setModalVisible(true)
  }

  function closeModal() {
    setModalVisible(false)
    setResultado(null)
  }

  // Pasos según el destino: bodega / uva en fresco suman "transporte y observaciones".
  function pasosPara(form: DespachoForm): WizardStep<DespachoForm>[] {
    const pasos: WizardStep<DespachoForm>[] = [
      {
        title: '¿De dónde a dónde va la uva?',
        Component: PasoRuta,
        canAdvance: (f) => puedeDe(f, maestros.parrales) && puedePara(f),
      },
      {
        title: form.para === 'pasero' ? '¿Cuánto pesa el carro?' : '¿Cuánto pesa?',
        Component: PasoPeso,
        canAdvance: (f) => puedePeso(f, maestros.parametros),
      },
    ]
    if (form.para !== 'pasero') {
      pasos.push({
        title: 'Transporte y observaciones',
        Component: PasoTransporte,
        canAdvance: () => true,
      })
    }
    pasos.push({
      title: 'Confirmá el despacho',
      Component: PasoConfirmar,
      canAdvance: () => true,
    })
    return pasos
  }

  async function confirmar(form: DespachoForm): Promise<void> {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      const esPasero = form.para === 'pasero'
      const parral = maestros.parrales.find((p) => p.id === form.parcela_id)
      const variedadDelParral = variedadDe(parral) !== ''
      const tara = maestros.parametros?.tara_carro ?? 0
      const cant = parseNum(form.cantidad_envases)
      const pesoU = parseNum(form.peso_unitario_kg)
      const bruto = parseNum(form.bruto_kg)
      const taraKg = parseNum(form.tara_kg)
      const usaEnvases = cant != null && pesoU != null

      const res = await createDespachoCosecha({
        fecha: form.fecha,
        para: form.para,
        mercado: form.para === 'comprador' && form.mercado !== '' ? form.mercado : null,
        origen: form.origen,
        parcela_id: form.origen === 'propio' ? form.parcela_id : null,
        productor_id: form.origen === 'tercero' ? form.productor_id : null,
        // Propio con parral que ya tiene variedad: la define el parral.
        variedad: form.origen === 'propio' && variedadDelParral ? null : (form.variedad || null),
        comprador_id: esPasero ? null : form.comprador_id,
        pasero_id: esPasero ? form.pasero_id : null,
        ubicacion_id: esPasero ? (form.ubicacion_id || null) : null,
        ...(esPasero
          ? {
              // Siempre de a 1 carro. Propio: la tara la descuenta el servidor;
              // tercero: se manda explícita (misma tara del parámetro).
              carros: 1,
              carro_incompleto: form.carro_incompleto,
              bruto_kg: Number(kgToString(form.peso_carro)),
              ...(form.origen === 'tercero' ? { tara_kg: tara } : {}),
            }
          : {
              kg_total: Number(kgToString(form.kg_total)),
              ...(usaEnvases ? { tipo_envase: form.tipo_envase, cantidad_envases: cant, peso_unitario_kg: pesoU } : {}),
              ...(bruto != null && taraKg != null ? { bruto_kg: bruto, tara_kg: taraKg } : {}),
              vehiculo_patente: form.vehiculo_patente.trim() || null,
              cuadrilla: form.cuadrilla.trim() || null,
              acarreo: form.acarreo.trim() || null,
              n_ciu: form.n_ciu.trim() || null,
              n_remito: form.n_remito.trim() || null,
              observaciones: form.observaciones.trim() || null,
            }),
        idempotency_key: idempotencyKeyRef.current,
      })
      setResultado({ res, form })
      await fetchData()
    } catch (e) {
      // El Wizard muestra el mensaje y deja reintentar (misma idempotency_key).
      throw new Error(errorDetail(e))
    } finally {
      submittingRef.current = false
    }
  }

  async function imprimir(remitoId: string) {
    setPdfError(null)
    setAbriendoPdf(true)
    try {
      await abrirRemitoPdf(remitoId)
    } catch (e) {
      setPdfError(errorDetail(e, 'No se pudo abrir el PDF del remito'))
    } finally {
      setAbriendoPdf(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteCosecha(id)
      setRegistros((prev) => prev.filter((r) => r.id !== id))
    } catch {
      Alert.alert('Error', 'No se pudo eliminar el registro')
    }
  }

  // ── Render item ─────────────────────────────────────────────────────────────

  function renderItem({ item }: { item: RegistroCosecha }) {
    const color = DESTINO_COLORS[item.destino] ?? '#4b5563'
    return (
      <TouchableOpacity
        style={styles.card}
        onLongPress={() => {
          const opciones = []
          if (item.remito_id) {
            opciones.push({ text: 'Imprimir remito', onPress: () => imprimir(item.remito_id as string) })
          }
          opciones.push(
            { text: 'Eliminar', style: 'destructive' as const, onPress: () => handleDelete(item.id) },
            { text: 'Cancelar', style: 'cancel' as const },
          )
          Alert.alert('Opciones', `Registro del ${fmtFecha(item.fecha)}`, opciones)
        }}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.dateText}>{fmtFecha(item.fecha)}</Text>
          <View style={[styles.badge, { backgroundColor: color + '22' }]}>
            <Text style={[styles.badgeText, { color }]}>{DESTINO_LABELS[item.destino]}</Text>
          </View>
        </View>
        <Text style={styles.parcelaText}>
          {item.parcela_nombre ?? 'Sin parcela'}
          {item.variedad ? ` · ${item.variedad}` : ''}
        </Text>
        <View style={styles.cardFooter}>
          <Text style={styles.kgText}>{Number(item.kg_total).toLocaleString('es-AR')} kg</Text>
          {(item.remito_numero ?? item.n_remito) != null && (
            <Text style={styles.remitoText}>Remito {item.remito_numero ?? `#${item.n_remito}`}</Text>
          )}
        </View>
      </TouchableOpacity>
    )
  }

  // ── List header ─────────────────────────────────────────────────────────────

  const totalKg = registros.reduce((s, r) => s + Number(r.kg_total), 0)

  const ListHeader = (
    <View style={styles.listHeader}>
      <Text style={styles.screenTitle}>Cosecha</Text>

      {/* Alta de producción */}
      <TouchableOpacity style={styles.accesoPrincipal} onPress={() => router.push('/alta-produccion/levantada')} activeOpacity={0.85}>
        <ICONS.capas size={22} color={colors.blanco} strokeWidth={ICON_STROKE} />
        <Text style={styles.accesoPrincipalText}>Levantar pasa</Text>
      </TouchableOpacity>
      <View style={styles.accesos}>
        <TouchableOpacity style={styles.acceso} onPress={() => router.push('/alta-produccion/pasero')} activeOpacity={0.85}>
          <ICONS.cosecha size={22} color={colors.tierra} strokeWidth={ICON_STROKE} />
          <Text style={styles.accesoText}>Ingresos al pasero</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.acceso} onPress={() => router.push('/alta-produccion/lotes')} activeOpacity={0.85}>
          <ICONS.capas size={22} color={colors.verdeCampo} strokeWidth={ICON_STROKE} />
          <Text style={styles.accesoText}>Lotes de pasa</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={[styles.acceso, { flex: 0, marginBottom: 12 }]} onPress={() => router.push('/alta-produccion/entrega')} activeOpacity={0.85}>
        <ICONS.completado size={22} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />
        <Text style={styles.accesoText}>Entregar pasa a un comprador</Text>
      </TouchableOpacity>

      {registros.length > 0 && (
        <View style={styles.summaryStrip}>
          <Text style={styles.summaryText}>
            {totalKg.toLocaleString('es-AR')} kg · {registros.length} remitos · Campaña {TEMPORADA}/{TEMPORADA + 1}
          </Text>
        </View>
      )}
      {pdfError && !modalVisible && (
        <View style={[styles.errorBox, { marginHorizontal: 16 }]}>
          <Text style={styles.errorText}>{pdfError}</Text>
        </View>
      )}
    </View>
  )

  const EmptyState = (
    <View style={styles.emptyState}>
      {loading ? (
        <ActivityIndicator size="large" color="#16a34a" />
      ) : (
        <>
          <ICONS.cosecha size={48} color="#d1d5db" strokeWidth={ICON_STROKE} />
          <Text style={styles.emptyTitle}>Sin registros</Text>
          <Text style={styles.emptySubtitle}>Campaña {TEMPORADA}/{TEMPORADA + 1}</Text>
        </>
      )}
    </View>
  )

  if (!puedeDespachar) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No tenés acceso a esta sección</Text>
      </View>
    )
  }

  // ── JSX ──────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      <FlatList
        data={registros}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={EmptyState}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />
        }
      />

      <TouchableOpacity style={styles.fab} onPress={() => abrirWizard(emptyForm())}>
        <ICONS.agregar size={28} color="#fff" strokeWidth={ICON_STROKE} />
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
        {resultado ? (
          // ── Éxito ──
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Despacho registrado</Text>
              <TouchableOpacity onPress={closeModal} style={styles.closeBtn}>
                <ICONS.cerrar size={20} color="#374151" strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
            </View>
            <View style={styles.successBox}>
              <Text style={styles.successTitle}>Remito {resultado.res.remito.numero}</Text>
              <Text style={styles.successText}>{fmtKg(resultado.res.remito.kg_total)} kg</Text>
              <Text style={styles.muted}>
                {resultado.res.remito.comprador_nombre ?? resultado.res.remito.pasero_nombre ?? ''}
                {resultado.res.ingresoPasero ? ' · ingreso al pasero registrado' : ''}
              </Text>
              {pdfError && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{pdfError}</Text>
                </View>
              )}
            </View>
            <View style={styles.modalFooter}>
              {resultado.form.para === 'pasero' ? (
                <TouchableOpacity
                  style={styles.cancelBtn}
                  // Mismo origen y destino; falta solo el peso del próximo carro.
                  onPress={() => abrirWizard({ ...resultado.form, peso_carro: '', carro_incompleto: false }, 1)}
                >
                  <Text style={styles.cancelBtnText}>Otro carro</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
                  <Text style={styles.cancelBtnText}>Cerrar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.saveBtn, abriendoPdf && { opacity: 0.6 }]}
                onPress={() => imprimir(resultado.res.remito.id)}
                disabled={abriendoPdf}
              >
                {abriendoPdf
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.saveBtnText}>Imprimir remito</Text>}
              </TouchableOpacity>
            </View>
            {resultado.form.para === 'pasero' && (
              <TouchableOpacity style={styles.cerrarLink} onPress={closeModal}>
                <Text style={styles.cerrarLinkText}>Terminar</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <MaestrosCtx.Provider value={maestros}>
            <Wizard<DespachoForm>
              key={wizardKey}
              headerTitle="Nuevo despacho"
              initialValue={inicial}
              initialStep={pasoInicial}
              steps={pasosPara}
              onConfirm={confirmar}
              onCancel={closeModal}
              confirmLabel="✓ Registrar despacho"
            />
          </MaestrosCtx.Provider>
        )}
      </Modal>

    </View>
  )
}

// ── Subcomponentes ────────────────────────────────────────────────────────────

function Chip({ label, active, onPress, disabled }: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive, disabled && { opacity: 0.4 }]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f6f8' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.hueso },

  listContent: { paddingBottom: 100 },
  listHeader: { paddingTop: 4 },

  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },

  accesoPrincipal: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 10, minHeight: 56, borderRadius: 12, backgroundColor: colors.verdeCampo,
  },
  accesoPrincipalText: { fontSize: 15, fontWeight: '800', color: colors.blanco },
  accesos: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 12 },
  acceso: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14, minHeight: 56,
    borderWidth: 1, borderColor: colors.borde,
  },
  accesoText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.ink },

  summaryStrip: {
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  summaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#166534',
    textAlign: 'center',
  },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  dateText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  parcelaText: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kgText: { fontSize: 20, fontWeight: '800', color: '#111827' },
  remitoText: { fontSize: 12, color: '#9ca3af' },

  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#9ca3af', marginTop: 12 },
  emptySubtitle: { fontSize: 13, color: '#d1d5db', marginTop: 4 },

  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.burdeos[600],
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.burdeos[600],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },

  // Pantalla de éxito (el formulario usa el Wizard compartido)
  modalContainer: { flex: 1, backgroundColor: colors.hueso, paddingTop: 16 },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.borde,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.crema,
    justifyContent: 'center', alignItems: 'center',
  },
  modalFooter: {
    flexDirection: 'row', gap: 10, padding: 16, backgroundColor: colors.blanco,
    borderTopWidth: 1, borderTopColor: colors.borde,
  },
  cancelBtn: {
    flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.borde,
    justifyContent: 'center', alignItems: 'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: colors.ink60 },
  saveBtn: {
    flex: 2, height: 48, borderRadius: 12, backgroundColor: colors.burdeos[600],
    justifyContent: 'center', alignItems: 'center',
  },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: colors.blanco },
  cerrarLink: { alignItems: 'center', paddingBottom: 24, backgroundColor: colors.blanco },
  cerrarLinkText: { fontSize: 14, fontWeight: '700', color: colors.burdeos[600], padding: 8 },

  // Pasos del wizard
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },
  muted: { fontSize: 13, color: colors.ink60 },
  input: {
    height: 52, backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.borde,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 14,
  },
  inputHighlight: { borderColor: colors.burdeos[600], borderWidth: 2, fontWeight: '700' },
  inputMultiline: { height: 90, paddingTop: 12 },
  row: { flexDirection: 'row', gap: 10 },
  col: { flex: 1 },
  previewBox: { backgroundColor: colors.crema, borderRadius: 12, padding: 12, marginBottom: 14, gap: 2 },
  previewText: { fontSize: 13, color: colors.ink60 },
  previewValue: { fontWeight: '800', color: colors.ink, fontSize: 13 },

  // Casillas de solo lectura (tara, kg de uva): no se pueden editar
  readonlyBox: {
    minHeight: 52, justifyContent: 'center', borderRadius: 12, paddingHorizontal: 14, marginBottom: 14,
    backgroundColor: colors.hueso, borderWidth: 1, borderColor: colors.borde,
  },
  readonlyBoxOk: { backgroundColor: '#eef7ee', borderColor: colors.verdeCampo },
  readonlyText: { fontSize: 16, color: colors.ink60, fontWeight: '600' },
  readonlyTextStrong: { fontSize: 20, fontWeight: '800', color: colors.ink },
  errorInline: { fontSize: 13, color: colors.sangre, fontWeight: '600', marginTop: -6, marginBottom: 14 },

  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5,
    borderColor: colors.borde, backgroundColor: colors.blanco,
  },
  chipActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  chipTextActive: { color: colors.blanco },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, minHeight: 44 },
  checkBox: {
    width: 26, height: 26, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borde,
    backgroundColor: colors.blanco, justifyContent: 'center', alignItems: 'center',
  },
  checkBoxActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  checkMark: { color: colors.blanco, fontSize: 15, fontWeight: '800' },
  checkLabel: { fontSize: 14, fontWeight: '600', color: colors.ink },

  resumenCard: {
    backgroundColor: colors.blanco, borderRadius: 14, borderWidth: 1, borderColor: colors.borde,
    paddingHorizontal: 14, marginBottom: 14,
  },
  resumenRow: {
    flexDirection: 'row', justifyContent: 'space-between', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  resumenLabel: { fontSize: 13, color: colors.ink60 },
  resumenValue: { flexShrink: 1, fontSize: 14, fontWeight: '700', color: colors.ink, textAlign: 'right' },

  errorBox: { backgroundColor: '#fdf0f1', borderRadius: 10, padding: 12, marginVertical: 8 },
  errorText: { fontSize: 13, color: colors.sangre, fontWeight: '600' },

  successBox: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 6 },
  successTitle: { fontSize: 22, fontWeight: '800', color: colors.ink },
  successText: { fontSize: 18, fontWeight: '700', color: colors.verdeCampo },
})
