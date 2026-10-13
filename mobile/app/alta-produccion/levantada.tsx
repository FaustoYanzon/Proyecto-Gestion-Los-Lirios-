// Levantada de pasa: la pasa seca sale del pasero en bines/bolsones que se suman
// al lote abierto (de esa variedad y calidad) hasta completarlo. Cada bin se pesa
// real y recibe su tarja (la genera el backend). El depósito es único: no se elige.
// Solo encargado o superior. Requiere conexión (el backend valida la uva
// disponible del pasero en cada bin y no deduplica).
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { useRouter } from 'expo-router'
import { ICONS, ICON_STROKE } from '../../lib/icons'
import { colors } from '../../lib/theme'
import { useAuthStore } from '../../store/authStore'
import { Wizard, type WizardStep } from '../../components/Wizard'
import SelectField, { type SelectOption } from '../../components/SelectField'
import { VARIEDAD_LABELS } from '../../lib/types'
import type { Parcela, VariedadUva } from '../../lib/types'
import {
  VARIEDADES, puedeAltaProduccion, fmtKg, hoyISO, kgValido, kgToString, errorDetail,
  getLotesPasa, getLotePasa, abrirLotePasa, agregarBinPasa, getStockPasero, getParametros, getPaseros,
  type LotePasa, type ParametrosProduccion, type StockPaseroItem,
} from '../../lib/altaProduccion'

const loteNombre = (l: LotePasa) =>
  `${VARIEDAD_LABELS[l.variedad] ?? l.variedad} C${l.calidad} · N° ${l.numero}`

// ── Estado del formulario ─────────────────────────────────────────────────────

interface LevantadaForm {
  variedad: VariedadUva | ''
  calidad: 1 | 2
  pasero_id: string
  kg: string
}

const emptyForm = (): LevantadaForm => ({ variedad: '', calidad: 1, pasero_id: '', kg: '' })

interface Ctx {
  lotes: LotePasa[]
  paseros: Parcela[]
  parametros: ParametrosProduccion | null
  recargar: () => Promise<void>
}

const LevantadaCtx = createContext<Ctx>({ lotes: [], paseros: [], parametros: null, recargar: async () => {} })

const loteAbierto = (lotes: LotePasa[], f: LevantadaForm): LotePasa | null =>
  f.variedad === '' ? null : lotes.find((l) => l.variedad === f.variedad && l.calidad === f.calidad) ?? null

const kgNum = (t: string): number => Number(t.trim().replace(',', '.'))

// ── Pasos ─────────────────────────────────────────────────────────────────────

type StepProps = { value: LevantadaForm; onChange: (next: LevantadaForm) => void }

