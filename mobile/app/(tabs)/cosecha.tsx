// Cosecha: listado + formulario de despacho "De -> Para" (cosecha + remito
// BOD/FRE/TRA + ingreso al pasero en una sola transacción). Solo encargado o
// superior (el backend responde 403 a regador/obrero). Requiere conexión.
import { useState, useEffect, useCallback, useRef } from 'react'
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
  ScrollView,
  TextInput,
} from 'react-native'
import { ICONS, ICON_STROKE } from '../../lib/icons'
import { colors } from '../../lib/theme'
import { getCosechas, deleteCosecha } from '../../lib/api'
import { newIdempotencyKey } from '../../lib/idempotency'
import { useAuthStore } from '../../store/authStore'
import {
  VARIEDADES, puedeAltaProduccion, fmtKg, hoyISO, kgValido, kgToString, errorDetail,
  getProductores, getCompradores, getParametros, getPaseros, getParrales, getUbicacionesPasero,
  createDespachoCosecha, abrirRemitoPdf, PARA_LABELS, ENVASE_LABELS, PREFIJO_REMITO,
  type Productor, type Comprador, type ParametrosProduccion, type UbicacionPasero,
  type ParaDespacho, type TipoEnvaseDespacho, type DespachoCosechaResultado, type OrigenIngreso,
} from '../../lib/altaProduccion'
import type { RegistroCosecha, VariedadUva, Parcela } from '../../lib/types'
import { DESTINO_LABELS, DESTINO_COLORS, VARIEDAD_LABELS } from '../../lib/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const nowInit = new Date()
const TEMPORADA = nowInit.getMonth() >= 4 ? nowInit.getFullYear() : nowInit.getFullYear() - 1

const PARA_OPTIONS = Object.keys(PARA_LABELS) as ParaDespacho[]
const ENVASE_OPTIONS = Object.entries(ENVASE_LABELS) as [TipoEnvaseDespacho, string][]

function fmtFecha(iso: string): string {
  return iso.split('-').reverse().join('/')
}

// Texto -> número (acepta coma); null si vacío o inválido.
function parseNum(t: string): number | null {
  const n = parseFloat(t.trim().replace(',', '.'))
  return t.trim() === '' || isNaN(n) ? null : n
}

