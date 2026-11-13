// Reportar falla: machine, description, severity and up to 2 gallery photos.
// Works without signal: when the server gives NO response the report is queued
// (JSON only, no photos) and sent by offlineSync when signal returns.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, Image, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ICONS, ICON_STROKE } from '../../lib/icons'
import { colors } from '../../lib/theme'
import { useAuthStore } from '../../store/authStore'
import { useFincaStore } from '../../store/fincaStore'
import { elegirImagenDeGaleria } from '../../lib/imagePicker'
import { enqueue } from '../../lib/offlineQueue'
import { newIdempotencyKey } from '../../lib/idempotency'
import SelectField from '../../components/SelectField'
import MaquinaIcon from '../../components/MaquinaIcon'
import {
  puedeVerMaquinaria, buildReportePayload, crearOrden, subirFotoOrden, errorDetail,
  GRAVEDAD_FALLA_VALUES, GRAVEDAD_FALLA_LABELS, TIPO_MAQUINA_LABELS,
  FINCA_LABELS, type GravedadFalla, type MaquinaResponse,
} from '../../lib/maquinaria'
import { readFlotaCache, fetchFlota, nombreMaquina, alcanceMaquinaria, COLOR_REPORTAR } from '../../lib/maquinariaUi'

const MAX_FOTOS = 2
const MAX_DESCRIPCION = 2000

