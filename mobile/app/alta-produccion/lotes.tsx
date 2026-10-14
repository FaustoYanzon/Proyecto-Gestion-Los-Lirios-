// Lotes de pasa: listar (abiertos / cerrados / todos), abrir y cerrar lotes e
// imprimir tarjas y hoja del lote. Los bines se levantan desde "Levantar pasa"
// (pantalla aparte, con su tarja). Solo encargado o superior.
// Requiere conexión. El depósito es único y lo asigna el backend; las entregas
// (remitos) quedan en la web.
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  RefreshControl,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native'
import { ICONS, ICON_STROKE } from '../../lib/icons'
import { colors } from '../../lib/theme'
import { useAuthStore } from '../../store/authStore'
import LoteModal, { loteNombre } from '../../components/LoteModal'
import { VARIEDAD_LABELS } from '../../lib/types'
import type { Parcela, VariedadUva } from '../../lib/types'
import {
  VARIEDADES, puedeAltaProduccion, fmtKg, fmtFecha, hoyISO, errorDetail,
  getLotesPasa, getLotePasa, abrirLotePasa, cerrarLotePasa, getPaseros,
  type EstadoLote, type LotePasa, type LotePasaDetalle,
} from '../../lib/altaProduccion'

type Filtro = EstadoLote | 'todos'
const FILTROS: [Filtro, string][] = [['abierto', 'Abiertos'], ['cerrado', 'Cerrados'], ['todos', 'Todos']]

export default function LotesScreen() {
  const role = useAuthStore((s) => s.user?.role)

  const [filtro, setFiltro] = useState<Filtro>('abierto')
  const [lotes, setLotes] = useState<LotePasa[]>([])
  const [paseros, setPaseros] = useState<Parcela[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [nuevoVisible, setNuevoVisible] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoadError(null)
    try {
      const [ls, pas] = await Promise.all([
        getLotesPasa(filtro === 'todos' ? undefined : filtro), getPaseros(),
      ])
      setLotes(ls)
      setPaseros(pas)
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
        <LoteModal
          loteId={detalleId}
          modo="lotes"
          paseros={paseros}
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
  binTarja: { fontSize: 12, fontWeight: '800', color: colors.burdeos[600], letterSpacing: 0.4, marginBottom: 2 },
  binIdx: { fontSize: 13, fontWeight: '700', color: colors.niebla, width: 20 },
  binKg: { fontSize: 15, fontWeight: '700', color: colors.ink },
})