interface FormState {
  fecha: string
  origen: OrigenIngreso
  parcela_id: string
  productor_id: string
  variedad: VariedadUva | ''
  para: ParaDespacho
  comprador_id: string
  pasero_id: string
  ubicacion_id: string
  carros: string
  carro_incompleto: boolean
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

function emptyForm(): FormState {
  return {
    fecha: hoyISO(), origen: 'propio', parcela_id: '', productor_id: '', variedad: '',
    para: 'bodega', comprador_id: '', pasero_id: '', ubicacion_id: '',
    carros: '1', carro_incompleto: false,
    tipo_envase: 'caja', cantidad_envases: '', peso_unitario_kg: '', bruto_kg: '', tara_kg: '', kg_total: '',
    vehiculo_patente: '', cuadrilla: '', acarreo: '', n_ciu: '', n_remito: '', observaciones: '',
  }
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function CosechaScreen() {
  const role = useAuthStore((s) => s.user?.role)
  const puedeDespachar = puedeAltaProduccion(role)

  const [registros, setRegistros] = useState<RegistroCosecha[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [modalVisible, setModalVisible] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)
  // Una clave por apertura del modal: si se reintenta tras un error de red no
  // duplica el despacho.
  const idempotencyKeyRef = useRef(newIdempotencyKey())
  const [resultado, setResultado] = useState<DespachoCosechaResultado | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [abriendoPdf, setAbriendoPdf] = useState(false)

  // Maestros
  const [parrales, setParrales] = useState<Parcela[]>([])
  const [paseros, setPaseros] = useState<Parcela[]>([])
  const [productores, setProductores] = useState<Productor[]>([])
  const [compradores, setCompradores] = useState<Comprador[]>([])
  const [parametros, setParametros] = useState<ParametrosProduccion | null>(null)
  const [ubicaciones, setUbicaciones] = useState<UbicacionPasero[]>([])

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
  useEffect(() => {
    if (!puedeDespachar) return
    getParrales().then(setParrales).catch(() => { /* sin lista no se puede elegir parral */ })
    getPaseros().then(setPaseros).catch(() => { /* idem pasero */ })
    getProductores().then((ps) => setProductores(ps.filter((p) => p.is_active))).catch(() => { /* idem */ })
    getCompradores().then((cs) => setCompradores(cs.filter((c) => c.is_active))).catch(() => { /* idem */ })
    getParametros().then(setParametros).catch(() => { /* solo afecta la estimación de fichas */ })
  }, [puedeDespachar])

  // Ubicaciones del pasero elegido.
  useEffect(() => {
    if (form.para !== 'pasero' || !form.pasero_id) { setUbicaciones([]); return }
    let cancel = false
    getUbicacionesPasero(form.pasero_id)
      .then((u) => { if (!cancel) setUbicaciones(u) })
      .catch(() => { if (!cancel) setUbicaciones([]) })
    return () => { cancel = true }
  }, [form.para, form.pasero_id])

  function onRefresh() {
    setRefreshing(true)
    fetchData()
  }

  // ── Form ────────────────────────────────────────────────────────────────────

  // kg_total se autocompleta desde envases (cantidad x peso unitario) o bruto - tara.
  function setPeso(field: 'cantidad_envases' | 'peso_unitario_kg' | 'bruto_kg' | 'tara_kg', value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value }
      if (field === 'cantidad_envases' || field === 'peso_unitario_kg') {
        const c = parseNum(next.cantidad_envases)
        const p = parseNum(next.peso_unitario_kg)
        if (c != null && p != null && c > 0 && p > 0) next.kg_total = String(Math.round(c * p * 100) / 100)
      } else {
        const b = parseNum(next.bruto_kg)
        const t = parseNum(next.tara_kg)
        if (b != null && t != null && b > t) next.kg_total = String(Math.round((b - t) * 100) / 100)
      }
      return next
    })
  }

  function setField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // Un tercero solo puede ir a pasero.
  function elegirOrigen(origen: OrigenIngreso) {
    setForm((prev) => prev.origen === origen ? prev : {
      ...prev, origen, parcela_id: '', productor_id: '', variedad: '',
      para: origen === 'tercero' ? 'pasero' : prev.para,
      comprador_id: origen === 'tercero' ? '' : prev.comprador_id,
    })
  }

  function elegirPara(para: ParaDespacho) {
    setForm((prev) => prev.para === para ? prev : {
      ...prev, para, comprador_id: '', pasero_id: '', ubicacion_id: '',
    })
  }

  function elegirParral(p: Parcela) {
    const variedad = p.variedad && VARIEDADES.includes(p.variedad) ? p.variedad : ''
    setForm((prev) => ({ ...prev, parcela_id: p.id, variedad }))
  }

  const parralElegido = parrales.find((p) => p.id === form.parcela_id) ?? null
  const variedadDelParral = !!parralElegido?.variedad && VARIEDADES.includes(parralElegido.variedad)
  const esPasero = form.para === 'pasero'
  const kgNum = parseNum(form.kg_total)
  const kgOk = kgValido(form.kg_total)
  const fichasEstimadas = esPasero && form.carro_incompleto && parametros && kgOk && kgNum != null && parametros.kg_por_ficha > 0
    ? Math.max(1, Math.round(kgNum / parametros.kg_por_ficha))
    : null

  const deNombre = form.origen === 'propio'
    ? parralElegido?.nombre ?? null
    : productores.find((p) => p.id === form.productor_id)?.nombre ?? null
  const paraNombre = esPasero
    ? paseros.find((p) => p.id === form.pasero_id)?.nombre ?? null
    : compradores.find((c) => c.id === form.comprador_id)?.nombre ?? null

  function openModal() {
    setForm(emptyForm())
    setFormError(null)
    setResultado(null)
    setPdfError(null)
    idempotencyKeyRef.current = newIdempotencyKey()
    setModalVisible(true)
  }

  function closeModal() {
    setModalVisible(false)
    setResultado(null)
  }

  function validar(): string | null {
    if (!form.fecha.match(/^\d{4}-\d{2}-\d{2}$/)) return 'La fecha debe tener formato AAAA-MM-DD'
    if (form.origen === 'propio' && !form.parcela_id) return 'Elegí el parral de origen'
    if (form.origen === 'tercero' && !form.productor_id) return 'Elegí el productor'
    if (!form.variedad && !(form.origen === 'propio' && variedadDelParral)) return 'Elegí la variedad'
    if (esPasero && !form.pasero_id) return 'Elegí a qué pasero va'
    if (!esPasero && !form.comprador_id) return `Elegí ${form.para === 'bodega' ? 'la bodega' : 'el comprador'}`
    if (esPasero) {
      const c = Number(form.carros.trim())
      if (!Number.isInteger(c) || c < 1) return 'Carros: entero, mínimo 1'
    }
    if (!kgOk) return 'Kg total: número positivo con hasta 2 decimales'
    return null
  }

  async function handleSave() {
    if (submittingRef.current) return
    const err = validar()
    if (err) { setFormError(err); return }
    submittingRef.current = true
    setSaving(true)
    setFormError(null)
    try {
      const cant = parseNum(form.cantidad_envases)
      const pesoU = parseNum(form.peso_unitario_kg)
      const bruto = parseNum(form.bruto_kg)
      const tara = parseNum(form.tara_kg)
      const usaEnvases = cant != null && pesoU != null
      const res = await createDespachoCosecha({
        fecha: form.fecha,
        para: form.para,
        origen: form.origen,
        parcela_id: form.origen === 'propio' ? form.parcela_id : null,
        productor_id: form.origen === 'tercero' ? form.productor_id : null,
        // Propio con parral que ya tiene variedad: la define el parral.
        variedad: form.origen === 'propio' && variedadDelParral ? null : (form.variedad || null),
        comprador_id: esPasero ? null : form.comprador_id,
        pasero_id: esPasero ? form.pasero_id : null,
        ubicacion_id: esPasero ? (form.ubicacion_id || null) : null,
        kg_total: Number(kgToString(form.kg_total)),
        ...(usaEnvases ? { tipo_envase: form.tipo_envase, cantidad_envases: cant, peso_unitario_kg: pesoU } : {}),
        ...(bruto != null && tara != null ? { bruto_kg: bruto, tara_kg: tara } : {}),
        ...(esPasero
          ? { carros: Number(form.carros.trim()), carro_incompleto: form.carro_incompleto }
          : {
              vehiculo_patente: form.vehiculo_patente.trim() || null,
              cuadrilla: form.cuadrilla.trim() || null,
              acarreo: form.acarreo.trim() || null,
              n_ciu: form.n_ciu.trim() || null,
              n_remito: form.n_remito.trim() || null,
              observaciones: form.observaciones.trim() || null,
            }),
        idempotency_key: idempotencyKeyRef.current,
      })
      setResultado(res)
      await fetchData()
    } catch (e) {
      setFormError(errorDetail(e))
    } finally {
      submittingRef.current = false
      setSaving(false)
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

      <TouchableOpacity style={styles.fab} onPress={openModal}>
        <ICONS.agregar size={28} color="#fff" strokeWidth={ICON_STROKE} />
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
        <View style={styles.modalContainer}>

          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{resultado ? 'Despacho registrado' : 'Nuevo despacho'}</Text>
            <TouchableOpacity onPress={closeModal} style={styles.closeBtn}>
              <ICONS.cerrar size={20} color="#374151" strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
          </View>

          {resultado ? (
            // ── Éxito ──
            <>
              <View style={styles.successBox}>
                <Text style={styles.successTitle}>Remito {resultado.remito.numero}</Text>
                <Text style={styles.successText}>{fmtKg(resultado.remito.kg_total)} kg</Text>
                <Text style={styles.muted}>
                  {resultado.remito.comprador_nombre ?? resultado.remito.pasero_nombre ?? ''}
                  {resultado.ingresoPasero ? ' · ingreso al pasero registrado' : ''}
                </Text>
                {pdfError && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{pdfError}</Text>
                  </View>
                )}
              </View>
              <View style={styles.modalFooter}>
                <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
                  <Text style={styles.cancelBtnText}>Cerrar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, abriendoPdf && { opacity: 0.6 }]}
                  onPress={() => imprimir(resultado.remito.id)}
                  disabled={abriendoPdf}
                >
                  {abriendoPdf
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.saveBtnText}>Imprimir remito</Text>}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
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

                {/* ── DE ── */}
                <Text style={styles.sectionLabel}>DE</Text>
                <View style={styles.chipGroup}>
                  <Chip label="Propio" active={form.origen === 'propio'} onPress={() => elegirOrigen('propio')} />
                  <Chip label="Tercero" active={form.origen === 'tercero'} onPress={() => elegirOrigen('tercero')} />
                </View>

                {form.origen === 'propio' ? (
                  <>
                    <Text style={styles.fieldLabel}>PARRAL *</Text>
                    <View style={styles.chipGroup}>
                      {parrales.map((p) => (
                        <Chip key={p.id} label={p.nombre} active={form.parcela_id === p.id} onPress={() => elegirParral(p)} />
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
                      <VariedadPicker
                        label="VARIEDAD * (el parral no la tiene cargada)"
                        value={form.variedad}
                        onChange={(v) => setField('variedad', v)}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.fieldLabel}>PRODUCTOR *</Text>
                    <View style={styles.chipGroup}>
                      {productores.map((p) => (
                        <Chip key={p.id} label={p.nombre} active={form.productor_id === p.id} onPress={() => setField('productor_id', p.id)} />
                      ))}
                      {productores.length === 0 && (
                        <Text style={styles.muted}>No hay productores cargados (se dan de alta desde la web)</Text>
                      )}
                    </View>
                    <VariedadPicker label="VARIEDAD *" value={form.variedad} onChange={(v) => setField('variedad', v)} />
                  </>
                )}

                {/* ── PARA ── */}
                <Text style={[styles.sectionLabel, { marginTop: 6 }]}>PARA</Text>
                <View style={styles.chipGroup}>
                  {PARA_OPTIONS.map((k) => (
                    <Chip
                      key={k}
                      label={PARA_LABELS[k]}
                      active={form.para === k}
                      disabled={form.origen === 'tercero' && k !== 'pasero'}
                      onPress={() => elegirPara(k)}
                    />
                  ))}
                </View>
                {form.origen === 'tercero' && (
                  <Text style={[styles.muted, { marginBottom: 14 }]}>La uva de terceros solo puede ir a un pasero.</Text>
                )}

                {esPasero ? (
                  <>
                    <Text style={styles.fieldLabel}>PASERO *</Text>
                    <View style={styles.chipGroup}>
                      {paseros.map((p) => (
                        <Chip
                          key={p.id}
                          label={p.nombre}
                          active={form.pasero_id === p.id}
                          onPress={() => setForm((prev) => ({ ...prev, pasero_id: p.id, ubicacion_id: '' }))}
                        />
                      ))}
                      {paseros.length === 0 && <Text style={styles.muted}>No hay paseros activos</Text>}
                    </View>
                    {form.pasero_id !== '' && ubicaciones.length > 0 && (
                      <>
                        <Text style={styles.fieldLabel}>UBICACIÓN (OPCIONAL)</Text>
                        <View style={styles.chipGroup}>
                          <Chip label="Sin ubicación" active={form.ubicacion_id === ''} onPress={() => setField('ubicacion_id', '')} />
                          {ubicaciones.map((u) => (
                            <Chip
                              key={u.id}
                              label={`Hilera ${u.hilera} · Parte ${u.parte}`}
                              active={form.ubicacion_id === u.id}
                              onPress={() => setField('ubicacion_id', u.id)}
                            />
                          ))}
                        </View>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.fieldLabel}>{form.para === 'bodega' ? 'BODEGA *' : 'COMPRADOR *'}</Text>
                    <View style={styles.chipGroup}>
                      {compradores.map((c) => (
                        <Chip key={c.id} label={c.nombre} active={form.comprador_id === c.id} onPress={() => setField('comprador_id', c.id)} />
                      ))}
                      {compradores.length === 0 && <Text style={styles.muted}>No hay compradores cargados</Text>}
                    </View>
                  </>
                )}

                {/* ── PESO ── */}
                <Text style={[styles.sectionLabel, { marginTop: 6 }]}>PESO</Text>
                <Text style={styles.fieldLabel}>TIPO DE ENVASE</Text>
                <View style={styles.chipGroup}>
                  {ENVASE_OPTIONS.map(([k, label]) => (
                    <Chip key={k} label={label} active={form.tipo_envase === k} onPress={() => setField('tipo_envase', k)} />
                  ))}
                </View>

                <View style={styles.row}>
                  <View style={styles.col}>
                    <Text style={styles.fieldLabel}>CANTIDAD</Text>
                    <TextInput
                      style={styles.input}
                      value={form.cantidad_envases}
                      onChangeText={(t) => setPeso('cantidad_envases', t)}
                      placeholder="0"
                      placeholderTextColor={colors.niebla}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={styles.col}>
                    <Text style={styles.fieldLabel}>PESO UNIT. KG</Text>
                    <TextInput
                      style={styles.input}
                      value={form.peso_unitario_kg}
                      onChangeText={(t) => setPeso('peso_unitario_kg', t)}
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
                      value={form.bruto_kg}
                      onChangeText={(t) => setPeso('bruto_kg', t)}
                      placeholder="Camiones / bins"
                      placeholderTextColor={colors.niebla}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={styles.col}>
                    <Text style={styles.fieldLabel}>TARA KG</Text>
                    <TextInput
                      style={styles.input}
                      value={form.tara_kg}
                      onChangeText={(t) => setPeso('tara_kg', t)}
                      placeholder="0"
                      placeholderTextColor={colors.niebla}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>KG TOTAL *</Text>
                <TextInput
                  style={[styles.input, styles.inputHighlight]}
                  value={form.kg_total}
                  onChangeText={(t) => setField('kg_total', t)}
                  placeholder="Se calcula o se escribe directo"
                  placeholderTextColor={colors.niebla}
                  keyboardType="decimal-pad"
                />

                {/* ── Carros (solo pasero) ── */}
                {esPasero && (
                  <>
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
                    {form.carro_incompleto && (
                      <View style={styles.previewBox}>
                        <Text style={styles.previewText}>
                          Fichas estimadas por el peso:{' '}
                          <Text style={styles.previewValue}>{fichasEstimadas != null ? `≈ ${fichasEstimadas}` : '–'}</Text>
                          {parametros ? ` (kg ÷ ${fmtKg(parametros.kg_por_ficha)} kg por ficha)` : ''}
                        </Text>
                        <Text style={styles.previewText}>Con carro incompleto no se calcula merma.</Text>
                      </View>
                    )}
                  </>
                )}

                {/* ── Transporte y observaciones (bodega / comprador) ── */}
                {!esPasero && (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 6 }]}>TRANSPORTE Y OBSERVACIONES</Text>

                    <Text style={styles.fieldLabel}>VEHÍCULO / PATENTE</Text>
                    <TextInput
                      style={styles.input}
                      value={form.vehiculo_patente}
                      onChangeText={(t) => setField('vehiculo_patente', t)}
                      placeholder="AAA123BB"
                      placeholderTextColor={colors.niebla}
                      autoCapitalize="characters"
                      maxLength={20}
                    />
                    <Text style={styles.fieldLabel}>CUADRILLA</Text>
                    <TextInput
                      style={styles.input}
                      value={form.cuadrilla}
                      onChangeText={(t) => setField('cuadrilla', t)}
                      placeholder="Nombre de cuadrilla"
                      placeholderTextColor={colors.niebla}
                      autoCapitalize="words"
                      maxLength={150}
                    />
                    <Text style={styles.fieldLabel}>ACARREO</Text>
                    <TextInput
                      style={styles.input}
                      value={form.acarreo}
                      onChangeText={(t) => setField('acarreo', t)}
                      placeholderTextColor={colors.niebla}
                      autoCapitalize="words"
                      maxLength={150}
                    />
                    <Text style={styles.fieldLabel}>N° CIU / GUÍA ÚNICA</Text>
                    <TextInput
                      style={styles.input}
                      value={form.n_ciu}
                      onChangeText={(t) => setField('n_ciu', t)}
                      placeholderTextColor={colors.niebla}
                      maxLength={50}
                    />
                    <Text style={styles.fieldLabel}>N° DE REMITO EN PAPEL</Text>
                    <TextInput
                      style={styles.input}
                      value={form.n_remito}
                      onChangeText={(t) => setField('n_remito', t)}
                      placeholderTextColor={colors.niebla}
                      maxLength={50}
                    />
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
                      maxLength={500}
                    />
                  </>
                )}

                {/* ── Resumen ── */}
                <View style={styles.previewBox}>
                  <Text style={styles.previewValue}>
                    Se va a crear: cosecha + remito {PREFIJO_REMITO[form.para]}{esPasero ? ' + ingreso al pasero' : ''}
                  </Text>
                  <Text style={styles.previewText}>
                    {kgNum != null && kgNum > 0 ? `${fmtKg(kgNum)} kg` : 'Sin peso'}
                    {form.variedad ? ` de ${VARIEDAD_LABELS[form.variedad]}` : ''}
                    {deNombre ? ` · de ${deNombre}` : ''}
                    {paraNombre ? ` → ${paraNombre}` : ''}
                  </Text>
                </View>

                {formError && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{formError}</Text>
                  </View>
                )}
              </ScrollView>

              <View style={styles.modalFooter}>
                <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.saveBtnText}>Registrar despacho</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}

        </View>
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

