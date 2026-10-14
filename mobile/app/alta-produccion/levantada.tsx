// Levantada de pasa: muestra solo los lotes ABIERTOS; al tocar uno se abre su
// ventana para agregar un bin / bolsón (pasero, kg reales, observaciones) e
// imprimir la tarja de cada uno. Abrir y cerrar lotes es en "Lotes de pasa".
// Cada bin recibe su tarja (la genera el backend); el depósito es único.
// Solo encargado o superior. Requiere conexión.
import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { useRouter } from 'expo-router'
import { colors } from '../../lib/theme'
import { useAuthStore } from '../../store/authStore'
import LoteModal, { loteNombre } from '../../components/LoteModal'
import type { Parcela } from '../../lib/types'
import { puedeAltaProduccion, fmtKg, errorDetail, getLotesPasa, getPaseros, type LotePasa } from '../../lib/altaProduccion'

export default function LevantadaScreen() {
  const router = useRouter()
  const role = useAuthStore((s) => s.user?.role)

  const [lotes, setLotes] = useState<LotePasa[]>([])
  const [paseros, setPaseros] = useState<Parcela[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoadError(null)
    try {
      const [ls, pas] = await Promise.all([getLotesPasa('abierto'), getPaseros()])
      setLotes(ls)
      setPaseros(pas)
    } catch (e) {
      setLoadError(errorDetail(e, 'No se pudieron cargar los lotes'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData() }} tintColor={colors.tierra} />}
      >
        <Text style={styles.intro}>Tocá un lote abierto para agregarle bines o bolsones.</Text>

        {loadError && (
          <View style={styles.errorBox}><Text style={styles.errorText}>{loadError}</Text></View>
        )}

        {loading ? (
          <ActivityIndicator color={colors.tierra} style={{ marginTop: 24 }} />
        ) : lotes.length === 0 ? (
          <View style={styles.vacio}>
            <Text style={styles.vacioTitle}>No hay lotes abiertos</Text>
            <Text style={styles.muted}>Abrí uno desde Lotes de pasa para empezar a levantar.</Text>
            <TouchableOpacity style={styles.vacioBtn} onPress={() => router.push('/alta-produccion/lotes')} activeOpacity={0.85}>
              <Text style={styles.vacioBtnText}>Ir a Lotes de pasa</Text>
            </TouchableOpacity>
          </View>
        ) : (
          lotes.map((l) => {
            const pct = l.tope_bines ? Math.min(100, (l.cantidad_bines / l.tope_bines) * 100) : 0
            return (
              <TouchableOpacity key={l.id} style={styles.card} activeOpacity={0.8} onPress={() => setDetalleId(l.id)}>
                <Text style={styles.cardTitle}>{loteNombre(l)}</Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.binesText}>
                    {l.cantidad_bines}
                    <Text style={styles.binesTope}>{l.tope_bines != null ? ` / ${l.tope_bines}` : ''}</Text>
                    <Text style={styles.metaText}>  bines</Text>
                  </Text>
                  <Text style={styles.kgText}>{fmtKg(l.kg_total)} kg</Text>
                </View>
                {l.tope_bines != null && (
                  <View style={styles.barra}><View style={[styles.barraFill, { width: `${pct}%` }]} /></View>
                )}
                <Text style={styles.cardCta}>Agregar bin →</Text>
              </TouchableOpacity>
            )
          })
        )}
      </ScrollView>

      {detalleId && (
        <LoteModal
          loteId={detalleId}
          modo="levantada"
          paseros={paseros}
          onClose={() => setDetalleId(null)}
          onChanged={fetchData}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  content: { padding: 16, paddingBottom: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.hueso },
  intro: { fontSize: 13, color: colors.ink60, marginBottom: 14 },
  muted: { fontSize: 13, color: colors.ink60, textAlign: 'center' },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.ink60 },
  errorBox: { backgroundColor: '#fdf0f1', borderRadius: 10, padding: 12, marginVertical: 8 },
  errorText: { fontSize: 13, color: colors.sangre, fontWeight: '600' },

  vacio: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  vacioTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  vacioBtn: {
    marginTop: 10, minHeight: 48, paddingHorizontal: 20, borderRadius: 12,
    backgroundColor: colors.burdeos[600], justifyContent: 'center',
  },
  vacioBtnText: { fontSize: 14, fontWeight: '700', color: colors.blanco },

  card: {
    backgroundColor: colors.blanco, borderRadius: 14, padding: 16, marginBottom: 10,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  binesText: { fontSize: 26, fontWeight: '800', color: colors.ink },
  binesTope: { fontSize: 16, fontWeight: '600', color: colors.niebla },
  metaText: { fontSize: 12, fontWeight: '400', color: colors.ink60 },
  kgText: { fontSize: 16, fontWeight: '700', color: colors.ink60 },
  barra: { height: 6, borderRadius: 3, backgroundColor: colors.hueso, marginTop: 10, overflow: 'hidden' },
  barraFill: { height: 6, borderRadius: 3, backgroundColor: colors.burdeos[600] },
  cardCta: { marginTop: 10, fontSize: 13, fontWeight: '800', color: colors.burdeos[600] },
})
