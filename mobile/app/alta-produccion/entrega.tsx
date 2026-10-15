// Entrega de pasa: lista los lotes CERRADOS con saldo; al tocar uno se abre su
// ventana para elegir los bines / bolsones que salen y a qué comprador. El peso
// sale de los bines ya pesados. Solo encargado o superior. Requiere conexión.
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
import { colors } from '../../lib/theme'
import { useAuthStore } from '../../store/authStore'
import EntregaModal from '../../components/EntregaModal'
import { loteNombre } from '../../components/LoteModal'
import {
  puedeAltaProduccion, fmtKg, errorDetail, getLotesPasa, getCompradores,
  type LotePasa, type Comprador,
} from '../../lib/altaProduccion'

export default function EntregaScreen() {
  const role = useAuthStore((s) => s.user?.role)

  const [lotes, setLotes] = useState<LotePasa[]>([])
  const [compradores, setCompradores] = useState<Comprador[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoadError(null)
    try {
      const [ls, cs] = await Promise.all([getLotesPasa('cerrado', true), getCompradores()])
      setLotes(ls)
      setCompradores(cs)
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
        <Text style={styles.intro}>Tocá un lote para elegir los bines o bolsones que salen y el comprador.</Text>

        {loadError && (
          <View style={styles.errorBox}><Text style={styles.errorText}>{loadError}</Text></View>
        )}

        {loading ? (
          <ActivityIndicator color={colors.tierra} style={{ marginTop: 24 }} />
        ) : lotes.length === 0 ? (
          <View style={styles.vacio}>
            <Text style={styles.vacioTitle}>No hay pasa para entregar</Text>
            <Text style={styles.muted}>Solo se entrega pasa de lotes cerrados que todavía tengan bines sin entregar.</Text>
          </View>
        ) : (
          lotes.map((l) => (
            <TouchableOpacity key={l.id} style={styles.card} activeOpacity={0.8} onPress={() => setDetalleId(l.id)}>
              <Text style={styles.cardTitle}>{loteNombre(l)}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.metaText}>Saldo</Text>
                <Text style={styles.kgText}>{fmtKg(l.saldo_kg)} kg</Text>
              </View>
              <Text style={styles.cardCta}>Elegir bines →</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {detalleId && (
        <EntregaModal
          loteId={detalleId}
          compradores={compradores}
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

  card: {
    backgroundColor: colors.blanco, borderRadius: 14, padding: 16, marginBottom: 10,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  metaText: { fontSize: 12, color: colors.ink60 },
  kgText: { fontSize: 22, fontWeight: '800', color: colors.ink },
  cardCta: { marginTop: 10, fontSize: 13, fontWeight: '800', color: colors.burdeos[600] },
})
