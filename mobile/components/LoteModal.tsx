// Ventana de un lote de pasa con sus bines / bolsones. Se usa en dos pantallas:
// - "levantada": lote abierto -> agregar bin (pasero, kg, observaciones) e
//   imprimir la tarja de cada uno; completo el lote, imprimir la hoja del lote.
// - "lotes": ver bines, cerrar el lote e imprimir (tarjas / hoja del lote).
// Requiere conexión (el backend valida la uva disponible del pasero en cada bin).
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native'
import { ICONS, ICON_STROKE } from '../lib/icons'
import { colors } from '../lib/theme'
import SelectField, { type SelectOption } from './SelectField'
import { VARIEDAD_LABELS } from '../lib/types'
import type { Parcela } from '../lib/types'
import {
  fmtKg, fmtFecha, hoyISO, kgValido, kgToString, errorDetail,
  getLotePasa, agregarBinPasa, cerrarLotePasa, getStockPasero, getParametros,
  abrirTarjaPdf, abrirHojaLotePdf,
  type LotePasa, type LotePasaDetalle, type ParametrosProduccion, type StockPaseroItem,
} from '../lib/altaProduccion'

export const loteNombre = (l: LotePasa) =>
  `${VARIEDAD_LABELS[l.variedad] ?? l.variedad} C${l.calidad} · N° ${l.numero} (${l.temporada}/${l.temporada + 1})`

interface Props {
  loteId: string
  /** levantada: se agregan bines; lotes: se puede cerrar el lote. */
  modo: 'levantada' | 'lotes'
  paseros: Parcela[]
  onClose: () => void
  onChanged: () => Promise<void>
}

