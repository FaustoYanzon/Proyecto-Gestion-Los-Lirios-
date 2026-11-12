// Maquinaria order detail: state, machine, photos, budgets, payment and
// timeline. Only a few actions live on the phone (see accionesMobile); the
// rest of the workflow is managed from the web.
import { useCallback, useState } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, Image, Modal, TextInput, Alert, RefreshControl,
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native'
import { useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ICONS, ICON_STROKE } from '../../../lib/icons'
import { colors, formatARS } from '../../../lib/theme'
import { useAuthStore } from '../../../store/authStore'
import { elegirImagenDeGaleria } from '../../../lib/imagePicker'
import EmptyState from '../../../components/ui/EmptyState'
import {
  puedeVerMaquinaria, accionesMobile, errorDetail, getOrden, transicionarOrden,
  resolverPresupuesto, subirFotoOrden,
  ESTADO_ORDEN_LABELS, ESTADO_PRESUPUESTO_LABELS, GRAVEDAD_FALLA_LABELS, TIPO_MAQUINA_LABELS,
  FINCA_LABELS, type OrdenDetalleResponse,
} from '../../../lib/maquinaria'
import { colorEstadoOrden, fmtFechaHora, nombreMaquina, ordenAbierta } from '../../../lib/maquinariaUi'

const MAX_FOTOS = 2

interface MotivoDialog {
  titulo: string
  confirmar: string
  onConfirm: (motivo: string) => Promise<void>
}