function PasoLote({ value, onChange }: StepProps) {
  const { lotes, recargar } = useContext(LevantadaCtx)
  const [abriendo, setAbriendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lote = loteAbierto(lotes, value)

  const variedadOpts: SelectOption[] = VARIEDADES.map((v) => ({ value: v, label: VARIEDAD_LABELS[v] }))

  async function abrir() {
    if (value.variedad === '') return
    setAbriendo(true)
    setError(null)
    try {
      await abrirLotePasa({ variedad: value.variedad, calidad: value.calidad })
      await recargar()
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      setAbriendo(false)
    }
  }

  return (
    <View>
      <SelectField
        label="Variedad *"
        value={value.variedad}
        options={variedadOpts}
        placeholder="Elegí la variedad"
        onChange={(v) => onChange({ ...value, variedad: v as VariedadUva })}
      />
      <Text style={styles.fieldLabel}>CALIDAD</Text>
      <View style={styles.chipGroup}>
        <Chip label="1 · Buena" active={value.calidad === 1} onPress={() => onChange({ ...value, calidad: 1 })} />
        <Chip label="2 · Mala" active={value.calidad === 2} onPress={() => onChange({ ...value, calidad: 2 })} />
      </View>

      {value.variedad !== '' && (lote ? (
        <View style={styles.loteBox}>
          <Text style={styles.loteBoxTitle}>Lote abierto · {loteNombre(lote)}</Text>
          <Text style={styles.loteBoxText}>
            {lote.cantidad_bines}{lote.tope_bines != null ? ` de ${lote.tope_bines}` : ''} bines · {fmtKg(lote.kg_total)} kg
          </Text>
          {lote.tope_bines != null && (
            <View style={styles.barra}>
              <View style={[styles.barraFill, { width: `${Math.min(100, (lote.cantidad_bines / lote.tope_bines) * 100)}%` }]} />
            </View>
          )}
        </View>
      ) : (
        <View style={styles.previewBox}>
          <Text style={styles.previewText}>
            No hay un lote abierto de {VARIEDAD_LABELS[value.variedad]} calidad {value.calidad}.
          </Text>
          <TouchableOpacity
            style={[styles.abrirBtn, abriendo && { opacity: 0.6 }]}
            onPress={abrir}
            disabled={abriendo}
            activeOpacity={0.85}
          >
            {abriendo
              ? <ActivityIndicator color={colors.blanco} size="small" />
              : <Text style={styles.abrirBtnText}>Abrir lote</Text>}
          </TouchableOpacity>
        </View>
      ))}
      {error && <Text style={styles.errorInline}>{error}</Text>}
    </View>
  )
}

function PasoBin({ value, onChange }: StepProps) {
  const { paseros, parametros } = useContext(LevantadaCtx)
  const [stock, setStock] = useState<StockPaseroItem[]>([])

  // Uva disponible del pasero elegido (para avisar antes de que el backend rechace).
  useEffect(() => {
    if (!value.pasero_id) { setStock([]); return }
    let cancel = false
    getStockPasero(value.pasero_id)
      .then((s) => { if (!cancel) setStock(s) })
      .catch(() => { if (!cancel) setStock([]) })
    return () => { cancel = true }
  }, [value.pasero_id])

  const paseroOpts: SelectOption[] = paseros.map((p) => ({ value: p.id, label: p.nombre }))
  const nominal = parametros?.kg_nominal_bin ?? null
  const ok = kgValido(value.kg)
  const peso = ok ? kgNum(value.kg) : null
  const dif = peso != null && nominal != null ? peso - nominal : null
  const disponible = value.pasero_id && value.variedad !== ''
    ? stock.find((s) => s.variedad === value.variedad)?.uva_disponible_kg ?? 0
    : null
  // Misma cuenta que el backend: redondeo hacia abajo a 2 decimales.
  const maxima = disponible != null && parametros
    ? Math.floor((disponible / parametros.ratio_uva_pasa) * 100) / 100
    : null
  const excede = maxima != null && peso != null && peso > maxima

  return (
    <View>
      <SelectField
        label="Pasero *"
        value={value.pasero_id}
        options={paseroOpts}
        placeholder="¿De qué pasero sale?"
        emptyText="No hay paseros activos"
        onChange={(id) => onChange({ ...value, pasero_id: id })}
      />

      <Text style={styles.fieldLabel}>PESO REAL DEL BIN (KG) *</Text>
      <TextInput
        style={[styles.input, styles.inputHighlight]}
        value={value.kg}
        onChangeText={(t) => onChange({ ...value, kg: t })}
        placeholder="Lo que marca la báscula"
        placeholderTextColor={colors.niebla}
        keyboardType="decimal-pad"
      />

      <Text style={styles.fieldLabel}>PESO TEÓRICO (KG)</Text>
      <View style={styles.readonlyBox}>
        <Text style={styles.readonlyText}>{nominal != null ? `${fmtKg(nominal)} kg` : 'Cargando…'}</Text>
      </View>
      {dif != null && (
        <Text style={styles.hint}>Diferencia con el teórico: {dif > 0 ? '+' : ''}{fmtKg(dif)} kg</Text>
      )}

      {disponible != null && maxima != null && parametros && (
        <View style={styles.previewBox}>
          <Text style={[styles.previewText, excede && { color: colors.sangre, fontWeight: '700' }]}>
            Uva disponible de {value.variedad !== '' ? VARIEDAD_LABELS[value.variedad] : ''} en este pasero:{' '}
            <Text style={styles.previewValue}>{fmtKg(disponible)} kg</Text>
            {' · '}pasa máxima ({fmtKg(parametros.ratio_uva_pasa)}:1):{' '}
            <Text style={styles.previewValue}>{fmtKg(maxima)} kg</Text>
          </Text>
          {peso != null && !excede && (
            <Text style={styles.previewText}>Va a descontar {fmtKg(peso * parametros.ratio_uva_pasa)} kg de uva.</Text>
          )}
        </View>
      )}
    </View>
  )
}

function PasoConfirmar({ value }: StepProps) {
  const { lotes, paseros, parametros } = useContext(LevantadaCtx)
  const lote = loteAbierto(lotes, value)
  const nominal = parametros?.kg_nominal_bin ?? null
  const peso = kgValido(value.kg) ? kgNum(value.kg) : null
  return (
    <View>
      <View style={styles.resumenCard}>
        <ResumenRow label="Lote" value={lote ? loteNombre(lote) : '–'} />
        <ResumenRow
          label="Bin"
          value={lote ? `${lote.cantidad_bines + 1}${lote.tope_bines != null ? ` de ${lote.tope_bines}` : ''}` : '–'}
        />
        <ResumenRow label="Pasero" value={paseros.find((p) => p.id === value.pasero_id)?.nombre ?? '–'} />
        <ResumenRow label="Peso real" value={peso != null ? `${fmtKg(peso)} kg` : '–'} />
        {nominal != null && <ResumenRow label="Peso teórico" value={`${fmtKg(nominal)} kg`} />}
      </View>
      <View style={styles.previewBox}>
        <Text style={styles.previewValue}>La tarja se genera al confirmar.</Text>
        <Text style={styles.previewText}>
          {lote && lote.tope_bines != null && lote.cantidad_bines + 1 >= lote.tope_bines
            ? 'Con este bin el lote se completa y se cierra solo.'
            : 'Revisá el peso: los bines no se pueden editar después.'}
        </Text>
      </View>
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

// ── Pantalla ──────────────────────────────────────────────────────────────────

interface Resultado { tarja: string; n: number; tope: number | null; cerrado: boolean; form: LevantadaForm }

export default function LevantadaScreen() {
  const router = useRouter()
  const role = useAuthStore((s) => s.user?.role)

  const [lotes, setLotes] = useState<LotePasa[]>([])
  const [paseros, setPaseros] = useState<Parcela[]>([])
  const [parametros, setParametros] = useState<ParametrosProduccion | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [modalVisible, setModalVisible] = useState(false)
  const [inicial, setInicial] = useState<LevantadaForm>(emptyForm())
  const [pasoInicial, setPasoInicial] = useState(0)
  const [wizardKey, setWizardKey] = useState(0)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const submittingRef = useRef(false)

  const recargar = useCallback(async () => {
    setLoadError(null)
    try {
      const [ls, pas, par] = await Promise.all([getLotesPasa('abierto'), getPaseros(), getParametros()])
      setLotes(ls)
      setPaseros(pas)
      setParametros(par)
    } catch (e) {
      setLoadError(errorDetail(e, 'No se pudieron cargar los datos'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { recargar() }, [recargar])

  function abrirWizard(desde: LevantadaForm, paso = 0) {
    setInicial(desde)
    setPasoInicial(paso)
    setWizardKey((k) => k + 1)
    setResultado(null)
    recargar() // lotes y parámetros al día (el lote pudo cerrarse desde otro lado)
    setModalVisible(true)
  }

  function cerrarModal() {
    setModalVisible(false)
    setResultado(null)
  }

  const pasos: WizardStep<LevantadaForm>[] = [
    {
      title: '¿Qué pasa levantás?',
      Component: PasoLote,
      canAdvance: (f) => loteAbierto(lotes, f) != null,
    },
    {
      title: '¿De qué pasero y cuánto pesa?',
      Component: PasoBin,
      canAdvance: (f) => f.pasero_id !== '' && kgValido(f.kg),
    },
    {
      title: 'Confirmá la levantada',
      Component: PasoConfirmar,
      canAdvance: () => true,
    },
  ]

  async function confirmar(form: LevantadaForm): Promise<void> {
    const lote = loteAbierto(lotes, form)
    if (!lote) throw new Error('No hay un lote abierto de esa variedad y calidad')
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      const actualizado = await agregarBinPasa(lote.id, {
        pasero_id: form.pasero_id, kg_real: kgToString(form.kg), fecha: hoyISO(),
      })
      // La tarja la genera el backend: es la del último bin del lote.
      const detalle = await getLotePasa(lote.id)
      setResultado({
        tarja: detalle.bines[detalle.bines.length - 1]?.tarja ?? '–',
        n: actualizado.cantidad_bines,
        tope: actualizado.tope_bines,
        cerrado: actualizado.estado === 'cerrado',
        form,
      })
      await recargar()
    } catch (e) {
      throw new Error(errorDetail(e))
    } finally {
      submittingRef.current = false
    }
  }

  if (!puedeAltaProduccion(role)) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No tenés acceso a esta sección</Text>
      </View>
    )
  }

  const ctx: Ctx = { lotes, paseros, parametros, recargar }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); recargar() }} tintColor={colors.tierra} />}
      >
        <TouchableOpacity style={styles.cta} onPress={() => abrirWizard(emptyForm())} activeOpacity={0.85}>
          <ICONS.agregar size={22} color={colors.blanco} strokeWidth={ICON_STROKE} />
          <Text style={styles.ctaText}>Levantar un bin</Text>
        </TouchableOpacity>

        {loadError && (
          <View style={styles.errorBox}><Text style={styles.errorText}>{loadError}</Text></View>
        )}

        <Text style={styles.sectionLabel}>LOTES ABIERTOS</Text>
        {loading ? (
          <ActivityIndicator color={colors.tierra} style={{ marginTop: 16 }} />
        ) : lotes.length === 0 ? (
          <Text style={styles.muted}>No hay lotes abiertos. Se abren al empezar a levantar.</Text>
        ) : (
          lotes.map((l) => (
            <TouchableOpacity
              key={l.id}
              style={styles.card}
              activeOpacity={0.8}
              // Atajo: arranca con variedad y calidad de este lote, en el paso del pasero.
              onPress={() => abrirWizard({ ...emptyForm(), variedad: l.variedad, calidad: l.calidad === 2 ? 2 : 1 }, 1)}
            >
              <Text style={styles.cardTitle}>{loteNombre(l)}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.kgText}>{fmtKg(l.kg_total)} kg</Text>
                <Text style={styles.metaText}>
                  {l.cantidad_bines}{l.tope_bines != null ? ` / ${l.tope_bines}` : ''} bines
                </Text>
              </View>
              {l.tope_bines != null && (
                <View style={styles.barra}>
                  <View style={[styles.barraFill, { width: `${Math.min(100, (l.cantidad_bines / l.tope_bines) * 100)}%` }]} />
                </View>
              )}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={cerrarModal}>
        {resultado ? (
          // ── Éxito ──
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Bin registrado</Text>
              <TouchableOpacity onPress={cerrarModal} style={styles.closeBtn}>
                <ICONS.cerrar size={20} color={colors.ink} strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
            </View>
            <View style={styles.successBox}>
              <Text style={styles.muted}>Tarja</Text>
              <Text style={styles.tarjaGrande}>{resultado.tarja}</Text>
              <Text style={styles.successText}>
                Lote: {resultado.n}{resultado.tope != null ? ` de ${resultado.tope}` : ''} bines
              </Text>
              {resultado.cerrado && (
                <Text style={styles.muted}>El lote se completó y quedó cerrado.</Text>
              )}
            </View>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelBtn} onPress={cerrarModal}>
                <Text style={styles.cancelBtnText}>Terminar</Text>
              </TouchableOpacity>
              {!resultado.cerrado && (
                <TouchableOpacity
                  style={styles.saveBtn}
                  // Mismo lote y pasero; falta solo el peso del próximo bin.
                  onPress={() => abrirWizard({ ...resultado.form, kg: '' }, 1)}
                >
                  <Text style={styles.saveBtnText}>Otro bin</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          <LevantadaCtx.Provider value={ctx}>
            <Wizard<LevantadaForm>
              key={wizardKey}
              headerTitle="Levantar pasa"
              initialValue={inicial}
              initialStep={pasoInicial}
              steps={pasos}
              onConfirm={confirmar}
              onCancel={cerrarModal}
              confirmLabel="✓ Registrar bin"
            />
          </LevantadaCtx.Provider>
        )}
      </Modal>
    </View>
  )
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  content: { padding: 16, paddingBottom: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.hueso },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 20, marginBottom: 10,
  },
  muted: { fontSize: 13, color: colors.ink60 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.ink60 },
  errorBox: { backgroundColor: '#fdf0f1', borderRadius: 10, padding: 12, marginVertical: 8 },
  errorText: { fontSize: 13, color: colors.sangre, fontWeight: '600' },
  errorInline: { fontSize: 13, color: colors.sangre, fontWeight: '600', marginTop: 8 },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    minHeight: 56, borderRadius: 14, backgroundColor: colors.burdeos[600],
  },
  ctaText: { fontSize: 16, fontWeight: '800', color: colors.blanco },

  card: {
    backgroundColor: colors.blanco, borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kgText: { fontSize: 20, fontWeight: '800', color: colors.ink },
  metaText: { fontSize: 12, color: colors.ink60 },
  barra: { height: 6, borderRadius: 3, backgroundColor: colors.hueso, marginTop: 10, overflow: 'hidden' },
  barraFill: { height: 6, borderRadius: 3, backgroundColor: colors.burdeos[600] },

  // Pantalla de éxito
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
    flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 28, backgroundColor: colors.blanco,
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
  successBox: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 8 },
  tarjaGrande: { fontSize: 24, fontWeight: '900', color: colors.burdeos[600], letterSpacing: 0.5, textAlign: 'center' },
  successText: { fontSize: 18, fontWeight: '700', color: colors.verdeCampo },

  // Pasos del wizard
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },
  input: {
    height: 52, backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.borde,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 14,
  },
  inputHighlight: { borderColor: colors.burdeos[600], borderWidth: 2, fontWeight: '700' },
  hint: { fontSize: 12, color: colors.ink60, marginTop: -6, marginBottom: 14 },
  previewBox: { backgroundColor: colors.crema, borderRadius: 12, padding: 12, marginBottom: 14, gap: 4 },
  previewText: { fontSize: 13, color: colors.ink60 },
  previewValue: { fontWeight: '800', color: colors.ink, fontSize: 13 },
  readonlyBox: {
    minHeight: 52, justifyContent: 'center', borderRadius: 12, paddingHorizontal: 14, marginBottom: 14,
    backgroundColor: colors.hueso, borderWidth: 1, borderColor: colors.borde,
  },
  readonlyText: { fontSize: 16, color: colors.ink60, fontWeight: '600' },

  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5,
    borderColor: colors.borde, backgroundColor: colors.blanco,
  },
  chipActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  chipTextActive: { color: colors.blanco },

  loteBox: { backgroundColor: '#fdf3dc', borderRadius: 12, padding: 12, marginBottom: 14, gap: 4 },
  loteBoxTitle: { fontSize: 14, fontWeight: '800', color: '#8a5a2b' },
  loteBoxText: { fontSize: 13, color: '#8a5a2b' },
  abrirBtn: {
    marginTop: 8, height: 44, borderRadius: 10, backgroundColor: colors.burdeos[600],
    justifyContent: 'center', alignItems: 'center',
  },
  abrirBtnText: { fontSize: 14, fontWeight: '700', color: colors.blanco },

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
})
