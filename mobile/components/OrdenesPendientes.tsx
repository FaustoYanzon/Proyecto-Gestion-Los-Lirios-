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
import api, {
  getOrdenesPendientes, confirmarAplicacionOrden, subirFotoAplicacion,
  confirmarValvulaOrden, subirFotoValvula, deshacerValvulaOrden,
} from '../lib/api'
import { getCache, setCache, CACHE_TTL } from '../lib/cache'
import TrabajadorPicker from './TrabajadorPicker'
import { useAuthStore } from '../store/authStore'
import { elegirImagenDeGaleria } from '../lib/imagePicker'
import { colors } from '../lib/theme'
import type {
  OrdenAplicacion, OrdenAplicacionParcelaItem, OrdenAplicacionValvulaItem,
  ResultadoValvula, Trabajador as TrabajadorDb,
} from '../lib/types'
import {
  ProductosCantidades, ProductosLista, formatDosDecimales, formatDosis, labelVariedades,
  productosDeOrden,
} from './OrdenProductos'

function formatDateDisplay(iso: string) {
  const [y, mo, d] = iso.split('-')
  return `${d}/${mo}/${y}`
}

// Server message verbatim (e.g. the 422 for a valve without hectares);
// FastAPI validation errors come as a list of {msg}.
function apiErrorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : ''))
      .filter(Boolean)
    if (msgs.length > 0) return msgs.join('\n')
  }
  return fallback
}

function productosLabel(n: number) {
  return n === 1 ? 'PRODUCTO' : `PRODUCTOS (${n})`
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
      Alert.alert('Error', apiErrorMessage(e, 'No se pudo confirmar la aplicación.'))
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  if (!orden || !item) return null
  const productos = productosDeOrden(orden)

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
              { label: 'Objetivo', value: orden.objetivo },
            ].map(({ label, value }, idx, arr) => (
              <View key={label} style={[styles.summaryRow, idx < arr.length - 1 && styles.summaryRowBorder]}>
                <Text style={styles.summaryLabel}>{label}</Text>
                <Text style={[styles.summaryValue, { flex: 1, textAlign: 'right' }]}>{value}</Text>
              </View>
            ))}
          </View>

          {/* The parcel surface is not in this payload: only doses are shown;
              the server computes each quantity from the parcel's hectares. */}
          <Text style={[styles.fieldLabel, { marginTop: 20 }]}>{productosLabel(productos.length)}</Text>
          <ProductosCantidades productos={productos} />

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

// ─── Modal de confirmación por válvula ──────────────────────────────────────