export default function ReportarFallaScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { maquinaId: maquinaIdParam } = useLocalSearchParams<{ maquinaId?: string }>()
  const role = useAuthStore((s) => s.user?.role)
  const finca = useFincaStore((s) => s.active)
  const alcance = alcanceMaquinaria(role, finca.key)

  const [maquinas, setMaquinas] = useState<MaquinaResponse[]>([])
  const [loadingMaquinas, setLoadingMaquinas] = useState(true)
  const [maquinaId, setMaquinaId] = useState(maquinaIdParam ?? '')
  const [descripcion, setDescripcion] = useState('')
  const [gravedad, setGravedad] = useState<GravedadFalla>('sigue_trabajando')
  const [fotos, setFotos] = useState<string[]>([])
  const [enviando, setEnviando] = useState(false)
  // Sync guard: state updates are async, so two taps in one frame would both pass.
  const enviandoRef = useRef(false)
  // One key per screen mount, reused by every submit attempt: a double submit
  // dedupes server-side. Renewed only after a successful submit.
  const idempotencyKeyRef = useRef(newIdempotencyKey())

  // Cache first (works offline), then refresh when there is signal.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const cached = await readFlotaCache(alcance)
      if (alive && cached) { setMaquinas(cached); setLoadingMaquinas(false) }
      try {
        const fresh = await fetchFlota(alcance)
        if (alive) setMaquinas(fresh)
      } catch { /* keep cached list; empty state explains if there is none */ }
      finally { if (alive) setLoadingMaquinas(false) }
    })()
    return () => { alive = false }
  }, [alcance])

  const options = useMemo(
    () => maquinas.map((m) => ({ value: m.id, label: nombreMaquina(m), icon: <MaquinaIcon icono={m.icono} size={20} color={colors.ink60} />, sub: alcance ? TIPO_MAQUINA_LABELS[m.tipo] : `${TIPO_MAQUINA_LABELS[m.tipo]} · ${FINCA_LABELS[m.finca]}` })),
    [maquinas, alcance],
  )

  if (!puedeVerMaquinaria(role)) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No tenés acceso a esta sección</Text>
      </View>
    )
  }

  async function agregarFoto() {
    if (fotos.length >= MAX_FOTOS) return
    const uri = await elegirImagenDeGaleria()
    if (uri) setFotos((prev) => (prev.length < MAX_FOTOS ? [...prev, uri] : prev))
  }

  async function enviar() {
    const texto = descripcion.trim()
    if (!maquinaId) { Alert.alert('Falta la máquina', 'Elegí qué máquina tiene la falla.'); return }
    if (!texto) { Alert.alert('Falta la descripción', 'Contá brevemente qué le pasa a la máquina.'); return }
    if (enviandoRef.current) return
    enviandoRef.current = true
    setEnviando(true)

    // The idempotency key is created once here: a retry or the queued replay
    // of this same report cannot create a second order.
    const { endpoint, payload } = buildReportePayload({
      maquina_id: maquinaId, descripcion: texto, gravedad,
      idempotency_key: idempotencyKeyRef.current,
    })

    try {
      const orden = await crearOrden(payload)
      idempotencyKeyRef.current = newIdempotencyKey()
      let fotosFallidas = 0
      for (const uri of fotos) {
        try { await subirFotoOrden(orden.id, uri) } catch { fotosFallidas += 1 }
      }
      const aviso = fotosFallidas > 0
        ? `La falla se registró, pero ${fotosFallidas === 1 ? 'una foto no se pudo subir' : 'las fotos no se pudieron subir'}. Podés agregarla desde el detalle de la orden.`
        : 'La falla quedó registrada.'
      Alert.alert(fotosFallidas > 0 ? 'Reporte enviado con aviso' : 'Reporte enviado', aviso)
      router.replace(`/maquinaria/orden/${orden.id}`)
    } catch (e) {
      const sinRespuesta = !(e as { response?: unknown }).response
      if (sinRespuesta) {
        try {
          await enqueue(endpoint, payload)
          const nota = fotos.length > 0
            ? '\n\nLas fotos no viajan sin señal: cuando el reporte se envíe, podés agregarlas desde el detalle de la orden.'
            : ''
          Alert.alert(
            'Guardado sin señal',
            `El reporte se guardó en el teléfono y se va a enviar cuando haya señal.${nota}`,
          )
          router.back()
        } catch {
          Alert.alert('Error', 'No se pudo guardar el reporte en el teléfono. Reintentá.')
        }
      } else {
        Alert.alert('No se pudo enviar', errorDetail(e, 'No se pudo enviar el reporte'))
      }
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.fincaLabel}>{finca.label}</Text>

        {loadingMaquinas && maquinas.length === 0 ? (
          <ActivityIndicator color={colors.burdeos[600]} />
        ) : (
          <SelectField
            label="Máquina"
            value={maquinaId}
            options={options}
            onChange={setMaquinaId}
            placeholder="Elegí la máquina"
            emptyText="No hay máquinas cargadas. Conectate una vez para descargar la lista."
          />
        )}

        <Text style={styles.label}>¿Qué le pasa?</Text>
        <TextInput
          style={styles.input}
          value={descripcion}
          onChangeText={setDescripcion}
          placeholder="Ej: pierde aceite, no arranca, ruido en la caja..."
          placeholderTextColor={colors.niebla}
          multiline
          maxLength={MAX_DESCRIPCION}
          textAlignVertical="top"
        />

        <Text style={styles.label}>Gravedad</Text>
        <View style={styles.gravRow}>
          {GRAVEDAD_FALLA_VALUES.map((g) => {
            const active = gravedad === g
            const danger = g === 'parada'
            return (
              <TouchableOpacity
                key={g}
                style={[
                  styles.gravBtn,
                  active && { backgroundColor: danger ? colors.sangre : colors.burdeos[600], borderColor: danger ? colors.sangre : colors.burdeos[600] },
                ]}
                onPress={() => setGravedad(g)}
                activeOpacity={0.8}
              >
                <Text style={[styles.gravText, active && { color: colors.blanco }]}>{GRAVEDAD_FALLA_LABELS[g]}</Text>
              </TouchableOpacity>
            )
          })}
        </View>

        <Text style={styles.label}>Fotos (opcional, hasta {MAX_FOTOS})</Text>
        <View style={styles.fotosRow}>
          {fotos.map((uri) => (
            <View key={uri} style={styles.fotoBox}>
              <Image source={{ uri }} style={styles.foto} />
              <TouchableOpacity
                style={styles.fotoQuitar}
                onPress={() => setFotos((prev) => prev.filter((u) => u !== uri))}
                accessibilityLabel="Quitar foto"
                hitSlop={8}
              >
                <ICONS.cerrar size={14} color={colors.blanco} strokeWidth={ICON_STROKE} />
              </TouchableOpacity>
            </View>
          ))}
          {fotos.length < MAX_FOTOS && (
            <TouchableOpacity style={[styles.fotoBox, styles.fotoAdd]} onPress={agregarFoto} activeOpacity={0.7}>
              <ICONS.agregar size={22} color={colors.ink60} strokeWidth={ICON_STROKE} />
              <Text style={styles.fotoAddText}>Galería</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.hint}>
          Sin señal el reporte se guarda sin fotos; después podés sumarlas desde el detalle de la orden.
        </Text>

        <TouchableOpacity
          style={[styles.submit, enviando && { opacity: 0.6 }]}
          onPress={enviar}
          disabled={enviando}
          activeOpacity={0.85}
        >
          {enviando
            ? <ActivityIndicator color={colors.blanco} />
            : <Text style={styles.submitText}>Enviar reporte</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.hueso, padding: 24 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  content: { padding: 16, gap: 8 },
  fincaLabel: { fontSize: 11, fontWeight: '700', color: colors.niebla, letterSpacing: 0.8, textTransform: 'uppercase' },
  label: { fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 12 },
  input: {
    minHeight: 110, backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.borde,
    padding: 12, fontSize: 15, color: colors.ink,
  },
  gravRow: { flexDirection: 'row', gap: 10 },
  gravBtn: {
    flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.borde,
    backgroundColor: colors.blanco, alignItems: 'center', justifyContent: 'center',
  },
  gravText: { fontSize: 14, fontWeight: '700', color: colors.ink60 },
  fotosRow: { flexDirection: 'row', gap: 10 },
  fotoBox: { width: 96, height: 96, borderRadius: 12, overflow: 'hidden' },
  foto: { width: '100%', height: '100%' },
  fotoQuitar: {
    position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(31,26,23,0.75)', alignItems: 'center', justifyContent: 'center',
  },
  fotoAdd: {
    borderWidth: 1.5, borderColor: colors.borde, borderStyle: 'dashed', backgroundColor: colors.blanco,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  fotoAddText: { fontSize: 12, color: colors.ink60, fontWeight: '600' },
  hint: { fontSize: 12, color: colors.ink60 },
  submit: {
    marginTop: 20, minHeight: 54, borderRadius: 14, backgroundColor: COLOR_REPORTAR,
    alignItems: 'center', justifyContent: 'center',
  },
  submitText: { color: colors.blanco, fontSize: 16, fontWeight: '700' },
})
