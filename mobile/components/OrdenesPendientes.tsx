// Pool de órdenes de aplicación con algo pendiente de confirmar, para que el
// operario marque qué parral aplicó -- reemplaza la indicación de palabra
// (ingeniero -> encargado -> operario) por una orden con producto, dosis y
// carencia ya fijados; el operario solo confirma dónde y agrega observación
// u foto opcional. Ver backend/app/api/ordenes_aplicacion.py.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator,
  TextInput, Modal, Image,
} from 'react-native'
import { ICONS, ICON_STROKE } from '../lib/icons'
import {
  getOrdenesPendientes, confirmarAplicacionOrden, subirFotoAplicacion,
} from '../lib/api'
import { elegirImagenDeGaleria } from '../lib/imagePicker'
import { colors } from '../lib/theme'
import type { OrdenAplicacion, OrdenAplicacionParcelaItem } from '../lib/types'
import { VARIEDAD_LABELS } from '../lib/types'

function formatDateDisplay(iso: string) {
  const [y, mo, d] = iso.split('-')
  return `${d}/${mo}/${y}`
}

const ORIGEN_LABELS: Record<string, string> = { plan: 'Del plan', extra: 'Fuera de plan' }

// ─── Modal de confirmación ──────────────────────────────────────────────────

function ConfirmarModal({
  visible, orden, item, onClose, onConfirmed,
}: {
  visible: boolean
  orden: OrdenAplicacion | null
  item: OrdenAplicacionParcelaItem | null
  onClose: () => void
  onConfirmed: () => void
}) {
  const [observaciones, setObservaciones] = useState('')
  const [fotoUri, setFotoUri] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (visible) { setObservaciones(''); setFotoUri(null) }
  }, [visible])

  async function handleElegirFoto() {
    const uri = await elegirImagenDeGaleria()
    if (uri) setFotoUri(uri)
  }

  async function handleConfirmar() {
    if (!orden || !item || submittingRef.current) return
    submittingRef.current = true
    setLoading(true)
    try {
      await confirmarAplicacionOrden(orden.id, item.id, observaciones.trim() || undefined)
      if (fotoUri) {
        try {
          await subirFotoAplicacion(item.id, fotoUri)
        } catch {
          Alert.alert(
            'Aplicación confirmada',
            'Se guardó la confirmación, pero la foto no se pudo subir. Podés intentar subirla más tarde.',
          )
        }
      }
      onConfirmed()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } }
      const detail = err.response?.data?.detail
      Alert.alert('Error', typeof detail === 'string' ? detail : 'No se pudo confirmar la aplicación.')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  if (!orden || !item) return null

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.hueso }}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Confirmar aplicación</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <ICONS.cerrar size={20} color={colors.ink} strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={styles.summaryCard}>
            {[
              { label: 'Parral', value: item.parcela_nombre },
              { label: 'Producto', value: orden.insumo_nombre },
              { label: 'Dosis', value: `${orden.dosis_por_ha} ${orden.insumo_unidad}/ha` },
              { label: 'Objetivo', value: orden.objetivo },
            ].map(({ label, value }, idx, arr) => (
              <View key={label} style={[styles.summaryRow, idx < arr.length - 1 && styles.summaryRowBorder]}>
                <Text style={styles.summaryLabel}>{label}</Text>
                <Text style={[styles.summaryValue, { flex: 1, textAlign: 'right' }]}>{value}</Text>
              </View>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 20 }]}>
            OBSERVACIONES <Text style={{ textTransform: 'none', fontWeight: '400' }}>(opcional)</Text>
          </Text>
          <TextInput
            style={styles.textarea}
            value={observaciones}
            onChangeText={setObservaciones}
            placeholder="Ej: faltó producto para terminar, viento fuerte..."
            placeholderTextColor={colors.niebla}
            multiline
          />

          <Text style={[styles.fieldLabel, { marginTop: 4 }]}>
            FOTO <Text style={{ textTransform: 'none', fontWeight: '400' }}>(opcional)</Text>
          </Text>
          {fotoUri ? (
            <View style={styles.fotoPreviewWrap}>
              <Image source={{ uri: fotoUri }} style={styles.fotoPreview} />
              <TouchableOpacity style={styles.fotoRemoveBtn} onPress={() => setFotoUri(null)}>
                <ICONS.cancelar size={20} color={colors.blanco} strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.fotoBtn} onPress={handleElegirFoto}>
              <ICONS.camara size={18} color={colors.tierra} strokeWidth={ICON_STROKE} />
              <Text style={styles.fotoBtnText}>Adjuntar foto</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, { marginTop: 24 }, loading && { opacity: 0.6 }]}
            onPress={handleConfirmar}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.blanco} size="small" />
            ) : (
              <>
                <ICONS.check size={18} color={colors.blanco} style={{ marginRight: 6 }} strokeWidth={ICON_STROKE} />
                <Text style={styles.primaryBtnText}>Confirmar aplicación</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  )
}

// ─── Tarjeta de orden ───────────────────────────────────────────────────────

