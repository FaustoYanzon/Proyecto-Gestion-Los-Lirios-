// Ingreso de uva al pasero (báscula -> merma). Solo encargado o superior.
// Requiere conexión: el backend no deduplica este alta, así que no usa la cola
// offline. Remitos, maestros y parámetros se gestionan solo en la web.
import { useState, useEffect, useCallback, useRef } from 'react'
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
import { ICONS, ICON_STROKE } from '../../lib/icons'
import { colors } from '../../lib/theme'
import { useAuthStore } from '../../store/authStore'
import { VARIEDAD_LABELS } from '../../lib/types'
import type { Parcela, VariedadUva } from '../../lib/types'
import {
  VARIEDADES, puedeAltaProduccion, fmtKg, fmtFecha, hoyISO, kgValido, kgToString, errorDetail,
  getIngresosPasero, createIngresoPasero, getStockPasero, getProductores, getParametros,
  getPaseros, getParrales, getCosechasPasa, cosechaLabel,
  type IngresoPasero, type StockPaseroItem, type Productor, type ParametrosProduccion,
  type CosechaPasa, type OrigenIngreso,
} from '../../lib/altaProduccion'

const nowInit = new Date()
const TEMPORADA = nowInit.getMonth() >= 4 ? nowInit.getFullYear() : nowInit.getFullYear() - 1
const RECIENTES = 20

interface FormState {
  fecha: string
  pasero_id: string
  // El origen se elige primero: de él depende qué se pide después.
  origen: OrigenIngreso | ''
  parcela_origen_id: string // parral (solo origen propio); define la variedad
  productor_id: string // solo origen tercero
  variedad: VariedadUva | ''
  cosecha_id: string
  carros: string
  carro_incompleto: boolean
  kg_real: string
  observaciones: string
}

function emptyForm(): FormState {
  return {
    fecha: hoyISO(), pasero_id: '', origen: '', parcela_origen_id: '', productor_id: '',
    variedad: '', cosecha_id: '', carros: '1', carro_incompleto: false, kg_real: '', observaciones: '',
  }
}

