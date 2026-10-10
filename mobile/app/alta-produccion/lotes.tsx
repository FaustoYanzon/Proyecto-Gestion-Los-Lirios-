// Lotes de pasa: listar, abrir lote, agregar bines y cerrar. Solo encargado o
// superior. Requiere conexión (el backend valida la uva disponible del pasero
// en cada bin y no deduplica). Depósito y entregas (remitos) quedan en la web.
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
  Alert,
  StyleSheet,
} from 'react-native'
import { ICONS, ICON_STROKE } from '../../lib/icons'
import { colors } from '../../lib/theme'
import { useAuthStore } from '../../store/authStore'
import { VARIEDAD_LABELS } from '../../lib/types'
import type { Parcela, VariedadUva } from '../../lib/types'
import {
  VARIEDADES, puedeAltaProduccion, fmtKg, fmtFecha, hoyISO, kgValido, kgToString, errorDetail,
  getLotesPasa, getLotePasa, abrirLotePasa, agregarBinPasa, cerrarLotePasa,
  getStockPasero, getParametros, getPaseros,
  type EstadoLote, type LotePasa, type LotePasaDetalle, type ParametrosProduccion, type StockPaseroItem,
} from '../../lib/altaProduccion'

type Filtro = EstadoLote | 'todos'
const FILTROS: [Filtro, string][] = [['abierto', 'Abiertos'], ['cerrado', 'Cerrados'], ['todos', 'Todos']]

const loteNombre = (l: LotePasa) =>
  `${VARIEDAD_LABELS[l.variedad] ?? l.variedad} C${l.calidad} · N° ${l.numero} (${l.temporada}/${l.temporada + 1})`