function OrdenCard({
  orden, onSelectItem,
}: {
  orden: OrdenAplicacion
  onSelectItem: (item: OrdenAplicacionParcelaItem) => void
}) {
  const pendientes = orden.parcelas.filter((p) => p.estado === 'pendiente')
  const aplicadas = orden.parcelas.filter((p) => p.estado === 'aplicada')

  return (
    <View style={styles.ordenCard}>
      <View style={styles.ordenHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.ordenProducto}>{orden.insumo_nombre}</Text>
          <Text style={styles.ordenSub}>
            {orden.dosis_por_ha} {orden.insumo_unidad}/ha · {orden.objetivo}
          </Text>
        </View>
        <View style={styles.origenBadge}>
          <Text style={styles.origenBadgeText}>{ORIGEN_LABELS[orden.origen] ?? orden.origen}</Text>
        </View>
      </View>
      <Text style={styles.ordenMeta}>
        {VARIEDAD_LABELS[orden.variedad] ?? orden.variedad} · Planificada {formatDateDisplay(orden.fecha_planificada)}
      </Text>

      <View style={styles.parcelasWrap}>
        {pendientes.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.parcelaChipPendiente}
            onPress={() => onSelectItem(item)}
            activeOpacity={0.75}
          >
            <Text style={styles.parcelaChipPendienteText}>{item.parcela_nombre}</Text>
          </TouchableOpacity>
        ))}
        {aplicadas.map((item) => (
          <View key={item.id} style={styles.parcelaChipAplicada}>
            <ICONS.check size={12} color={colors.ink60} strokeWidth={ICON_STROKE} />
            <Text style={styles.parcelaChipAplicadaText}>{item.parcela_nombre}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// ─── Sección principal ──────────────────────────────────────────────────────

export default function OrdenesPendientes({ onConfirmado }: { onConfirmado: () => void }) {
  const [ordenes, setOrdenes] = useState<OrdenAplicacion[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOrden, setModalOrden] = useState<OrdenAplicacion | null>(null)
  const [modalItem, setModalItem] = useState<OrdenAplicacionParcelaItem | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await getOrdenesPendientes()
      setOrdenes(data)
    } catch { /* offline o sin permisos -- la sección simplemente no muestra nada nuevo */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function handleSelectItem(orden: OrdenAplicacion, item: OrdenAplicacionParcelaItem) {
    setModalOrden(orden)
    setModalItem(item)
  }

  function handleConfirmed() {
    setModalOrden(null)
    setModalItem(null)
    load()
    onConfirmado()
  }

  if (loading) {
    return <ActivityIndicator color={colors.tierra} style={{ marginBottom: 16 }} />
  }
  if (ordenes.length === 0) return null

  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={styles.sectionLabel}>ÓRDENES PENDIENTES</Text>
      {ordenes.map((orden) => (
        <OrdenCard key={orden.id} orden={orden} onSelectItem={(item) => handleSelectItem(orden, item)} />
      ))}
      <ConfirmarModal
        visible={!!modalItem}
        orden={modalOrden}
        item={modalItem}
        onClose={() => { setModalOrden(null); setModalItem(null) }}
        onConfirmed={handleConfirmed}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  ordenCard: {
    backgroundColor: colors.blanco, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: colors.hueso,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  ordenHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  ordenProducto: { fontSize: 15, fontWeight: '700', color: colors.ink },
  ordenSub: { fontSize: 12, color: colors.ink60, marginTop: 2 },
  ordenMeta: { fontSize: 11, color: colors.niebla, marginTop: 6, textTransform: 'capitalize' },
  origenBadge: {
    backgroundColor: colors.crema, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    marginLeft: 8,
  },
  origenBadgeText: { fontSize: 10, fontWeight: '700', color: colors.tierra },
  parcelasWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  parcelaChipPendiente: {
    backgroundColor: colors.tierra, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  parcelaChipPendienteText: { fontSize: 13, fontWeight: '700', color: colors.blanco },
  parcelaChipAplicada: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.hueso, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  parcelaChipAplicadaText: { fontSize: 13, fontWeight: '600', color: colors.ink60, textDecorationLine: 'line-through' },

  // modal
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 20, backgroundColor: colors.blanco,
    borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.hueso, justifyContent: 'center', alignItems: 'center',
  },
  summaryCard: {
    backgroundColor: colors.blanco, borderRadius: 16,
    borderWidth: 1, borderColor: colors.hueso, overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13,
  },
  summaryRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hueso },
  summaryLabel: { fontSize: 13, color: colors.ink60, fontWeight: '600' },
  summaryValue: { fontSize: 13, color: colors.ink, fontWeight: '700' },
  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },
  textarea: {
    height: 90, backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.borde,
    paddingHorizontal: 14, paddingTop: 12, fontSize: 15, color: colors.ink,
    marginBottom: 14, textAlignVertical: 'top',
  },
  fotoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center',
    height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.tierra,
    borderStyle: 'dashed', backgroundColor: colors.blanco,
  },
  fotoBtnText: { color: colors.tierra, fontSize: 14, fontWeight: '700' },
  fotoPreviewWrap: { position: 'relative', alignSelf: 'flex-start' },
  fotoPreview: { width: 100, height: 100, borderRadius: 12 },
  fotoRemoveBtn: {
    position: 'absolute', top: -8, right: -8,
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.ink,
    justifyContent: 'center', alignItems: 'center',
  },
  primaryBtn: {
    height: 52, backgroundColor: colors.tierra, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', flexDirection: 'row',
  },
  primaryBtnText: { color: colors.blanco, fontSize: 16, fontWeight: '700' },
})
