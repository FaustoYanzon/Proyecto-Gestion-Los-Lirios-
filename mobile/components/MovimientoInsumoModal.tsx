// Ingreso o egreso de stock de un insumo. Dos pasos: formulario -> confirmación -> guardar.
// Requiere conexión. El servidor repite el movimiento original si llega la misma
// idempotency key: la clave se ata al contenido enviado (igual que AlfalfaModal), así un
// reintento idéntico no suma ni resta dos veces y una corrección usa una clave nueva.
import { useState, useRef } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Modal, ActivityIndicator, StyleSheet,
} from 'react-native'
import { ICONS, ICON_STROKE } from '../lib/icons'
import { colors } from '../lib/theme'
import { newIdempotencyKey } from '../lib/idempotency'
import SelectField, { type SelectOption } from './SelectField'
import { hoyISO, fmtFecha, fmtKg, errorDetail } from '../lib/altaProduccion'
import { fechaValida } from '../lib/fecha'
import {
  cantidadInsumoValida, cantidadInsumoToString, registrarMovimientoInsumo, type InsumoStock,
} from '../lib/depositos'

export type ModoMovimiento = 'ingreso' | 'egreso'

interface Props {
  modo: ModoMovimiento
  insumos: InsumoStock[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export default function MovimientoInsumoModal({ modo, insumos, onClose, onSaved }: Props) {
  const esEgreso = modo === 'egreso'
  const submittingRef = useRef(false)
  // One key per attempt; rotated only when the sent content changes.
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey())
  const sentPayloadRef = useRef<string | null>(null)

  const [paso, setPaso] = useState<'form' | 'confirmar'>('form')
  const [insumoId, setInsumoId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  const [destino, setDestino] = useState('')
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guardado, setGuardado] = useState(false)

  const insumo = insumos.find((i) => i.id === insumoId) ?? null
  const opts: SelectOption[] = insumos.map((i) => ({
    value: i.id,
    label: i.nombre,
    sub: `Stock: ${fmtKg(i.stock_actual)} ${i.unidad}`,
  }))
  const titulo = esEgreso ? 'Egreso de insumo' : 'Ingreso de insumo'
  const cantidadNum = Number(cantidadInsumoToString(cantidad))
  const quedan = insumo ? insumo.stock_actual - (esEgreso ? cantidadNum : -cantidadNum) : 0

  function avanzar() {
    setError(null)
    if (!insumo) return setError('Elegí el insumo')
    if (!cantidadInsumoValida(cantidad)) {
      return setError('Ingresá una cantidad mayor a cero, con hasta 2 decimales')
    }
    if (!fechaValida(fecha.trim())) return setError('La fecha no es válida (formato AAAA-MM-DD)')
    if (esEgreso && destino.trim() === '') return setError('Indicá dónde se usó (máquina, tractor o parcela)')
    setPaso('confirmar')
  }

  async function guardar() {
    if (submittingRef.current || !insumo) return
    submittingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const payload = {
        tipo: modo,
        cantidad,
        fecha: fecha.trim(),
        observacion: obs,
        destino: esEgreso ? destino : undefined,
      }
      const json = JSON.stringify({ insumoId: insumo.id, ...payload })
      if (sentPayloadRef.current !== null && sentPayloadRef.current !== json) {
        idempotencyKeyRef.current = newIdempotencyKey()
      }
      sentPayloadRef.current = json
      await registrarMovimientoInsumo(insumo.id, { ...payload, idempotencyKey: idempotencyKeyRef.current })
      setGuardado(true)
      try {
        await onSaved()
      } catch {
        // The movement is already saved; a failed refresh is recovered by pull-to-refresh.
      }
    } catch (e) {
      // Without a response the request may still have reached the server. Retrying the
      // unchanged form is safe (same key), but the user is told to check first anyway.
      const sinRespuesta = !(e as { response?: unknown })?.response
      setError(
        sinRespuesta
          ? 'No sabemos si el movimiento se guardó. Revisá el stock en Depósitos antes de volver a cargarlo, o reintentá con el mismo formulario.'
          : errorDetail(e),
      )
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={2}>{titulo}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={10}>
            <ICONS.cerrar size={18} color={colors.ink60} strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        </View>

        {guardado && insumo ? (
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.okBox}>
              <ICONS.completado size={36} color={colors.verdeCampo} strokeWidth={ICON_STROKE} />
              <Text style={styles.okTitle}>{esEgreso ? 'Egreso registrado' : 'Ingreso registrado'}</Text>
              <Text style={styles.okMeta}>
                {insumo.nombre}: {esEgreso ? '−' : '+'}{cantidadInsumoToString(cantidad)} {insumo.unidad} · {fmtFecha(fecha.trim())}
              </Text>
            </View>
            <TouchableOpacity style={styles.saveBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>Cerrar</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : paso === 'form' ? (
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <SelectField
              label="Insumo *"
              value={insumoId}
              options={opts}
              placeholder={esEgreso ? '¿Qué se usó?' : '¿Qué ingresó?'}
              emptyText="No hay insumos de este tipo"
              onChange={setInsumoId}
            />

            <Text style={styles.fieldLabel}>CANTIDAD{insumo ? ` (${insumo.unidad})` : ''} *</Text>
            <TextInput
              style={styles.input}
              value={cantidad}
              onChangeText={setCantidad}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.niebla}
              maxLength={11}
            />

            <Text style={styles.fieldLabel}>FECHA (AAAA-MM-DD)</Text>
            <TextInput
              style={styles.input}
              value={fecha}
              onChangeText={setFecha}
              placeholder="AAAA-MM-DD"
              placeholderTextColor={colors.niebla}
              maxLength={10}
              keyboardType="numbers-and-punctuation"
            />

            {esEgreso && (
              <>
                <Text style={styles.fieldLabel}>¿DÓNDE SE USÓ? *</Text>
                <TextInput
                  style={styles.input}
                  value={destino}
                  onChangeText={setDestino}
                  placeholder="Tractor, máquina o parcela"
                  placeholderTextColor={colors.niebla}
                  maxLength={200}
                />
              </>
            )}

            <Text style={styles.fieldLabel}>OBSERVACIONES (OPCIONAL)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={obs}
              onChangeText={setObs}
              multiline
              textAlignVertical="top"
              maxLength={500}
              placeholder={esEgreso ? 'Detalle del uso' : 'Proveedor y N° de remito'}
              placeholderTextColor={colors.niebla}
            />

            {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

            <TouchableOpacity style={styles.saveBtn} onPress={avanzar} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>Revisar</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.modalScroll}>
            {insumo && (
              <View style={styles.resumenBox}>
                <Text style={styles.resumenRow}>{insumo.nombre} · {fmtFecha(fecha.trim())}</Text>
                <Text style={styles.resumenLinea}>
                  {esEgreso
                    ? `Se restan ${cantidadInsumoToString(cantidad)} ${insumo.unidad} de ${fmtKg(insumo.stock_actual)} ${insumo.unidad}; quedan ${fmtKg(quedan)} ${insumo.unidad}`
                    : `Se suman ${cantidadInsumoToString(cantidad)} ${insumo.unidad} a ${fmtKg(insumo.stock_actual)} ${insumo.unidad} de stock`}
                </Text>
                {esEgreso && <Text style={styles.resumenRow}>Dónde se usó: {destino.trim()}</Text>}
                {obs.trim() !== '' && <Text style={styles.resumenObs}>{obs.trim()}</Text>}
              </View>
            )}
            {esEgreso && quedan < 0 && (
              <View style={styles.avisoBox}>
                <Text style={styles.avisoText}>El stock va a quedar en negativo. Si falta cargar stock, hacelo antes.</Text>
              </View>
            )}

            {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

            <TouchableOpacity
              style={[styles.saveBtn, { marginTop: 12 }, saving && { opacity: 0.5 }]}
              onPress={guardar}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color={colors.blanco} size="small" />
                : <Text style={styles.saveBtnText}>Confirmar</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelBtn, { marginTop: 10 }, saving && { opacity: 0.5 }]}
              onPress={() => { setError(null); setPaso('form') }}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelBtnText}>Volver</Text>
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

  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },
  input: {
    height: 52, backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.borde,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 10,
  },
  inputMultiline: { height: 80, paddingTop: 12 },

  resumenBox: {
    backgroundColor: colors.blanco, borderRadius: 12, padding: 14, gap: 6,
    borderWidth: 1, borderColor: colors.borde,
  },
  resumenRow: { fontSize: 14, fontWeight: '600', color: colors.ink },
  resumenLinea: { fontSize: 17, fontWeight: '800', color: colors.ink },
  resumenObs: { fontSize: 13, color: colors.ink60, fontStyle: 'italic' },
  avisoBox: { backgroundColor: colors.crema, borderRadius: 10, padding: 12, marginTop: 12 },
  avisoText: { fontSize: 13, fontWeight: '700', color: colors.ink },

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