export default function PaseroScreen() {
  const role = useAuthStore((s) => s.user?.role)

  const [ingresos, setIngresos] = useState<IngresoPasero[]>([])
  const [stock, setStock] = useState<StockPaseroItem[]>([])
  const [paseros, setPaseros] = useState<Parcela[]>([])
  const [parrales, setParrales] = useState<Parcela[]>([])
  const [productores, setProductores] = useState<Productor[]>([])
  const [parametros, setParametros] = useState<ParametrosProduccion | null>(null)
  const [cosechas, setCosechas] = useState<CosechaPasa[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [modalVisible, setModalVisible] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)

  const nombrePasero = (id: string) => paseros.find((p) => p.id === id)?.nombre ?? '–'
  const nombreProductor = (id: string | null) =>
    id ? productores.find((p) => p.id === id)?.nombre ?? '–' : '–'

  const fetchData = useCallback(async () => {
    setLoadError(null)
    try {
      const [ing, stk, pas, parr, prod, par] = await Promise.all([
        getIngresosPasero(), getStockPasero(), getPaseros(), getParrales(), getProductores(), getParametros(),
      ])
      setIngresos(ing)
      setStock(stk)
      setPaseros(pas)
      setParrales(parr)
      setProductores(prod)
      setParametros(par)
    } catch (e) {
      setLoadError(errorDetail(e, 'No se pudieron cargar los datos'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function onRefresh() {
    setRefreshing(true)
    fetchData()
  }

  async function openModal() {
    setForm(emptyForm())
    setFormError(null)
    setModalVisible(true)
    // Candidatas para vincular: se piden al abrir (no es obligatorio vincular).
    try {
      setCosechas(await getCosechasPasa(TEMPORADA))
    } catch {
      setCosechas([])
    }
  }

  function setField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // Cambiar el origen reinicia lo que depende de él.
  function elegirOrigen(origen: OrigenIngreso) {
    setForm((prev) => prev.origen === origen ? prev : {
      ...prev, origen, parcela_origen_id: '', productor_id: '', variedad: '', cosecha_id: '',
    })
  }

  // En origen propio la variedad la define el parral; si no la tiene cargada
  // (o no es una de la lista) se pide aparte.
  function elegirParral(p: Parcela) {
    const variedad = p.variedad && VARIEDADES.includes(p.variedad) ? p.variedad : ''
    setForm((prev) => ({ ...prev, parcela_origen_id: p.id, variedad, cosecha_id: '' }))
  }

  function elegirProductor(id: string) {
    setForm((prev) => ({ ...prev, productor_id: id, cosecha_id: '' }))
  }

  const parralElegido = parrales.find((p) => p.id === form.parcela_origen_id) ?? null
  const variedadDelParral = !!parralElegido?.variedad && VARIEDADES.includes(parralElegido.variedad)
  // Cosechas candidatas a vincular: solo las del parral / productor elegido.
  const cosechasDelOrigen = cosechas.filter((c) =>
    form.origen === 'propio'
      ? !!form.parcela_origen_id && c.parcela_id === form.parcela_origen_id
      : !!form.productor_id && c.productor_id === form.productor_id,
  )

  // Vista previa: carro completo -> carros x fichas por carro. Carro incompleto:
  // no se sabe cuántas fichas son, se estiman por el peso (kg báscula / kg por ficha).
  const carrosNum = parseInt(form.carros, 10)
  const kgRealNum = Number(form.kg_real.trim().replace(',', '.')) || 0
  const fichasEstimadas = form.carro_incompleto && parametros && kgRealNum > 0
    ? Math.max(1, Math.round(kgRealNum / parametros.kg_por_ficha))
    : null
  const fichasCalc = form.carro_incompleto
    ? fichasEstimadas
    : (parametros && carrosNum > 0 ? carrosNum * parametros.fichas_por_carro : null)
  const kgTeorico = fichasCalc != null && parametros ? fichasCalc * parametros.kg_por_ficha : null
  const merma = !form.carro_incompleto && kgTeorico != null && kgRealNum > 0 ? kgTeorico - kgRealNum : null

  function validar(): string | null {
    if (!form.fecha.match(/^\d{4}-\d{2}-\d{2}$/)) return 'La fecha debe tener formato AAAA-MM-DD'
    if (!form.pasero_id) return 'Elegí a qué pasero ingresa'
    if (!form.origen) return 'Elegí de dónde viene la uva'
    if (form.origen === 'propio' && !form.parcela_origen_id) return 'Elegí el parral de origen'
    if (form.origen === 'tercero' && !form.productor_id) return 'Elegí el productor'
    if (!form.variedad) return 'Elegí la variedad'
    if (!(carrosNum >= 1) || String(carrosNum) !== form.carros.trim()) return 'Carros: entero, mínimo 1'
    if (!kgValido(form.kg_real)) return 'Kg báscula: número positivo con hasta 2 decimales'
    return null
  }

  async function handleSave() {
    if (submittingRef.current) return
    const err = validar()
    if (err || !form.origen || !form.variedad) { setFormError(err ?? 'Completá el formulario'); return }
    submittingRef.current = true
    setSaving(true)
    setFormError(null)
    try {
      await createIngresoPasero({
        fecha: form.fecha,
        pasero_id: form.pasero_id,
        variedad: form.variedad,
        kg_real: kgToString(form.kg_real),
        carros: carrosNum,
        // Carro incompleto: fichas estimadas por peso. Si no, las calcula el backend.
        fichas: form.carro_incompleto ? fichasEstimadas : null,
        origen: form.origen,
        productor_id: form.origen === 'tercero' ? form.productor_id : null,
        parcela_origen_id: form.origen === 'propio' ? form.parcela_origen_id : null,
        cosecha_id: form.cosecha_id || null,
        observaciones: form.observaciones.trim() || null,
      })
      setModalVisible(false)
      await fetchData()
    } catch (e) {
      setFormError(errorDetail(e))
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  if (!puedeAltaProduccion(role)) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No tenés acceso a esta sección</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tierra} />}
      >
        {loadError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={colors.tierra} style={{ marginTop: 24 }} />
        ) : (
          <>
            <Text style={styles.sectionLabel}>UVA DISPONIBLE EN PASERO</Text>
            {stock.filter((s) => s.uva_disponible_kg !== 0).length === 0 ? (
              <Text style={styles.muted}>Sin uva disponible</Text>
            ) : (
              stock.filter((s) => s.uva_disponible_kg !== 0).map((s) => (
                <View key={`${s.pasero_id}-${s.variedad}`} style={styles.stockRow}>
                  <Text style={styles.stockName}>{s.pasero_nombre} · {VARIEDAD_LABELS[s.variedad] ?? s.variedad}</Text>
                  <Text style={styles.stockKg}>{fmtKg(s.uva_disponible_kg)} kg</Text>
                </View>
              ))
            )}

            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>INGRESOS RECIENTES</Text>
            {ingresos.length === 0 ? (
              <Text style={styles.muted}>Todavía no hay ingresos registrados</Text>
            ) : (
              ingresos.slice(0, RECIENTES).map((i) => (
                <View key={i.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.dateText}>{fmtFecha(i.fecha)}</Text>
                    {i.origen === 'tercero' && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>Tercero: {nombreProductor(i.productor_id)}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.cardTitle}>
                    {nombrePasero(i.pasero_id)} · {VARIEDAD_LABELS[i.variedad] ?? i.variedad}
                    {i.parcela_origen_id ? ` · ${parrales.find((p) => p.id === i.parcela_origen_id)?.nombre ?? 'parral'}` : ''}
                  </Text>
                  <View style={styles.cardFooter}>
                    <Text style={styles.kgText}>{fmtKg(i.kg_real)} kg</Text>
                    <Text style={[styles.mermaText, i.merma_kg < 0 && { color: colors.oro }]}>
                      Merma {fmtKg(i.merma_kg)} kg · {i.carros} {i.carros === 1 ? 'carro' : 'carros'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={openModal} activeOpacity={0.85}>
        <ICONS.agregar size={28} color={colors.blanco} strokeWidth={ICON_STROKE} />
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nuevo ingreso al pasero</Text>
            <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
              <ICONS.cerrar size={20} color={colors.ink} strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLabel}>FECHA *</Text>
            <TextInput
              style={styles.input}
              value={form.fecha}
              onChangeText={(t) => setField('fecha', t)}
              placeholder="AAAA-MM-DD"
              placeholderTextColor={colors.niebla}
              keyboardType="numeric"
            />

            <Text style={styles.fieldLabel}>INGRESA A (PASERO) *</Text>
            <View style={styles.chipGroup}>
              {paseros.map((p) => (
                <Chip key={p.id} label={p.nombre} active={form.pasero_id === p.id} onPress={() => setField('pasero_id', p.id)} />
              ))}
              {paseros.length === 0 && <Text style={styles.muted}>No hay paseros activos</Text>}
            </View>

            <Text style={styles.fieldLabel}>DE (ORIGEN DE LA UVA) *</Text>
            <View style={styles.chipGroup}>
              <Chip label="Propio" active={form.origen === 'propio'} onPress={() => elegirOrigen('propio')} />
              <Chip label="Tercero" active={form.origen === 'tercero'} onPress={() => elegirOrigen('tercero')} />
            </View>

            {form.origen === 'propio' && (
              <>
                <Text style={styles.fieldLabel}>PARRAL *</Text>
                <View style={styles.chipGroup}>
                  {parrales.map((p) => (
                    <Chip key={p.id} label={p.nombre} active={form.parcela_origen_id === p.id} onPress={() => elegirParral(p)} />
                  ))}
                  {parrales.length === 0 && <Text style={styles.muted}>No hay parrales activos</Text>}
                </View>
                {parralElegido && variedadDelParral && form.variedad !== '' && (
                  <View style={styles.previewBox}>
                    <Text style={styles.previewText}>
                      Variedad: <Text style={styles.previewValue}>{VARIEDAD_LABELS[form.variedad]}</Text> (según el parral)
                    </Text>
                  </View>
                )}
                {parralElegido && !variedadDelParral && (
                  <>
                    <Text style={styles.fieldLabel}>VARIEDAD * (el parral no la tiene cargada)</Text>
                    <View style={styles.chipGroup}>
                      {VARIEDADES.map((v) => (
                        <Chip key={v} label={VARIEDAD_LABELS[v]} active={form.variedad === v} onPress={() => setField('variedad', v)} />
                      ))}
                    </View>
                  </>
                )}
              </>
            )}

            {form.origen === 'tercero' && (
              <>
                <Text style={styles.fieldLabel}>PRODUCTOR *</Text>
                <View style={styles.chipGroup}>
                  {productores.filter((p) => p.is_active).map((p) => (
                    <Chip key={p.id} label={p.nombre} active={form.productor_id === p.id} onPress={() => elegirProductor(p.id)} />
                  ))}
                  {productores.filter((p) => p.is_active).length === 0 && (
                    <Text style={styles.muted}>No hay productores cargados (se dan de alta desde la web)</Text>
                  )}
                </View>
                {form.productor_id !== '' && (
                  <>
                    <Text style={styles.fieldLabel}>VARIEDAD *</Text>
                    <View style={styles.chipGroup}>
                      {VARIEDADES.map((v) => (
                        <Chip key={v} label={VARIEDAD_LABELS[v]} active={form.variedad === v} onPress={() => setField('variedad', v)} />
                      ))}
                    </View>
                  </>
                )}
              </>
            )}

            <Text style={styles.fieldLabel}>CARROS *</Text>
            <TextInput
              style={styles.input}
              value={form.carros}
              onChangeText={(t) => setField('carros', t)}
              placeholder="1"
              placeholderTextColor={colors.niebla}
              keyboardType="number-pad"
            />

            <TouchableOpacity
              style={styles.checkRow}
              onPress={() => setField('carro_incompleto', !form.carro_incompleto)}
              activeOpacity={0.7}
            >
              <View style={[styles.checkBox, form.carro_incompleto && styles.checkBoxActive]}>
                {form.carro_incompleto && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <Text style={styles.checkLabel}>El carro no está completo</Text>
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>KG BÁSCULA *</Text>
            <TextInput
              style={[styles.input, styles.inputHighlight]}
              value={form.kg_real}
              onChangeText={(t) => setField('kg_real', t)}
              placeholder="0"
              placeholderTextColor={colors.niebla}
              keyboardType="decimal-pad"
            />

            <View style={styles.previewBox}>
              {form.carro_incompleto ? (
                <>
                  <Text style={styles.previewText}>
                    Fichas estimadas por el peso:{' '}
                    <Text style={styles.previewValue}>{fichasEstimadas != null ? `≈ ${fichasEstimadas}` : '–'}</Text>
                    {parametros ? ` (kg báscula ÷ ${fmtKg(parametros.kg_por_ficha)} kg por ficha)` : ''}
                  </Text>
                  <Text style={styles.previewText}>Con carro incompleto no se calcula merma.</Text>
                </>
              ) : (
                <>
                  <Text style={styles.previewText}>
                    Kg teórico: <Text style={styles.previewValue}>{kgTeorico != null ? fmtKg(kgTeorico) : '–'}</Text>
                    {fichasCalc != null && parametros ? ` (${fichasCalc} fichas × ${fmtKg(parametros.kg_por_ficha)} kg)` : ''}
                  </Text>
                  <Text style={styles.previewText}>
                    Merma: <Text style={[styles.previewValue, merma != null && merma < 0 && { color: colors.oro }]}>
                      {merma != null ? `${fmtKg(merma)} kg` : '–'}
                    </Text>
                  </Text>
                </>
              )}
            </View>

            {cosechasDelOrigen.length > 0 && (
              <>
                <Text style={styles.fieldLabel}>VINCULAR A UNA COSECHA (OPCIONAL)</Text>
                <Text style={[styles.muted, { marginBottom: 8 }]}>
                  Si esta uva corresponde a una cosecha ya cargada, elegila para llevar su saldo. Si no, el ingreso se guarda igual.
                </Text>
                <TouchableOpacity
                  style={[styles.optionRow, form.cosecha_id === '' && styles.optionRowActive]}
                  onPress={() => setField('cosecha_id', '')}
                >
                  <Text style={styles.optionTitle}>No vincular a ninguna</Text>
                </TouchableOpacity>
                {cosechasDelOrigen.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.optionRow, form.cosecha_id === c.id && styles.optionRowActive]}
                    onPress={() => setField('cosecha_id', c.id)}
                  >
                    <Text style={styles.optionTitle}>{cosechaLabel(c)}</Text>
                    <Text style={styles.optionSub}>
                      {fmtKg(c.kg_total)} kg cosechados · saldo {c.saldo_kg != null ? fmtKg(c.saldo_kg) : '–'} kg
                    </Text>
                  </TouchableOpacity>
                ))}
                <Text style={[styles.muted, { marginBottom: 14 }]}>Cosechas de la campaña {TEMPORADA}/{TEMPORADA + 1}.</Text>
              </>
            )}

            <Text style={styles.fieldLabel}>OBSERVACIONES</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={form.observaciones}
              onChangeText={(t) => setField('observaciones', t)}
              placeholder="Observaciones opcionales..."
              placeholderTextColor={colors.niebla}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {formError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color={colors.blanco} size="small" />
                : <Text style={styles.saveBtnText}>Guardar</Text>}
            </TouchableOpacity>
          </View>
        </View>
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
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  muted: { fontSize: 13, color: colors.ink60 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.ink60 },
  errorBox: { backgroundColor: '#fdf0f1', borderRadius: 10, padding: 12, marginVertical: 8 },
  errorText: { fontSize: 13, color: colors.sangre, fontWeight: '600' },

  stockRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.crema, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 6,
  },
  stockName: { fontSize: 14, fontWeight: '600', color: colors.ink, flex: 1 },
  stockKg: { fontSize: 14, fontWeight: '700', color: colors.verdeCampo },

  card: {
    backgroundColor: colors.blanco, borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  dateText: { fontSize: 13, fontWeight: '600', color: colors.ink60 },
  badge: { backgroundColor: '#f1e8f7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#6b3a8a' },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.ink, marginBottom: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kgText: { fontSize: 20, fontWeight: '800', color: colors.ink },
  mermaText: { fontSize: 12, color: colors.ink60 },

  fab: {
    position: 'absolute', bottom: 24, right: 24, width: 58, height: 58, borderRadius: 29,
    backgroundColor: colors.burdeos[600], justifyContent: 'center', alignItems: 'center',
    shadowColor: colors.burdeos[600], shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },

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
  modalScroll: { padding: 16, paddingBottom: 24 },
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

  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },
  input: {
    height: 48, backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.borde,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 14,
  },
  inputHighlight: { borderColor: colors.burdeos[600], borderWidth: 2, fontWeight: '700' },
  inputMultiline: { height: 80, paddingTop: 12 },
  previewBox: { backgroundColor: colors.crema, borderRadius: 12, padding: 12, marginBottom: 14, gap: 2 },
  previewText: { fontSize: 13, color: colors.ink60 },
  previewValue: { fontWeight: '800', color: colors.ink },

  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5,
    borderColor: colors.borde, backgroundColor: colors.blanco,
  },
  chipActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  chipTextActive: { color: colors.blanco },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  checkBox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borde,
    backgroundColor: colors.blanco, justifyContent: 'center', alignItems: 'center',
  },
  checkBoxActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  checkMark: { color: colors.blanco, fontSize: 15, fontWeight: '800' },
  checkLabel: { fontSize: 14, fontWeight: '600', color: colors.ink },

  optionRow: {
    backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1.5, borderColor: colors.borde,
    padding: 12, marginBottom: 6,
  },
  optionRowActive: { borderColor: colors.burdeos[600], backgroundColor: colors.crema },
  optionTitle: { fontSize: 13, fontWeight: '600', color: colors.ink },
  optionSub: { fontSize: 12, color: colors.ink60, marginTop: 2 },
})