function VariedadPicker({ label, value, onChange }: { label: string; value: VariedadUva | ''; onChange: (v: VariedadUva) => void }) {
  return (
    <>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.chipGroup}>
        {VARIEDADES.map((v) => (
          <Chip key={v} label={VARIEDAD_LABELS[v]} active={value === v} onPress={() => onChange(v)} />
        ))}
      </View>
    </>
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

  // Modal (mismo estilo que alta-produccion/pasero)
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
    height: 48, backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.borde,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 14,
  },
  inputHighlight: { borderColor: colors.burdeos[600], borderWidth: 2, fontWeight: '700' },
  inputMultiline: { height: 80, paddingTop: 12 },
  row: { flexDirection: 'row', gap: 10 },
  col: { flex: 1 },
  previewBox: { backgroundColor: colors.crema, borderRadius: 12, padding: 12, marginBottom: 14, gap: 2 },
  previewText: { fontSize: 13, color: colors.ink60 },
  previewValue: { fontWeight: '800', color: colors.ink, fontSize: 13 },

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

  errorBox: { backgroundColor: '#fdf0f1', borderRadius: 10, padding: 12, marginVertical: 8 },
  errorText: { fontSize: 13, color: colors.sangre, fontWeight: '600' },

  successBox: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 6 },
  successTitle: { fontSize: 22, fontWeight: '800', color: colors.ink },
  successText: { fontSize: 18, fontWeight: '700', color: colors.verdeCampo },
})