export default function LotesScreen() {
  const role = useAuthStore((s) => s.user?.role)

  const [filtro, setFiltro] = useState<Filtro>('abierto')
  const [lotes, setLotes] = useState<LotePasa[]>([])
  const [paseros, setPaseros] = useState<Parcela[]>([])
  const [parametros, setParametros] = useState<ParametrosProduccion | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [nuevoVisible, setNuevoVisible] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoadError(null)
    try {
      const [ls, pas, par] = await Promise.all([
        getLotesPasa(filtro === 'todos' ? undefined : filtro), getPaseros(), getParametros(),
      ])
      setLotes(ls)
      setPaseros(pas)
      setParametros(par)
    } catch (e) {
      setLoadError(errorDetail(e, 'No se pudieron cargar los lotes'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [filtro])

  useEffect(() => { fetchData() }, [fetchData])

  function onRefresh() {
    setRefreshing(true)
    fetchData()
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
        <View style={styles.segment}>
          {FILTROS.map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[styles.segmentBtn, filtro === key && styles.segmentBtnActive]}
              onPress={() => { setLoading(true); setFiltro(key) }}
              activeOpacity={0.75}
            >
              <Text style={[styles.segmentText, filtro === key && styles.segmentTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loadError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={colors.tierra} style={{ marginTop: 24 }} />
        ) : lotes.length === 0 ? (
          <Text style={[styles.muted, { textAlign: 'center', marginTop: 24 }]}>No hay lotes para mostrar</Text>
        ) : (
          lotes.map((l) => (
            <TouchableOpacity key={l.id} style={styles.card} onPress={() => setDetalleId(l.id)} activeOpacity={0.8}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{loteNombre(l)}</Text>
                <EstadoBadge estado={l.estado} />
              </View>
              <View style={styles.cardFooter}>
                <Text style={styles.kgText}>{fmtKg(l.kg_total)} kg</Text>
                <Text style={styles.metaText}>
                  {l.cantidad_bines}{l.tope_bines != null ? ` / ${l.tope_bines}` : ''} bines · saldo {fmtKg(l.saldo_kg)} kg
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={() => setNuevoVisible(true)} activeOpacity={0.85}>
        <ICONS.agregar size={28} color={colors.blanco} strokeWidth={ICON_STROKE} />
      </TouchableOpacity>

      <NuevoLoteModal
        visible={nuevoVisible}
        onClose={() => setNuevoVisible(false)}
        onCreated={async (l) => { setNuevoVisible(false); await fetchData(); setDetalleId(l.id) }}
      />
      {detalleId && (
        <DetalleLoteModal
          loteId={detalleId}
          paseros={paseros}
          parametros={parametros}
          onClose={() => setDetalleId(null)}
          onChanged={fetchData}
        />
      )}
    </View>
  )
}

function EstadoBadge({ estado }: { estado: EstadoLote }) {
  const abierto = estado === 'abierto'
  return (
    <View style={[styles.badge, { backgroundColor: abierto ? '#fdf3dc' : '#e3eedf' }]}>
      <Text style={[styles.badgeText, { color: abierto ? '#8a5a2b' : colors.verdeCampo }]}>
        {abierto ? 'Abierto' : 'Cerrado'}
      </Text>
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

// ── Abrir lote ────────────────────────────────────────────────────────────────

function NuevoLoteModal({
  visible, onClose, onCreated,
}: {
  visible: boolean
  onClose: () => void
  onCreated: (l: LotePasa) => Promise<void>
}) {
  const [variedad, setVariedad] = useState<VariedadUva>('sultanina')
  const [calidad, setCalidad] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)

  // Cada apertura del modal arranca limpia.
  useEffect(() => { if (visible) { setError(null); setCalidad(1) } }, [visible])

  async function guardar() {
    if (submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const l = await abrirLotePasa({ variedad, calidad, fecha: hoyISO() })
      await onCreated(l)
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Abrir lote de pasa</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <ICONS.cerrar size={20} color={colors.ink} strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.modalScroll}>
          <Text style={styles.fieldLabel}>VARIEDAD *</Text>
          <View style={styles.chipGroup}>
            {VARIEDADES.map((v) => (
              <Chip key={v} label={VARIEDAD_LABELS[v]} active={variedad === v} onPress={() => setVariedad(v)} />
            ))}
          </View>
          <Text style={styles.fieldLabel}>CALIDAD *</Text>
          <View style={styles.chipGroup}>
            <Chip label="Calidad 1" active={calidad === 1} onPress={() => setCalidad(1)} />
            <Chip label="Calidad 2" active={calidad === 2} onPress={() => setCalidad(2)} />
          </View>
          <Text style={styles.muted}>
            Solo puede haber un lote abierto por variedad y calidad. El depósito se asigna desde la web.
          </Text>
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>
        <View style={styles.modalFooter}>
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelBtnText}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={guardar} disabled={saving}>
            {saving
              ? <ActivityIndicator color={colors.blanco} size="small" />
              : <Text style={styles.saveBtnText}>Abrir lote</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

// ── Detalle del lote (bines + cierre) ─────────────────────────────────────────

function DetalleLoteModal({
  loteId, paseros, parametros, onClose, onChanged,
}: {
  loteId: string
  paseros: Parcela[]
  parametros: ParametrosProduccion | null
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [lote, setLote] = useState<LotePasaDetalle | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [paseroId, setPaseroId] = useState('')
  const [kg, setKg] = useState('')
  const [stock, setStock] = useState<StockPaseroItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)

  const nombrePasero = (id: string) => paseros.find((p) => p.id === id)?.nombre ?? '–'

  const cargar = useCallback(async () => {
    try {
      setLote(await getLotePasa(loteId))
      setLoadError(null)
    } catch (e) {
      setLoadError(errorDetail(e, 'No se pudo cargar el lote'))
    }
  }, [loteId])

  useEffect(() => { cargar() }, [cargar])

  // Uva disponible del pasero elegido (para avisar antes de que el backend rechace).
  useEffect(() => {
    if (!paseroId) { setStock([]); return }
    getStockPasero(paseroId).then(setStock).catch(() => setStock([]))
  }, [paseroId])

  const abierto = lote?.estado === 'abierto'
  const disponible = lote && paseroId ? stock.find((s) => s.variedad === lote.variedad)?.uva_disponible_kg ?? 0 : null
  // Misma cuenta que el backend: redondeo hacia abajo a 2 decimales.
  const maxima = disponible != null && parametros
    ? Math.floor((disponible / parametros.ratio_uva_pasa) * 100) / 100
    : null
  const kgNum = Number(kg.trim().replace(',', '.'))
  const excede = maxima != null && kgNum > maxima
  const kgOk = kgValido(kg)

  async function agregarBin() {
    if (!lote || submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await agregarBinPasa(lote.id, { pasero_id: paseroId, kg_real: kgToString(kg), fecha: hoyISO() })
      setKg('')
      await cargar()
      if (paseroId) setStock(await getStockPasero(paseroId))
      await onChanged()
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  function confirmarCierre() {
    if (!lote) return
    Alert.alert(
      'Cerrar lote',
      `${loteNombre(lote)} quedará cerrado y no admitirá más bines. ¿Cerrar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Cerrar lote', style: 'destructive', onPress: cerrar },
      ],
    )
  }

  async function cerrar() {
    if (!lote || submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await cerrarLotePasa(lote.id)
      await cargar()
      await onChanged()
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { flex: 1 }]} numberOfLines={2}>
            {lote ? loteNombre(lote) : 'Lote'}
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <ICONS.cerrar size={20} color={colors.ink} strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        </View>

        {!lote ? (
          loadError
            ? <View style={styles.modalScroll}><View style={styles.errorBox}><Text style={styles.errorText}>{loadError}</Text></View></View>
            : <ActivityIndicator color={colors.tierra} style={{ marginTop: 32 }} />
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>KG TOTAL</Text>
                <Text style={styles.statValue}>{fmtKg(lote.kg_total)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>SALDO KG</Text>
                <Text style={[styles.statValue, { color: colors.verdeCampo }]}>{fmtKg(lote.saldo_kg)}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>BINES</Text>
                <Text style={styles.statValue}>
                  {lote.cantidad_bines}{lote.tope_bines != null ? ` / ${lote.tope_bines}` : ''}
                </Text>
              </View>
            </View>
            <View style={{ alignItems: 'flex-start', marginBottom: 16 }}><EstadoBadge estado={lote.estado} /></View>

            <Text style={styles.sectionLabel}>BINES</Text>
            {lote.bines.length === 0 ? (
              <Text style={[styles.muted, { marginBottom: 16 }]}>Todavía no tiene bines</Text>
            ) : (
              lote.bines.map((b, i) => (
                <View key={b.id} style={styles.binRow}>
                  <Text style={styles.binIdx}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.binKg}>{fmtKg(b.kg_real)} kg de pasa</Text>
                    <Text style={styles.metaText}>
                      {nombrePasero(b.pasero_id)} · {fmtFecha(b.fecha)} · uva {fmtKg(b.uva_consumida_kg)} kg
                    </Text>
                  </View>
                </View>
              ))
            )}

            {abierto && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 16 }]}>AGREGAR BIN</Text>
                <Text style={styles.fieldLabel}>PASERO *</Text>
                <View style={styles.chipGroup}>
                  {paseros.map((p) => (
                    <Chip key={p.id} label={p.nombre} active={paseroId === p.id} onPress={() => setPaseroId(p.id)} />
                  ))}
                  {paseros.length === 0 && <Text style={styles.muted}>No hay paseros activos</Text>}
                </View>

                <Text style={styles.fieldLabel}>KG DE PASA (BÁSCULA) *</Text>
                <TextInput
                  style={[styles.input, styles.inputHighlight]}
                  value={kg}
                  onChangeText={setKg}
                  placeholder="0"
                  placeholderTextColor={colors.niebla}
                  keyboardType="decimal-pad"
                />
                {disponible != null && maxima != null && parametros && (
                  <Text style={[styles.hint, excede && { color: colors.sangre }]}>
                    Uva disponible de {VARIEDAD_LABELS[lote.variedad] ?? lote.variedad} en este pasero: {fmtKg(disponible)} kg
                    {' · '}Pasa máxima levantable ({fmtKg(parametros.ratio_uva_pasa)}:1): {fmtKg(maxima)} kg
                    {kgOk && !excede ? ` · Va a descontar ${fmtKg(kgNum * parametros.ratio_uva_pasa)} kg de uva` : ''}
                  </Text>
                )}
                <TouchableOpacity
                  style={[styles.saveBtn, { flex: 0, marginTop: 8 }, (saving || !paseroId || !kgOk) && { opacity: 0.5 }]}
                  onPress={agregarBin}
                  disabled={saving || !paseroId || !kgOk}
                >
                  {saving
                    ? <ActivityIndicator color={colors.blanco} size="small" />
                    : <Text style={styles.saveBtnText}>Agregar bin</Text>}
                </TouchableOpacity>

                <Text style={[styles.sectionLabel, { marginTop: 24 }]}>CERRAR LOTE</Text>
                <Text style={[styles.muted, { marginBottom: 10 }]}>
                  {lote.tope_bines != null
                    ? `Se cierra solo al llegar a ${lote.tope_bines} bines. `
                    : 'No hay tope de bines: se cierra a mano. '}
                  No se puede cerrar sin bines; una vez cerrado no admite más bines.
                </Text>
                <TouchableOpacity
                  style={[styles.cancelBtn, { flex: 0 }, (saving || lote.cantidad_bines === 0) && { opacity: 0.5 }]}
                  onPress={confirmarCierre}
                  disabled={saving || lote.cantidad_bines === 0}
                >
                  <Text style={styles.cancelBtnText}>Cerrar lote</Text>
                </TouchableOpacity>
              </>
            )}

            {error && (
              <View style={[styles.errorBox, { marginTop: 14 }]}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
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
  hint: { fontSize: 12, color: colors.ink60, marginBottom: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.ink60 },
  errorBox: { backgroundColor: '#fdf0f1', borderRadius: 10, padding: 12, marginVertical: 8 },
  errorText: { fontSize: 13, color: colors.sangre, fontWeight: '600' },

  segment: {
    flexDirection: 'row', backgroundColor: colors.blanco, borderRadius: 12,
    padding: 4, marginBottom: 16, borderWidth: 1, borderColor: colors.borde,
  },
  segmentBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: colors.tierra },
  segmentText: { fontSize: 14, fontWeight: '700', color: colors.ink60 },
  segmentTextActive: { color: colors.blanco },

  card: {
    backgroundColor: colors.blanco, borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.ink, flex: 1 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kgText: { fontSize: 20, fontWeight: '800', color: colors.ink },
  metaText: { fontSize: 12, color: colors.ink60 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700' },

  fab: {
    position: 'absolute', bottom: 24, right: 24, width: 58, height: 58, borderRadius: 29,
    backgroundColor: colors.burdeos[600], justifyContent: 'center', alignItems: 'center',
    shadowColor: colors.burdeos[600], shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },

  modalContainer: { flex: 1, backgroundColor: colors.hueso, paddingTop: 16 },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.borde,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.crema,
    justifyContent: 'center', alignItems: 'center',
  },
  modalScroll: { padding: 16, paddingBottom: 32 },
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
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 8,
  },
  inputHighlight: { borderColor: colors.burdeos[600], borderWidth: 2, fontWeight: '700' },

  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5,
    borderColor: colors.borde, backgroundColor: colors.blanco,
  },
  chipActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  chipTextActive: { color: colors.blanco },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statBox: { flex: 1, backgroundColor: colors.crema, borderRadius: 12, padding: 10 },
  statLabel: { fontSize: 10, fontWeight: '700', color: colors.ink60, letterSpacing: 0.6 },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.ink, marginTop: 2 },
  binRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.blanco, borderRadius: 12, padding: 12, marginBottom: 6,
  },
  binIdx: { fontSize: 13, fontWeight: '700', color: colors.niebla, width: 20 },
  binKg: { fontSize: 15, fontWeight: '700', color: colors.ink },
})