export default function OrdenDetalleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const role = useAuthStore((s) => s.user?.role)

  const [orden, setOrden] = useState<OrdenDetalleResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<MotivoDialog | null>(null)
  const [motivo, setMotivo] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    try {
      setOrden(await getOrden(id))
      setError(null)
    } catch (e) {
      setError(errorDetail(e, 'No se pudo cargar la orden'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [id])

  useFocusEffect(useCallback(() => { load() }, [load]))

  if (!puedeVerMaquinaria(role)) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No tenés acceso a esta sección</Text>
      </View>
    )
  }

  // Runs a mutation, shows the backend `detail` on failure and reloads on success.
  async function ejecutar(fn: () => Promise<unknown>, okMsg: string) {
    setBusy(true)
    try {
      await fn()
      await load()
      Alert.alert('Listo', okMsg)
    } catch (e) {
      Alert.alert('No se pudo completar', errorDetail(e))
      await load()
    } finally {
      setBusy(false)
    }
  }

  function aprobar(presupuestoId: string, monto: number | null) {
    Alert.alert(
      'Aprobar presupuesto',
      `${monto !== null ? `Vas a aprobar un presupuesto de ${formatARS(monto)}. ` : ''}¿Confirmás?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Aprobar', onPress: () => ejecutar(() => resolverPresupuesto(presupuestoId, true), 'Presupuesto aprobado.') },
      ],
    )
  }

  function abrirDialogo(d: MotivoDialog) {
    setMotivo('')
    setDialog(d)
  }

  async function confirmarDialogo() {
    const texto = motivo.trim()
    if (!dialog) return
    if (!texto) { Alert.alert('Falta el motivo', 'Escribí el motivo para continuar.'); return }
    const d = dialog
    setDialog(null)
    await d.onConfirm(texto)
  }

  function rechazar(presupuestoId: string) {
    abrirDialogo({
      titulo: 'Rechazar presupuesto',
      confirmar: 'Rechazar',
      onConfirm: (m) => ejecutar(() => resolverPresupuesto(presupuestoId, false, m), 'Presupuesto rechazado.'),
    })
  }

  function confirmarRecepcion() {
    if (!orden) return
    Alert.alert(
      'Confirmar recepción',
      'Confirmás que la máquina volvió y funciona bien. La orden se cierra.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: () => ejecutar(() => transicionarOrden(orden.id, 'cerrada'), 'Orden cerrada.') },
      ],
    )
  }

  function reabrir() {
    if (!orden) return
    abrirDialogo({
      titulo: 'Reabrir orden',
      confirmar: 'Reabrir',
      onConfirm: (m) => ejecutar(() => transicionarOrden(orden.id, 'en_reparacion', m), 'La orden volvió a reparación.'),
    })
  }

  async function agregarFoto() {
    if (!orden) return
    const uri = await elegirImagenDeGaleria()
    if (!uri) return
    await ejecutar(() => subirFotoOrden(orden.id, uri), 'Foto agregada.')
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={colors.burdeos[600]} /></View>
  }
  if (!orden) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="desconectado"
          title="No se pudo cargar la orden"
          description={error ?? undefined}
          action={
            <TouchableOpacity style={styles.primaryBtn} onPress={() => { setLoading(true); load() }}>
              <Text style={styles.primaryText}>Reintentar</Text>
            </TouchableOpacity>
          }
        />
      </View>
    )
  }

  const acciones = accionesMobile(role, orden.estado)
  const presupuestoPendiente = orden.presupuestos.find((p) => p.estado === 'pendiente')
  const abierta = ordenAbierta(orden.estado)
  const puedeAgregarFoto = abierta && orden.fotos.length < MAX_FOTOS
  const estadoColor = colorEstadoOrden(orden.estado)

  return (
    <View style={{ flex: 1, backgroundColor: colors.hueso }}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load() }}
            tintColor={colors.burdeos[600]}
          />
        }
      >
        {error && (
          <View style={styles.warn}>
            <Text style={styles.warnText}>No se pudo actualizar. {error}</Text>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={[styles.title, { flex: 1 }]}>{nombreMaquina(orden.maquina)}</Text>
            <View style={[styles.chip, { backgroundColor: estadoColor }]}>
              <Text style={styles.chipText}>{ESTADO_ORDEN_LABELS[orden.estado]}</Text>
            </View>
          </View>
          <Text style={styles.sub}>
            {TIPO_MAQUINA_LABELS[orden.maquina.tipo]}
            {orden.maquina.patente_serie ? ` · ${orden.maquina.patente_serie}` : ''}
            {` · ${FINCA_LABELS[orden.finca]}`}
          </Text>
          <Text style={styles.body}>{orden.descripcion}</Text>
          <Text style={styles.meta}>
            {GRAVEDAD_FALLA_LABELS[orden.gravedad]} · reportada {fmtFechaHora(orden.created_at)}
          </Text>
          {orden.taller && <Text style={styles.meta}>Taller: {orden.taller}</Text>}
          {orden.fecha_estimada_entrega && (
            <Text style={styles.meta}>Entrega estimada: {orden.fecha_estimada_entrega.split('-').reverse().join('/')}</Text>
          )}
        </View>

        {acciones.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Acciones</Text>
            {acciones.includes('aprobar_rechazar_presupuesto') && presupuestoPendiente && (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.sangre }, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => rechazar(presupuestoPendiente.id)}
                >
                  <Text style={styles.primaryText}>Rechazar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.verdeCampo }, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => aprobar(presupuestoPendiente.id, presupuestoPendiente.monto)}
                >
                  <Text style={styles.primaryText}>Aprobar</Text>
                </TouchableOpacity>
              </View>
            )}
            {acciones.includes('confirmar_recepcion') && (
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.verdeCampo }, busy && styles.disabled]}
                disabled={busy}
                onPress={confirmarRecepcion}
              >
                <Text style={styles.primaryText}>Confirmar recepción</Text>
              </TouchableOpacity>
            )}
            {acciones.includes('reabrir') && (
              <TouchableOpacity
                style={[styles.outlineBtn, busy && styles.disabled]}
                disabled={busy}
                onPress={reabrir}
              >
                <Text style={styles.outlineText}>Reabrir (quedó mal)</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Fotos ({orden.fotos.length})</Text>
          <View style={styles.fotosRow}>
            {orden.fotos.map((f) => (
              <Image key={f.id} source={{ uri: f.url }} style={styles.foto} />
            ))}
            {puedeAgregarFoto && (
              <TouchableOpacity
                style={[styles.foto, styles.fotoAdd, busy && styles.disabled]}
                onPress={agregarFoto}
                disabled={busy}
              >
                <ICONS.agregar size={22} color={colors.ink60} strokeWidth={ICON_STROKE} />
                <Text style={styles.fotoAddText}>Agregar foto</Text>
              </TouchableOpacity>
            )}
          </View>
          {orden.fotos.length === 0 && !puedeAgregarFoto && <Text style={styles.meta}>Sin fotos.</Text>}
        </View>

        {orden.presupuestos.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Presupuestos</Text>
            {orden.presupuestos.map((p) => (
              <View key={p.id} style={styles.item}>
                <View style={styles.rowBetween}>
                  <Text style={[styles.itemTitle, { flex: 1 }]}>{p.taller}</Text>
                  <Text style={styles.meta}>{ESTADO_PRESUPUESTO_LABELS[p.estado]}</Text>
                </View>
                {p.monto !== null && <Text style={styles.money}>{formatARS(p.monto)}</Text>}
                {p.detalle && <Text style={styles.body}>{p.detalle}</Text>}
                {p.motivo_rechazo && <Text style={[styles.meta, { color: colors.sangre }]}>Motivo: {p.motivo_rechazo}</Text>}
              </View>
            ))}
          </View>
        )}

        {orden.pago && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Pago</Text>
            {orden.pago.monto_real !== null && <Text style={styles.money}>{formatARS(orden.pago.monto_real)}</Text>}
            <Text style={styles.meta}>Fecha: {orden.pago.fecha.split('-').reverse().join('/')}</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Línea de tiempo</Text>
          {orden.eventos.length === 0 ? (
            <Text style={styles.meta}>Sin eventos.</Text>
          ) : (
            orden.eventos.map((ev) => (
              <View key={ev.id} style={styles.event}>
                <View style={[styles.eventDot, { backgroundColor: colorEstadoOrden(ev.estado_hasta) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{ESTADO_ORDEN_LABELS[ev.estado_hasta]}</Text>
                  <Text style={styles.meta}>
                    {fmtFechaHora(ev.created_at)}{ev.usuario_nombre ? ` · ${ev.usuario_nombre}` : ''}
                  </Text>
                  {ev.nota && <Text style={styles.body}>{ev.nota}</Text>}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={dialog !== null} transparent animationType="fade" onRequestClose={() => setDialog(null)}>
        <KeyboardAvoidingView
          style={styles.modalWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalCard}>
            <Text style={styles.title}>{dialog?.titulo}</Text>
            <Text style={styles.label}>Motivo (obligatorio)</Text>
            <TextInput
              style={styles.input}
              value={motivo}
              onChangeText={setMotivo}
              placeholder="Escribí el motivo"
              placeholderTextColor={colors.niebla}
              multiline
              maxLength={500}
              autoFocus
              textAlignVertical="top"
            />
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.outlineBtnFlex} onPress={() => setDialog(null)}>
                <Text style={styles.outlineText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.burdeos[600] }]}
                onPress={confirmarDialogo}
              >
                <Text style={styles.primaryText}>{dialog?.confirmar}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {busy && (
        <View style={styles.busy} pointerEvents="auto">
          <ActivityIndicator color={colors.blanco} size="large" />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.hueso, padding: 24 },
  content: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.borde,
    padding: 14, gap: 6,
  },
  title: { fontSize: 17, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 13, color: colors.ink60 },
  body: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  meta: { fontSize: 12, color: colors.ink60 },
  label: { fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 8 },
  money: { fontSize: 18, fontWeight: '800', color: colors.ink },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: colors.niebla, letterSpacing: 0.8, textTransform: 'uppercase' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 11, fontWeight: '800', color: colors.blanco },
  warn: { padding: 10, borderRadius: 10, backgroundColor: '#f7edd8' },
  warnText: { fontSize: 12, fontWeight: '600', color: '#8a6a1f' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryBtn: {
    minHeight: 48, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.burdeos[600],
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  primaryText: { color: colors.blanco, fontSize: 15, fontWeight: '700' },
  outlineBtn: {
    minHeight: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.burdeos[600],
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  outlineBtnFlex: {
    flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.burdeos[600],
    alignItems: 'center', justifyContent: 'center',
  },
  outlineText: { color: colors.burdeos[600], fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  fotosRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  foto: { width: 104, height: 104, borderRadius: 10, backgroundColor: colors.hueso },
  fotoAdd: {
    borderWidth: 1.5, borderColor: colors.borde, borderStyle: 'dashed', backgroundColor: colors.blanco,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  fotoAddText: { fontSize: 12, color: colors.ink60, fontWeight: '600' },
  item: { paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.hueso, gap: 3 },
  itemTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  event: { flexDirection: 'row', gap: 10, paddingTop: 8 },
  eventDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  modalWrap: { flex: 1, backgroundColor: 'rgba(31,26,23,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: colors.blanco, borderRadius: 16, padding: 16, gap: 8 },
  input: {
    minHeight: 90, backgroundColor: colors.hueso, borderRadius: 10, borderWidth: 1, borderColor: colors.borde,
    padding: 10, fontSize: 15, color: colors.ink,
  },
  busy: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(31,26,23,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
})