export default function LoteModal({ loteId, modo, paseros, onClose, onChanged }: Props) {
  const [lote, setLote] = useState<LotePasaDetalle | null>(null)
  const [parametros, setParametros] = useState<ParametrosProduccion | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [paseroId, setPaseroId] = useState('')
  const [kg, setKg] = useState('')
  const [obs, setObs] = useState('')
  const [stock, setStock] = useState<StockPaseroItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimaTarja, setUltimaTarja] = useState<string | null>(null)
  const [imprimiendo, setImprimiendo] = useState<string | null>(null)
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
  useEffect(() => { getParametros().then(setParametros).catch(() => { /* solo afecta los avisos */ }) }, [])

  // Uva disponible del pasero elegido (para avisar antes de que el backend rechace).
  useEffect(() => {
    if (!paseroId) { setStock([]); return }
    getStockPasero(paseroId).then(setStock).catch(() => setStock([]))
  }, [paseroId])

  const abierto = lote?.estado === 'abierto'
  const nominal = parametros?.kg_nominal_bin ?? null
  const disponible = lote && paseroId ? stock.find((s) => s.variedad === lote.variedad)?.uva_disponible_kg ?? 0 : null
  // Misma cuenta que el backend: redondeo hacia abajo a 2 decimales.
  const maxima = disponible != null && parametros
    ? Math.floor((disponible / parametros.ratio_uva_pasa) * 100) / 100
    : null
  const kgNum = Number(kg.trim().replace(',', '.'))
  const kgOk = kgValido(kg)
  const excede = maxima != null && kgOk && kgNum > maxima
  const dif = kgOk && nominal != null ? kgNum - nominal : null
  const progreso = lote?.tope_bines ? Math.min(100, (lote.cantidad_bines / lote.tope_bines) * 100) : 0

  const paseroOpts: SelectOption[] = paseros.map((p) => ({ value: p.id, label: p.nombre }))

  async function agregarBin() {
    if (!lote || submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await agregarBinPasa(lote.id, {
        pasero_id: paseroId, kg_real: kgToString(kg), fecha: hoyISO(), observaciones: obs.trim() || null,
      })
      // La tarja la genera el backend: es la del último bin del lote.
      const d = await getLotePasa(lote.id)
      setLote(d)
      setUltimaTarja(d.bines[d.bines.length - 1]?.tarja ?? null)
      setKg('')
      setObs('')
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

  async function imprimir(clave: string, fn: () => Promise<void>) {
    setError(null)
    setImprimiendo(clave)
    try {
      await fn()
    } catch (e) {
      setError(errorDetail(e, 'No se pudo abrir el PDF'))
    } finally {
      setImprimiendo(null)
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
            {lote.tope_bines != null && (
              <View style={styles.barra}><View style={[styles.barraFill, { width: `${progreso}%` }]} /></View>
            )}

            {/* Lote completo: hoja con todo el detalle */}
            {!abierto && (
              <View style={styles.completoBox}>
                <Text style={styles.completoText}>Lote completo. Imprimí la hoja con el listado de bines y bolsones.</Text>
                <TouchableOpacity
                  style={[styles.printPrimary, imprimiendo === 'lote' && { opacity: 0.6 }]}
                  onPress={() => imprimir('lote', () => abrirHojaLotePdf(lote.id))}
                  disabled={imprimiendo !== null}
                  activeOpacity={0.85}
                >
                  {imprimiendo === 'lote'
                    ? <ActivityIndicator color={colors.blanco} size="small" />
                    : <Text style={styles.printPrimaryText}>Imprimir hoja del lote</Text>}
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.sectionLabel}>BINES / BOLSONES</Text>
            {lote.bines.length === 0 ? (
              <Text style={[styles.muted, { marginBottom: 16 }]}>Todavía no tiene bines</Text>
            ) : (
              lote.bines.map((b, i) => (
                <View key={b.id} style={[styles.binRow, b.tarja === ultimaTarja && styles.binRowNuevo]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.binTarja}>N° {i + 1} · {b.tarja}</Text>
                    <Text style={styles.binKg}>{fmtKg(b.kg_real)} kg de pasa</Text>
                    <Text style={styles.metaText}>
                      {nombrePasero(b.pasero_id)} · {fmtFecha(b.fecha)}
                    </Text>
                    {b.observaciones ? <Text style={styles.obsText}>{b.observaciones}</Text> : null}
                  </View>
                  <TouchableOpacity
                    style={[styles.printBtn, imprimiendo === b.id && { opacity: 0.6 }]}
                    onPress={() => imprimir(b.id, () => abrirTarjaPdf(lote.id, b.id))}
                    disabled={imprimiendo !== null}
                    activeOpacity={0.8}
                  >
                    {imprimiendo === b.id
                      ? <ActivityIndicator color={colors.burdeos[600]} size="small" />
                      : <Text style={styles.printBtnText}>Imprimir{'\n'}tarja</Text>}
                  </TouchableOpacity>
                </View>
              ))
            )}

            {/* Agregar bin (solo en Levantada y con el lote abierto) */}
            {modo === 'levantada' && abierto && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 16 }]}>
                  AGREGAR BIN / BOLSÓN N° {lote.cantidad_bines + 1}{lote.tope_bines != null ? ` DE ${lote.tope_bines}` : ''}
                </Text>
                <SelectField
                  label="Pasero *"
                  value={paseroId}
                  options={paseroOpts}
                  placeholder="¿De qué pasero sale?"
                  emptyText="No hay paseros activos"
                  onChange={setPaseroId}
                />

                <Text style={styles.fieldLabel}>PESO REAL (KG) *</Text>
                <TextInput
                  style={[styles.input, styles.inputHighlight]}
                  value={kg}
                  onChangeText={setKg}
                  placeholder="Lo que marca la báscula"
                  placeholderTextColor={colors.niebla}
                  keyboardType="decimal-pad"
                />
                {nominal != null && (
                  <Text style={styles.hint}>
                    Peso teórico: {fmtKg(nominal)} kg{dif != null ? ` · diferencia ${dif > 0 ? '+' : ''}${fmtKg(dif)} kg` : ''}
                  </Text>
                )}

                <Text style={styles.fieldLabel}>OBSERVACIONES (OPCIONAL)</Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  value={obs}
                  onChangeText={setObs}
                  placeholder="Ej.: bolsón con humedad, bin golpeado…"
                  placeholderTextColor={colors.niebla}
                  multiline
                  textAlignVertical="top"
                  maxLength={500}
                />

                {disponible != null && maxima != null && parametros && (
                  <Text style={[styles.hint, excede && { color: colors.sangre }]}>
                    Uva disponible de {VARIEDAD_LABELS[lote.variedad] ?? lote.variedad} en este pasero: {fmtKg(disponible)} kg
                    {' · '}pasa máxima ({fmtKg(parametros.ratio_uva_pasa)}:1): {fmtKg(maxima)} kg
                    {kgOk && !excede ? ` · descuenta ${fmtKg(kgNum * parametros.ratio_uva_pasa)} kg de uva` : ''}
                  </Text>
                )}
                <TouchableOpacity
                  style={[styles.saveBtn, (saving || !paseroId || !kgOk || excede) && { opacity: 0.5 }]}
                  onPress={agregarBin}
                  disabled={saving || !paseroId || !kgOk || excede}
                >
                  {saving
                    ? <ActivityIndicator color={colors.blanco} size="small" />
                    : <Text style={styles.saveBtnText}>Agregar bin</Text>}
                </TouchableOpacity>
              </>
            )}

            {/* Cerrar a mano (solo en Lotes de pasa) */}
            {modo === 'lotes' && abierto && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 24 }]}>CERRAR LOTE</Text>
                <Text style={[styles.muted, { marginBottom: 10 }]}>
                  {lote.tope_bines != null
                    ? `Se cierra solo al llegar a ${lote.tope_bines} bines. `
                    : 'No hay tope de bines: se cierra a mano. '}
                  No se puede cerrar sin bines; una vez cerrado no admite más bines.
                </Text>
                <TouchableOpacity
                  style={[styles.cancelBtn, (saving || lote.cantidad_bines === 0) && { opacity: 0.5 }]}
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
  modalContainer: { flex: 1, backgroundColor: colors.hueso, paddingTop: 16 },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.borde,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.crema,
    justifyContent: 'center', alignItems: 'center',
  },
  modalScroll: { padding: 16, paddingBottom: 40 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  statBox: { flex: 1, backgroundColor: colors.blanco, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: colors.borde },
  statLabel: { fontSize: 10, fontWeight: '700', color: colors.niebla, letterSpacing: 0.6 },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.ink, marginTop: 2 },
  barra: { height: 6, borderRadius: 3, backgroundColor: colors.borde, marginBottom: 14, overflow: 'hidden' },
  barraFill: { height: 6, borderRadius: 3, backgroundColor: colors.burdeos[600] },

  completoBox: { backgroundColor: '#e3eedf', borderRadius: 12, padding: 12, marginBottom: 16, gap: 10 },
  completoText: { fontSize: 13, color: colors.verdeCampo, fontWeight: '600' },
  printPrimary: {
    height: 48, borderRadius: 12, backgroundColor: colors.burdeos[600], justifyContent: 'center', alignItems: 'center',
  },
  printPrimaryText: { fontSize: 15, fontWeight: '700', color: colors.blanco },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  muted: { fontSize: 13, color: colors.ink60 },
  metaText: { fontSize: 12, color: colors.ink60 },

  binRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.blanco, borderRadius: 12, padding: 12, marginBottom: 6,
    borderWidth: 1, borderColor: colors.borde,
  },
  binRowNuevo: { borderColor: colors.verdeCampo, backgroundColor: '#f3f8f1' },
  binTarja: { fontSize: 12, fontWeight: '800', color: colors.burdeos[600], letterSpacing: 0.3, marginBottom: 2 },
  binKg: { fontSize: 15, fontWeight: '700', color: colors.ink },
  obsText: { fontSize: 12, color: colors.ink, fontStyle: 'italic', marginTop: 2 },
  printBtn: {
    minWidth: 72, minHeight: 48, borderRadius: 10, borderWidth: 1.5, borderColor: colors.burdeos[600],
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8,
  },
  printBtnText: { fontSize: 12, fontWeight: '700', color: colors.burdeos[600], textAlign: 'center' },

  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },
  input: {
    height: 52, backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.borde,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink, marginBottom: 10,
  },
  inputHighlight: { borderColor: colors.burdeos[600], borderWidth: 2, fontWeight: '700' },
  inputMultiline: { height: 80, paddingTop: 12 },
  hint: { fontSize: 12, color: colors.ink60, marginBottom: 12 },

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

  errorBox: { backgroundColor: '#fdf0f1', borderRadius: 10, padding: 12, marginVertical: 8 },
  errorText: { fontSize: 13, color: colors.sangre, fontWeight: '600' },
})
