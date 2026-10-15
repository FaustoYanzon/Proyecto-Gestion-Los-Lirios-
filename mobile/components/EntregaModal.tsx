// Entrega de pasa a un comprador, por bines: se tildan los bines / bolsones de un
// lote cerrado que salen (o "Todo el lote"). El peso del remito es la suma de los
// pesos reales ya cargados (no se tipea), y cada bin sale una sola vez.
// Requiere conexión (el backend valida que cada bin siga disponible).
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { ICONS, ICON_STROKE } from '../lib/icons'
import { colors } from '../lib/theme'
import SelectField, { type SelectOption } from './SelectField'
import { loteNombre } from './LoteModal'
import {
  fmtKg, hoyISO, errorDetail, getLotePasa, createEntregaPasa, abrirRemitoPdf,
  type Comprador, type LotePasaDetalle, type RemitoEntrega,
} from '../lib/altaProduccion'

interface Props {
  loteId: string
  compradores: Comprador[]
  onClose: () => void
  onChanged: () => Promise<void>
}

export default function EntregaModal({ loteId, compradores, onClose, onChanged }: Props) {
  const [lote, setLote] = useState<LotePasaDetalle | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [compradorId, setCompradorId] = useState('')
  const [patente, setPatente] = useState('')
  const [obs, setObs] = useState('')
  const [elegidos, setElegidos] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [remito, setRemito] = useState<RemitoEntrega | null>(null)
  const [imprimiendo, setImprimiendo] = useState(false)
  const submittingRef = useRef(false)

  const cargar = useCallback(async () => {
    try {
      setLote(await getLotePasa(loteId))
      setLoadError(null)
    } catch (e) {
      setLoadError(errorDetail(e, 'No se pudo cargar el lote'))
    }
  }, [loteId])

  useEffect(() => { cargar() }, [cargar])

  const disponibles = (lote?.bines ?? []).filter((b) => !b.entregado)
  const idsElegidos = disponibles.filter((b) => elegidos[b.id]).map((b) => b.id)
  const totalKg = disponibles.filter((b) => elegidos[b.id]).reduce((s, b) => s + b.kg_real, 0)
  const todos = disponibles.length > 0 && idsElegidos.length === disponibles.length

  const compradorOpts: SelectOption[] = compradores.map((c) => ({ value: c.id, label: c.nombre }))

  function toggleTodos() {
    setElegidos(todos ? {} : Object.fromEntries(disponibles.map((b) => [b.id, true])))
  }

  async function emitir() {
    if (submittingRef.current || idsElegidos.length === 0 || !compradorId) return
    submittingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const r = await createEntregaPasa({
        fecha: hoyISO(),
        comprador_id: compradorId,
        vehiculo_patente: patente.trim() || null,
        observaciones: obs.trim() || null,
        bin_ids: idsElegidos,
      })
      setRemito(r)
      await onChanged()
    } catch (e) {
      setError(errorDetail(e))
      // Otro operario pudo haber entregado un bin: se refresca la lista.
      cargar()
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  async function imprimir() {
    if (!remito) return
    setImprimiendo(true)
    setError(null)
    try {
      await abrirRemitoPdf(remito.id)
    } catch (e) {
      setError(errorDetail(e, 'No se pudo abrir el PDF del remito'))
    } finally {
      setImprimiendo(false)
    }
  }

  const puedeEmitir = !saving && !!compradorId && idsElegidos.length > 0

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={2}>{lote ? loteNombre(lote) : 'Entrega de pasa'}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={10}>
            <ICONS.cerrar size={18} color={colors.ink60} strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        </View>

        {loadError ? (
          <View style={styles.modalScroll}>
            <View style={styles.errorBox}><Text style={styles.errorText}>{loadError}</Text></View>
          </View>
        ) : !lote ? (
          <ActivityIndicator color={colors.tierra} style={{ marginTop: 40 }} />
        ) : remito ? (
          // ── Remito emitido ──
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.okBox}>
              <ICONS.completado size={36} color={colors.verdeCampo} strokeWidth={ICON_STROKE} />
              <Text style={styles.okTitle}>Remito {remito.numero}</Text>
              <Text style={styles.okMeta}>
                {remito.cantidad_bines} {remito.cantidad_bines === 1 ? 'bin' : 'bines'} · {fmtKg(remito.kg_total)} kg
                {remito.comprador_nombre ? ` · ${remito.comprador_nombre}` : ''}
              </Text>
            </View>
            {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
            <TouchableOpacity style={styles.saveBtn} onPress={imprimir} disabled={imprimiendo} activeOpacity={0.85}>
              {imprimiendo
                ? <ActivityIndicator color={colors.blanco} size="small" />
                : <Text style={styles.saveBtnText}>Imprimir remito</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 10 }]} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.cancelBtnText}>Cerrar</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <SelectField
              label="Comprador *"
              value={compradorId}
              options={compradorOpts}
              placeholder="¿A quién se entrega?"
              emptyText="No hay compradores activos"
              onChange={setCompradorId}
            />

            <Text style={[styles.sectionLabel, { marginTop: 8 }]}>BINES / BOLSONES A ENTREGAR</Text>
            {lote.bines.length === 0 ? (
              <Text style={styles.muted}>Este lote no tiene bines.</Text>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.todoRow, disponibles.length === 0 && { opacity: 0.5 }]}
                  onPress={toggleTodos}
                  disabled={disponibles.length === 0}
                  activeOpacity={0.8}
                >
                  {todos
                    ? <ICONS.casillamarcada size={24} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />
                    : <ICONS.casilla size={24} color={colors.niebla} strokeWidth={ICON_STROKE} />}
                  <Text style={styles.todoText}>
                    Todo el lote ({disponibles.length} {disponibles.length === 1 ? 'bin' : 'bines'} ·{' '}
                    {fmtKg(disponibles.reduce((s, b) => s + b.kg_real, 0))} kg)
                  </Text>
                </TouchableOpacity>

                {lote.bines.map((b) => {
                  const marcado = !!elegidos[b.id]
                  return (
                    <TouchableOpacity
                      key={b.id}
                      style={[styles.binRow, marcado && styles.binRowMarcado, b.entregado && { opacity: 0.5 }]}
                      onPress={() => setElegidos((e) => ({ ...e, [b.id]: !e[b.id] }))}
                      disabled={b.entregado}
                      activeOpacity={0.8}
                    >
                      {marcado
                        ? <ICONS.casillamarcada size={24} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />
                        : <ICONS.casilla size={24} color={colors.niebla} strokeWidth={ICON_STROKE} />}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.binTarja}>{b.tarja}</Text>
                        <Text style={styles.binKg}>{fmtKg(b.kg_real)} kg</Text>
                        {b.entregado
                          ? <Text style={styles.metaText}>Entregado en {b.remito_numero ?? 'otro remito'}</Text>
                          : b.observaciones ? <Text style={styles.obsText}>{b.observaciones}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  )
                })}
              </>
            )}

            <View style={styles.totalBox}>
              <Text style={styles.totalLabel}>TOTAL A ENTREGAR</Text>
              <Text style={styles.totalValue}>
                {fmtKg(totalKg)} kg <Text style={styles.metaText}>· {idsElegidos.length} {idsElegidos.length === 1 ? 'bin' : 'bines'}</Text>
              </Text>
            </View>

            <Text style={styles.fieldLabel}>PATENTE DEL VEHÍCULO (OPCIONAL)</Text>
            <TextInput
              style={styles.input}
              value={patente}
              onChangeText={setPatente}
              autoCapitalize="characters"
              placeholder="Ej.: AB123CD"
              placeholderTextColor={colors.niebla}
              maxLength={20}
            />
            <Text style={styles.fieldLabel}>OBSERVACIONES (OPCIONAL)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={obs}
              onChangeText={setObs}
              multiline
              textAlignVertical="top"
              maxLength={500}
              placeholderTextColor={colors.niebla}
            />

            {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

            <TouchableOpacity
              style={[styles.saveBtn, !puedeEmitir && { opacity: 0.5 }]}
              onPress={emitir}
              disabled={!puedeEmitir}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color={colors.blanco} size="small" />
                : <Text style={styles.saveBtnText}>Emitir remito</Text>}
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  modalContainer: { flex: 1, backgroundColor: colors.hueso, paddingTop: 16 },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.borde,
  },
  modalTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.ink },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.crema,
    justifyContent: 'center', alignItems: 'center',
  },
  modalScroll: { padding: 16, paddingBottom: 40 },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  muted: { fontSize: 13, color: colors.ink60 },
  metaText: { fontSize: 12, fontWeight: '400', color: colors.ink60 },

  todoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52,
    backgroundColor: colors.crema, borderRadius: 12, paddingHorizontal: 12, marginBottom: 8,
  },
  todoText: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  binRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56,
    backgroundColor: colors.blanco, borderRadius: 12, padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: colors.borde,
  },
  binRowMarcado: { borderColor: colors.burdeos[600], backgroundColor: '#fbf3f4' },
  binTarja: { fontSize: 12, fontWeight: '800', color: colors.burdeos[600], letterSpacing: 0.3, marginBottom: 2 },
  binKg: { fontSize: 15, fontWeight: '700', color: colors.ink },
  obsText: { fontSize: 12, color: colors.ink, fontStyle: 'italic', marginTop: 2 },

  totalBox: {
    backgroundColor: colors.blanco, borderRadius: 12, padding: 14, marginVertical: 12,
    borderWidth: 1, borderColor: colors.borde,
  },
  totalLabel: { fontSize: 10, fontWeight: '700', color: colors.niebla, letterSpacing: 0.6 },
  totalValue: { fontSize: 22, fontWeight: '800', color: colors.ink, marginTop: 2 },

  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },
  input: {
    height: 52, backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.borde,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 10,
  },
  inputMultiline: { height: 80, paddingTop: 12 },

  errorBox: { backgroundColor: '#fdf0f1', borderRadius: 10, padding: 12, marginVertical: 8 },
  errorText: { fontSize: 13, color: colors.sangre, fontWeight: '600' },

  okBox: { alignItems: 'center', gap: 6, paddingVertical: 24 },
  okTitle: { fontSize: 22, fontWeight: '800', color: colors.ink },
  okMeta: { fontSize: 14, color: colors.ink60, textAlign: 'center' },

  saveBtn: {
    height: 52, borderRadius: 12, backgroundColor: colors.burdeos[600],
    justifyContent: 'center', alignItems: 'center', marginTop: 4,
  },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: colors.blanco },
  cancelBtn: {
    height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.borde,
    justifyContent: 'center', alignItems: 'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: colors.ink60 },
})
