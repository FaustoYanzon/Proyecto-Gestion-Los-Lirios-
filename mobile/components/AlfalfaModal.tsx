// Alta (potrero -> deposito) o entrega (deposito -> comprador) de alfalfa.
// Flujo en dos pasos: formulario -> revision -> Guardar. Una vez guardado solo un
// super admin puede anular el documento, por eso la revision es obligatoria.
// Requiere conexion: el backend valida el stock al momento de guardar.
import { useState, useRef } from 'react'
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
import { newIdempotencyKey } from '../lib/idempotency'
import SelectField, { type SelectOption } from './SelectField'
import { hoyISO, fmtFecha, errorDetail, kgToString, type Comprador } from '../lib/altaProduccion'
import {
  PRODUCTO_LABELS, PRODUCTO_UNIDAD, cantidadAlfalfaValida, createDocumentoAlfalfa, abrirDocumentoAlfalfaPdf,
  type ProductoAlfalfa, type DocumentoAlfalfa, type TipoDocumentoAlfalfa,
} from '../lib/alfalfa'
import type { Parcela } from '../lib/types'

const PRODUCTOS: ProductoAlfalfa[] = ['fardo', 'rollo', 'semilla']
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/

// Rejects impossible dates such as 2026-13-45 or 2026-02-30 (Date would roll them over).
function fechaValida(s: string): boolean {
  if (!FECHA_REGEX.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

interface Props {
  tipo: TipoDocumentoAlfalfa
  potreros: Parcela[]
  compradores: Comprador[]
  onClose: () => void
  onSaved: (doc: DocumentoAlfalfa) => void | Promise<void>
}

export default function AlfalfaModal({ tipo, potreros, compradores, onClose, onSaved }: Props) {
  // One key per attempt: the modal is mounted on open, so a new open = a new key.
  // Retries after an error reuse it; the backend absorbs duplicates.
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey())
  const submittingRef = useRef(false)
  // JSON of the payload (without key) the current key was last sent with.
  const sentPayloadRef = useRef<string | null>(null)

  const [paso, setPaso] = useState<'form' | 'revision'>('form')
  const [potreroId, setPotreroId] = useState('')
  const [compradorId, setCompradorId] = useState('')
  const [patente, setPatente] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  const [cantidades, setCantidades] = useState<Record<ProductoAlfalfa, string>>({ fardo: '', rollo: '', semilla: '' })
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<DocumentoAlfalfa | null>(null)
  const [abriendo, setAbriendo] = useState(false)

  const esAlta = tipo === 'alta'
  const potreroOpts: SelectOption[] = potreros.map((p) => ({ value: p.id, label: p.nombre }))
  const compradorOpts: SelectOption[] = compradores.map((c) => ({ value: c.id, label: c.nombre }))
  const lineasCargadas = PRODUCTOS.filter((p) => cantidades[p].trim() !== '')
  const potreroNombre = potreros.find((p) => p.id === potreroId)?.nombre ?? ''
  const compradorNombre = compradores.find((c) => c.id === compradorId)?.nombre ?? ''

  function avanzar() {
    setError(null)
    if (esAlta && !potreroId) return setError('Elegí el potrero de origen')
    if (!esAlta && !compradorId) return setError('Elegí el comprador')
    if (!fechaValida(fecha.trim())) return setError('La fecha no es válida (formato AAAA-MM-DD)')
    if (lineasCargadas.length === 0) return setError('Cargá la cantidad de al menos un producto')
    for (const p of lineasCargadas) {
      if (!cantidadAlfalfaValida(p, cantidades[p])) {
        return setError(
          PRODUCTO_UNIDAD[p] === 'unidades'
            ? `${PRODUCTO_LABELS[p]}: ingresá un número entero mayor a cero`
            : `${PRODUCTO_LABELS[p]}: ingresá kg mayores a cero (hasta 2 decimales)`,
        )
      }
    }
    setPaso('revision')
  }

  async function guardar() {
    if (submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const payload = {
        tipo,
        fecha: fecha.trim(),
        potrero_id: esAlta ? potreroId : null,
        comprador_id: esAlta ? null : compradorId,
        vehiculo_patente: esAlta ? null : patente.trim() || null,
        observaciones: obs.trim() || null,
        lineas: lineasCargadas.map((p) => ({ producto: p, cantidad: kgToString(cantidades[p]) })),
      }
      // Key is bound to content: an unchanged retry replays the same document,
      // an edited one is a new document and needs a new key.
      const json = JSON.stringify(payload)
      if (sentPayloadRef.current !== null && sentPayloadRef.current !== json) {
        idempotencyKeyRef.current = newIdempotencyKey()
      }
      sentPayloadRef.current = json
      const doc = await createDocumentoAlfalfa({ ...payload, idempotency_key: idempotencyKeyRef.current })
      setSaved(doc)
      try {
        await onSaved(doc)
      } catch {
        // The document is already saved; a failed list refresh is recovered by pull-to-refresh.
      }
    } catch (e) {
      // Stay in the modal on the review step with the typed values intact.
      setError(errorDetail(e))
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  async function abrirPdf() {
    if (!saved) return
    setAbriendo(true)
    setError(null)
    try {
      await abrirDocumentoAlfalfaPdf(saved.id)
    } catch (e) {
      setError(errorDetail(e, 'No se pudo abrir el PDF'))
    } finally {
      setAbriendo(false)
    }
  }

  const titulo = esAlta ? 'Alta de alfalfa' : 'Entrega de alfalfa'

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle} numberOfLines={2}>{titulo}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={10}>
            <ICONS.cerrar size={18} color={colors.ink60} strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        </View>

        {saved ? (
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.okBox}>
              <ICONS.completado size={36} color={colors.verdeCampo} strokeWidth={ICON_STROKE} />
              <Text style={styles.okTitle}>Documento {saved.numero}</Text>
              <Text style={styles.okMeta}>{saved.kg_total.toLocaleString('es-AR')} kg · {fmtFecha(saved.fecha)}</Text>
            </View>
            {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
            <TouchableOpacity style={styles.saveBtn} onPress={abrirPdf} disabled={abriendo} activeOpacity={0.85}>
              {abriendo
                ? <ActivityIndicator color={colors.blanco} size="small" />
                : <Text style={styles.saveBtnText}>Abrir PDF</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 10 }]} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.cancelBtnText}>Cerrar</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : paso === 'form' ? (
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            {esAlta ? (
              <SelectField
                label="Potrero *"
                value={potreroId}
                options={potreroOpts}
                placeholder="¿De qué potrero viene?"
                emptyText="No hay potreros activos"
                onChange={setPotreroId}
              />
            ) : (
              <SelectField
                label="Comprador *"
                value={compradorId}
                options={compradorOpts}
                placeholder="¿A quién se entrega?"
                emptyText="No hay compradores activos"
                onChange={setCompradorId}
              />
            )}

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

            <Text style={[styles.sectionLabel, { marginTop: 8 }]}>CANTIDADES</Text>
            {PRODUCTOS.map((p) => (
              <View key={p}>
                <Text style={styles.fieldLabel}>
                  {PRODUCTO_LABELS[p]} ({PRODUCTO_UNIDAD[p] === 'kg' ? 'kg' : 'unidades'})
                </Text>
                <TextInput
                  style={styles.input}
                  value={cantidades[p]}
                  onChangeText={(t) => setCantidades((c) => ({ ...c, [p]: t }))}
                  keyboardType={PRODUCTO_UNIDAD[p] === 'kg' ? 'decimal-pad' : 'number-pad'}
                  placeholder="0"
                  placeholderTextColor={colors.niebla}
                  maxLength={12}
                />
              </View>
            ))}

            {!esAlta && (
              <>
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
              placeholderTextColor={colors.niebla}
            />

            {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

            <TouchableOpacity style={styles.saveBtn} onPress={avanzar} activeOpacity={0.85}>
              <Text style={styles.saveBtnText}>Revisar</Text>
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.resumenBox}>
              <Text style={styles.resumenRow}>{esAlta ? 'Alta' : 'Entrega'} · {fmtFecha(fecha.trim())}</Text>
              <Text style={styles.resumenRow}>
                {esAlta ? `Potrero: ${potreroNombre}` : `Comprador: ${compradorNombre}`}
              </Text>
              {!esAlta && patente.trim() !== '' && <Text style={styles.resumenRow}>Patente: {patente.trim()}</Text>}
              {lineasCargadas.map((p) => (
                <Text key={p} style={styles.resumenLinea}>
                  {PRODUCTO_LABELS[p]}: {kgToString(cantidades[p])} {PRODUCTO_UNIDAD[p] === 'kg' ? 'kg' : 'u.'}
                </Text>
              ))}
              {obs.trim() !== '' && <Text style={styles.resumenObs}>{obs.trim()}</Text>}
            </View>

            <View style={styles.avisoBox}>
              <Text style={styles.avisoText}>
                Revisá bien el documento antes de guardar: una vez guardado, solo un super admin puede anularlo.
              </Text>
            </View>

            {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.5 }]}
              onPress={guardar}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color={colors.blanco} size="small" />
                : <Text style={styles.saveBtnText}>Guardar</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelBtn, { marginTop: 10 }, saving && { opacity: 0.5 }]}
              onPress={() => {
                // Key is kept: guardar() rotates it only if the content changed.
                setError(null)
                setPaso('form')
              }}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={styles.cancelBtnText}>Volver y corregir</Text>
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
  resumenLinea: { fontSize: 18, fontWeight: '800', color: colors.ink },
  resumenObs: { fontSize: 13, color: colors.ink60, fontStyle: 'italic' },
  avisoBox: { backgroundColor: colors.crema, borderRadius: 10, padding: 12, marginVertical: 12 },
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
