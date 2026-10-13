// Ingresos al pasero: stock de uva disponible + últimos ingresos. Solo lectura:
// cada carro ingresa desde Cosecha -> nuevo despacho (Para: Pasero), igual que en
// la web. Solo encargado o superior.
import { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { colors } from '../../lib/theme'
import { useAuthStore } from '../../store/authStore'
import { VARIEDAD_LABELS } from '../../lib/types'
import type { Parcela } from '../../lib/types'
import {
  puedeAltaProduccion, fmtKg, fmtFecha, errorDetail,
  getIngresosPasero, getStockPasero, getProductores, getPaseros, getParrales,
  type IngresoPasero, type StockPaseroItem, type Productor,
} from '../../lib/altaProduccion'

const RECIENTES = 20

export default function PaseroScreen() {
  const role = useAuthStore((s) => s.user?.role)

  const [ingresos, setIngresos] = useState<IngresoPasero[]>([])
  const [stock, setStock] = useState<StockPaseroItem[]>([])
  const [paseros, setPaseros] = useState<Parcela[]>([])
  const [parrales, setParrales] = useState<Parcela[]>([])
  const [productores, setProductores] = useState<Productor[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const nombrePasero = (id: string) => paseros.find((p) => p.id === id)?.nombre ?? '–'
  const nombreProductor = (id: string | null) =>
    id ? productores.find((p) => p.id === id)?.nombre ?? '–' : '–'

  const fetchData = useCallback(async () => {
    setLoadError(null)
    try {
      const [ing, stk, pas, parr, prod] = await Promise.all([
        getIngresosPasero(), getStockPasero(), getPaseros(), getParrales(), getProductores(),
      ])
      setIngresos(ing)
      setStock(stk)
      setPaseros(pas)
      setParrales(parr)
      setProductores(prod)
    } catch (e) {
      setLoadError(errorDetail(e, 'No se pudieron cargar los datos'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function onRefresh() {
    setRefreshing(true)
    fetchData()
  }

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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tierra} />}
      >
        {loadError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={colors.tierra} style={{ marginTop: 24 }} />
        ) : (
          <>
            <Text style={styles.sectionLabel}>UVA DISPONIBLE EN PASERO</Text>
            {stock.filter((s) => s.uva_disponible_kg !== 0).length === 0 ? (
              <Text style={styles.muted}>Sin uva disponible</Text>
            ) : (
              stock.filter((s) => s.uva_disponible_kg !== 0).map((s) => (
                <View key={`${s.pasero_id}-${s.variedad}`} style={styles.stockRow}>
                  <Text style={styles.stockName}>{s.pasero_nombre} · {VARIEDAD_LABELS[s.variedad] ?? s.variedad}</Text>
                  <Text style={styles.stockKg}>{fmtKg(s.uva_disponible_kg)} kg</Text>
                </View>
              ))
            )}

            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>INGRESOS RECIENTES</Text>
            <Text style={[styles.muted, { marginBottom: 10 }]}>
              Los carros se cargan desde Cosecha → nuevo despacho (Para: Pasero).
            </Text>
            {ingresos.length === 0 ? (
              <Text style={styles.muted}>Todavía no hay ingresos registrados</Text>
            ) : (
              ingresos.slice(0, RECIENTES).map((i) => (
                <View key={i.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.dateText}>{fmtFecha(i.fecha)}</Text>
                    {i.origen === 'tercero' && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>Tercero: {nombreProductor(i.productor_id)}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.cardTitle}>
                    {nombrePasero(i.pasero_id)} · {VARIEDAD_LABELS[i.variedad] ?? i.variedad}
                    {i.parcela_origen_id ? ` · ${parrales.find((p) => p.id === i.parcela_origen_id)?.nombre ?? 'parral'}` : ''}
                  </Text>
                  <View style={styles.cardFooter}>
                    <Text style={styles.kgText}>{fmtKg(i.kg_real)} kg</Text>
                    <Text style={[styles.mermaText, i.merma_kg < 0 && { color: colors.oro }]}>
                      Merma {fmtKg(i.merma_kg)} kg · {i.carros} {i.carros === 1 ? 'carro' : 'carros'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  content: { padding: 16, paddingBottom: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.hueso },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  muted: { fontSize: 13, color: colors.ink60 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.ink60 },
  errorBox: { backgroundColor: '#fdf0f1', borderRadius: 10, padding: 12, marginVertical: 8 },
  errorText: { fontSize: 13, color: colors.sangre, fontWeight: '600' },

  stockRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.crema, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 6,
  },
  stockName: { fontSize: 14, fontWeight: '600', color: colors.ink, flex: 1 },
  stockKg: { fontSize: 14, fontWeight: '700', color: colors.verdeCampo },

  card: {
    backgroundColor: colors.blanco, borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  dateText: { fontSize: 13, fontWeight: '600', color: colors.ink60 },
  badge: { backgroundColor: '#f1e8f7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#6b3a8a' },
  cardTitle: { fontSize: 14, fontWeight: '600', color: colors.ink, marginBottom: 8 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kgText: { fontSize: 20, fontWeight: '800', color: colors.ink },
  mermaText: { fontSize: 12, color: colors.ink60 },
})