function ConfirmarValvulaModal({
  visible, orden, item, valvula, trabajadoresDb, onClose, onConfirmed,
}: {
  visible: boolean
  orden: OrdenAplicacion | null
  item: OrdenAplicacionParcelaItem | null
  valvula: OrdenAplicacionValvulaItem | null
  trabajadoresDb: TrabajadorDb[]
  onClose: () => void
  onConfirmed: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const [resultado, setResultado] = useState<ResultadoValvula>('completa')
  const [observaciones, setObservaciones] = useState('')
  const [responsable, setResponsable] = useState('')
  const [responsableId, setResponsableId] = useState<string | undefined>(undefined)
  const [fotoUri, setFotoUri] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (visible) {
      setResultado('completa'); setObservaciones(''); setFotoUri(null)
      setResponsable(user?.full_name ?? ''); setResponsableId(undefined)
    }
  }, [visible, user?.full_name])

  async function handleElegirFoto() {
    const uri = await elegirImagenDeGaleria()
    if (uri) setFotoUri(uri)
  }

  async function handleConfirmar() {
    if (!orden || !valvula || submittingRef.current) return
    if (resultado === 'no_aplicada' && !observaciones.trim()) {
      Alert.alert('Falta contar por qué', 'Si la válvula no se aplicó, escribí el motivo en las observaciones.')
      return
    }
    submittingRef.current = true
    setLoading(true)
    try {
      await confirmarValvulaOrden(orden.id, valvula.id, {
        resultado,
        responsable_id: responsableId,
        observaciones: observaciones.trim() || undefined,
      })
      if (fotoUri) {
        try {
          await subirFotoValvula(valvula.id, fotoUri)
        } catch {
          Alert.alert(
            'Válvula confirmada',
            'Se guardó la confirmación, pero la foto no se pudo subir.',
          )
        }
      }
      onConfirmed()
    } catch (e: unknown) {
      Alert.alert('Error', apiErrorMessage(e, 'No se pudo confirmar la válvula.'))
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  if (!orden || !item || !valvula) return null
  const productos = productosDeOrden(orden)
  const sinSuperficie = valvula.superficie_ha === null || valvula.superficie_ha === ''

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.hueso }}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Confirmar válvula</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <ICONS.cerrar size={20} color={colors.ink} strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={styles.summaryCard}>
            {[
              { label: 'Parral', value: item.parcela_nombre },
              { label: 'Válvula', value: valvula.valvula_nombre },
              { label: 'Superficie', value: valvula.superficie_ha ? `${formatDosDecimales(valvula.superficie_ha)} ha` : '—' },
              { label: 'Objetivo', value: orden.objetivo },
            ].map(({ label, value }, idx, arr) => (
              <View key={label} style={[styles.summaryRow, idx < arr.length - 1 && styles.summaryRowBorder]}>
                <Text style={styles.summaryLabel}>{label}</Text>
                <Text style={[styles.summaryValue, { flex: 1, textAlign: 'right' }]}>{value}</Text>
              </View>
            ))}
          </View>

          {/* One tap confirms every product: the server creates one record per line. */}
          <Text style={[styles.fieldLabel, { marginTop: 20 }]}>
            {productosLabel(productos.length)}{' '}
            <Text style={{ textTransform: 'none', fontWeight: '400' }}>(cantidad para esta válvula)</Text>
          </Text>
          <ProductosCantidades productos={productos} superficieHa={valvula.superficie_ha} />
          {sinSuperficie && resultado === 'completa' && (
            <Text style={styles.avisoText}>
              Esta válvula no tiene hectáreas cargadas: no se puede calcular la cantidad.
            </Text>
          )}

          <Text style={[styles.fieldLabel, { marginTop: 20 }]}>RESPONSABLE</Text>
          <TrabajadorPicker
            value={responsable}
            trabajadorId={responsableId}
            trabajadoresDb={trabajadoresDb}
            onChange={(nombre, trabajadorId) => { setResponsable(nombre); setResponsableId(trabajadorId) }}
            placeholder="Nombre del responsable..."
          />

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>RESULTADO</Text>
          <View style={styles.resultadoRow}>
            {([['completa', 'Aplicada'], ['no_aplicada', 'No aplicada']] as const).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.resultadoBtn,
                  resultado === key && (key === 'completa' ? styles.resultadoBtnOk : styles.resultadoBtnMal),
                ]}
                onPress={() => setResultado(key)}
                activeOpacity={0.75}
              >
                <Text style={[styles.resultadoText, resultado === key && { color: colors.blanco }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>
            OBSERVACIONES{' '}
            <Text style={{ textTransform: 'none', fontWeight: '400' }}>
              {resultado === 'no_aplicada' ? '(obligatorias)' : '(opcional)'}
            </Text>
          </Text>
          <TextInput
            style={styles.textarea}
            value={observaciones}
            onChangeText={setObservaciones}
            placeholder={
              resultado === 'no_aplicada'
                ? 'Ej: se cortó el agua, caño roto...'
                : 'Si quedó incompleta, anotalo: se avisa al encargado'
            }
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
                <Text style={styles.primaryBtnText}>Confirmar válvula</Text>
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
  orden, onSelectItem, onSelectValvula, puedeDeshacer, deshaciendoId, onDeshacerValvula,
}: {
  orden: OrdenAplicacion
  onSelectItem: (item: OrdenAplicacionParcelaItem) => void
  onSelectValvula: (item: OrdenAplicacionParcelaItem, valvula: OrdenAplicacionValvulaItem) => void
  puedeDeshacer: boolean
  deshaciendoId: string | null
  onDeshacerValvula: (valvula: OrdenAplicacionValvulaItem) => void
}) {
  const pendientes = orden.parcelas.filter((p) => p.estado === 'pendiente')
  const aplicadas = orden.parcelas.filter((p) => p.estado === 'aplicada')
  // Parrales con válvulas: al tocarlos se despliegan para confirmar de a una.
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setAbiertas((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const productos = productosDeOrden(orden)
  const unProducto = productos.length === 1

  return (
    <View style={styles.ordenCard}>
      <View style={styles.ordenHeader}>
        <View style={{ flex: 1 }}>
          {unProducto ? (
            // Single product: same layout as before multi-product orders.
            <>
              <Text style={styles.ordenProducto}>{productos[0].nombre}</Text>
              <Text style={styles.ordenSub}>{formatDosis(productos[0])} · {orden.objetivo}</Text>
            </>
          ) : (
            <>
              <Text style={styles.ordenProducto}>{orden.objetivo?.trim() || 'Aplicación'}</Text>
              <Text style={styles.ordenSub}>{productos.length} productos</Text>
            </>
          )}
        </View>
        <View style={styles.origenBadge}>
          <Text style={styles.origenBadgeText}>{ORIGEN_LABELS[orden.origen] ?? orden.origen}</Text>
        </View>
      </View>
      {!unProducto && <ProductosLista productos={productos} />}
      <Text style={styles.ordenMeta}>
        {labelVariedades(orden)} · Planificada {formatDateDisplay(orden.fecha_planificada)}
      </Text>

      <View style={styles.parcelasWrap}>
        {pendientes.map((item) => {
          const valvulas = item.valvulas ?? []
          if (valvulas.length === 0) {
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.parcelaChipPendiente}
                onPress={() => onSelectItem(item)}
                activeOpacity={0.75}
              >
                <Text style={styles.parcelaChipPendienteText}>{item.parcela_nombre}</Text>
              </TouchableOpacity>
            )
          }
          const hechas = valvulas.filter((v) => v.estado === 'aplicada').length
          const abierta = abiertas.has(item.id)
          return (
            <View key={item.id} style={styles.parcelaGrupo}>
              <TouchableOpacity
                style={styles.parcelaChipPendiente}
                onPress={() => toggle(item.id)}
                activeOpacity={0.75}
              >
                <Text style={styles.parcelaChipPendienteText}>
                  {item.parcela_nombre} · {hechas}/{valvulas.length} {abierta ? '▲' : '▼'}
                </Text>
              </TouchableOpacity>
              {abierta && (
                <View style={styles.valvulasWrap}>
                  {valvulas.map((v) =>
                    v.estado === 'pendiente' ? (
                      <TouchableOpacity
                        key={v.id}
                        style={styles.valvulaChipPendiente}
                        onPress={() => onSelectValvula(item, v)}
                        activeOpacity={0.75}
                      >
                        <Text style={styles.valvulaChipPendienteText}>Válvula {v.valvula_nombre}</Text>
                      </TouchableOpacity>
                    ) : (
                      <View
                        key={v.id}
                        style={[styles.valvulaChipHecha, v.resultado === 'no_aplicada' && styles.valvulaChipMal]}
                      >
                        <Text style={[styles.parcelaChipAplicadaText, v.resultado === 'no_aplicada' && { color: colors.blanco, textDecorationLine: 'none' }]}>
                          {v.resultado === 'no_aplicada' ? '✕ ' : '✓ '}Válvula {v.valvula_nombre}
                        </Text>
                        {puedeDeshacer && (
                          <TouchableOpacity
                            onPress={() => onDeshacerValvula(v)}
                            disabled={deshaciendoId !== null}
                            activeOpacity={0.75}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            style={[styles.deshacerBtn, deshaciendoId !== null && { opacity: 0.5 }]}
                          >
                            {deshaciendoId === v.id ? (
                              <ActivityIndicator size="small" color={colors.tierra} />
                            ) : (
                              <Text style={styles.deshacerBtnText}>Deshacer</Text>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                    ),
                  )}
                </View>
              )}
            </View>
          )
        })}
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
  const [modalValvula, setModalValvula] = useState<OrdenAplicacionValvulaItem | null>(null)
  const [trabajadoresDb, setTrabajadoresDb] = useState<TrabajadorDb[]>([])
  const role = useAuthStore((s) => s.user?.role)
  // Same roles the backend allows to undo; regador/obrero never see the button.
  const puedeDeshacer = role === 'super_admin' || role === 'gerencial' || role === 'encargado'
  const [deshaciendoId, setDeshaciendoId] = useState<string | null>(null)
  const deshaciendoRef = useRef(false)

  const loadTrabajadoresDb = useCallback(async () => {
    const cached = await getCache<TrabajadorDb[]>('trabajadores', CACHE_TTL.trabajadores)
    if (cached) setTrabajadoresDb(cached)
    try {
      const { data } = await api.get<TrabajadorDb[]>('/trabajadores/', { params: { is_active: true } })
      setTrabajadoresDb(data)
      await setCache('trabajadores', data)
    } catch { /* offline: queda la lista en cache */ }
  }, [])

  const load = useCallback(async () => {
    try {
      const data = await getOrdenesPendientes()
      setOrdenes(data)
    } catch { /* offline o sin permisos -- la sección simplemente no muestra nada nuevo */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadTrabajadoresDb() }, [loadTrabajadoresDb])

  function handleSelectItem(orden: OrdenAplicacion, item: OrdenAplicacionParcelaItem) {
    setModalOrden(orden)
    setModalItem(item)
  }

  function handleSelectValvula(
    orden: OrdenAplicacion, item: OrdenAplicacionParcelaItem, valvula: OrdenAplicacionValvulaItem,
  ) {
    setModalOrden(orden)
    setModalItem(item)
    setModalValvula(valvula)
  }

  function handleDeshacerValvula(orden: OrdenAplicacion, valvula: OrdenAplicacionValvulaItem) {
    if (deshaciendoRef.current) return
    Alert.alert(
      'Deshacer válvula',
      `Se va a deshacer la confirmación de la válvula ${valvula.valvula_nombre}. Se devuelve el stock del insumo y se borra el registro fitosanitario. ¿Continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Deshacer',
          style: 'destructive',
          onPress: async () => {
            // Ref guards against a double tap before state re-renders.
            if (deshaciendoRef.current) return
            deshaciendoRef.current = true
            setDeshaciendoId(valvula.id)
            try {
              await deshacerValvulaOrden(orden.id, valvula.id)
              await load()
              onConfirmado() // refreshes the fito records list (the record was deleted)
            } catch (e: unknown) {
              const err = e as { response?: { data?: { detail?: string } } }
              const detail = err.response?.data?.detail
              Alert.alert('Error', typeof detail === 'string' ? detail : 'No se pudo deshacer la válvula.')
              // State may have changed server-side (409): resync the list.
              load()
            } finally {
              deshaciendoRef.current = false
              setDeshaciendoId(null)
            }
          },
        },
      ],
    )
  }

  function handleConfirmed() {
    setModalOrden(null)
    setModalItem(null)
    setModalValvula(null)
    load()
    onConfirmado()
  }

  if (loading) {
    return <ActivityIndicator color={colors.tierra} style={{ marginBottom: 16 }} />
  }
  if (ordenes.length === 0) {
    return (
      <View style={styles.emptyState}>
        <ICONS.fitosanitario size={36} color={colors.hueso} strokeWidth={ICON_STROKE} />
        <Text style={styles.emptyStateTitle}>No hay órdenes pendientes ni en curso</Text>
      </View>
    )
  }

  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={styles.sectionLabel}>PENDIENTES Y EN CURSO</Text>
      {ordenes.map((orden) => (
        <OrdenCard
          key={orden.id}
          orden={orden}
          onSelectItem={(item) => handleSelectItem(orden, item)}
          onSelectValvula={(item, valvula) => handleSelectValvula(orden, item, valvula)}
          puedeDeshacer={puedeDeshacer}
          deshaciendoId={deshaciendoId}
          onDeshacerValvula={(valvula) => handleDeshacerValvula(orden, valvula)}
        />
      ))}
      <ConfirmarValvulaModal
        visible={!!modalValvula}
        orden={modalOrden}
        item={modalItem}
        valvula={modalValvula}
        trabajadoresDb={trabajadoresDb}
        onClose={() => { setModalOrden(null); setModalItem(null); setModalValvula(null) }}
        onConfirmed={handleConfirmed}
      />
      <ConfirmarModal
        visible={!!modalItem && !modalValvula}
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
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyStateTitle: { fontSize: 15, fontWeight: '600', color: colors.ink60, marginTop: 12 },
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
  parcelaGrupo: { alignItems: 'flex-start' },
  valvulasWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, marginLeft: 8 },
  valvulaChipPendiente: {
    backgroundColor: colors.crema, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1.5, borderColor: colors.tierra,
  },
  valvulaChipPendienteText: { fontSize: 13, fontWeight: '700', color: colors.tierra },
  valvulaChipHecha: {
    backgroundColor: colors.hueso, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  deshacerBtn: {
    marginTop: 6, backgroundColor: colors.blanco, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center',
  },
  deshacerBtnText: { fontSize: 11, fontWeight: '700', color: colors.tierra },
  valvulaChipMal: { backgroundColor: colors.ink60 },
  resultadoRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  resultadoBtn: {
    flex: 1, height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.borde,
    backgroundColor: colors.blanco, justifyContent: 'center', alignItems: 'center',
  },
  resultadoBtnOk: { backgroundColor: colors.tierra, borderColor: colors.tierra },
  resultadoBtnMal: { backgroundColor: colors.ink60, borderColor: colors.ink60 },
  resultadoText: { fontSize: 14, fontWeight: '700', color: colors.ink60 },
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
  avisoText: { fontSize: 12, color: colors.tierra, fontWeight: '600', marginTop: 8 },
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
