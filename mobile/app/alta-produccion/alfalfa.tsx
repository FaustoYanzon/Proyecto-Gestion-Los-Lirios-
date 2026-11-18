// Alfalfa: stock por producto, alta (potrero -> deposito), entrega a comprador y
// los ultimos 20 documentos (tocar uno abre el PDF). Solo encargado o superior.
// Requiere conexion. No hay anulacion en mobile: se hace desde la web (super admin).
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
import AlfalfaModal from '../../components/AlfalfaModal'
import {
  puedeAltaProduccion, fmtKg, fmtFecha, errorDetail, getCompradores, type Comprador,
} from '../../lib/altaProduccion'
import {
  PRODUCTO_LABELS, PRODUCTO_UNIDAD, getStockAlfalfa, getDocumentosAlfalfa, getPotreros, abrirDocumentoAlfalfaPdf,
  type StockAlfalfa, type DocumentoAlfalfa, type TipoDocumentoAlfalfa,
} from '../../lib/alfalfa'
import type { Parcela } from '../../lib/types'

export default function AlfalfaScreen() {
  const role = useAuthStore((s) => s.user?.role)

  const [stock, setStock] = useState<StockAlfalfa[]>([])
  const [docs, setDocs] = useState<DocumentoAlfalfa[]>([])
  const [potreros, setPotreros] = useState<Parcela[]>([])
  const [compradores, setCompradores] = useState<Comprador[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [modalTipo, setModalTipo] = useState<TipoDocumentoAlfalfa | null>(null)

  const fetchData = useCallback(async () => {
    setLoadError(null)
    try {
      const [s, d, p, c] = await Promise.all([
        getStockAlfalfa(), getDocumentosAlfalfa(20), getPotreros(), getCompradores(),
      ])
      setStock(s)
      setDocs(d)
      setPotreros(p)
      setCompradores(c)
    } catch (e) {
      setLoadError(errorDetail(e, 'No se pudo cargar la alfalfa'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function abrirPdf(id: string) {
    setPdfError(null)
    try {
      await abrirDocumentoAlfalfaPdf(id)
    } catch (e) {
      setPdfError(errorDetail(e, 'No se pudo abrir el PDF'))
    }
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData() }} tintColor={colors.tierra} />}
      >
        {loadError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{loadError}</Text>
            <TouchableOpacity onPress={() => { setLoading(true); fetchData() }} activeOpacity={0.8}>
              <Text style={styles.retryText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading ? (
          <ActivityIndicator color={colors.tierra} style={{ marginTop: 24 }} />
        ) : (
          <>
            <Text style={styles.sectionLabel}>STOCK</Text>
            {stock.map((s) => (
              <View key={s.producto} style={styles.card}>
                <Text style={styles.cardTitle}>{PRODUCTO_LABELS[s.producto]}</Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.metaText}>Disponible</Text>
                  <Text style={styles.kgText}>
                    {PRODUCTO_UNIDAD[s.producto] === 'unidades'
                      ? `${fmtKg(s.unidades)} u. · ${fmtKg(s.kg)} kg`
                      : `${fmtKg(s.kg)} kg`}
                  </Text>
                </View>
              </View>
            ))}

            <View style={styles.btnRow}>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setModalTipo('alta')} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Alta</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setModalTipo('salida')} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>Entrega</Text>
              </TouchableOpacity>
            </View>

            <Text style={[styles.sectionLabel, { marginTop: 18 }]}>ÚLTIMOS DOCUMENTOS</Text>
            {pdfError && <View style={styles.errorBox}><Text style={styles.errorText}>{pdfError}</Text></View>}
            {docs.length === 0 ? (
              <Text style={styles.muted}>Todavía no hay documentos.</Text>
            ) : (
              docs.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={[styles.card, d.anulado && { opacity: 0.6 }]}
                  activeOpacity={0.8}
                  onPress={() => abrirPdf(d.id)}
                >
                  <View style={styles.docHeader}>
                    <Text style={[styles.cardTitle, { marginBottom: 0 }, d.anulado && styles.tachado]}>{d.numero}</Text>
                    {d.anulado && <Text style={styles.anuladoBadge}>Anulado</Text>}
                  </View>
                  <Text style={styles.metaText}>
                    {d.tipo === 'alta' ? 'Alta' : 'Entrega'} · {fmtFecha(d.fecha)} · {fmtKg(d.kg_total)} kg
                  </Text>
                  <Text style={styles.metaText}>
                    {d.lineas.map((l) => `${PRODUCTO_LABELS[l.producto]} ${fmtKg(l.cantidad)}`).join(' · ')}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </>
        )}
      </ScrollView>

      {modalTipo && (
        <AlfalfaModal
          tipo={modalTipo}
          potreros={potreros}
          compradores={compradores}
          onClose={() => setModalTipo(null)}
          onSaved={fetchData}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  content: { padding: 16, paddingBottom: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.hueso },
  muted: { fontSize: 13, color: colors.ink60 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.ink60 },
  errorBox: { backgroundColor: '#fdf0f1', borderRadius: 10, padding: 12, marginVertical: 8, gap: 6 },
  errorText: { fontSize: 13, color: colors.sangre, fontWeight: '600' },
  retryText: { fontSize: 13, fontWeight: '800', color: colors.burdeos[600] },

  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  card: {
    backgroundColor: colors.blanco, borderRadius: 14, padding: 16, marginBottom: 10,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  metaText: { fontSize: 12, color: colors.ink60, marginTop: 2 },
  kgText: { fontSize: 20, fontWeight: '800', color: colors.ink },

  btnRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  primaryBtn: {
    flex: 1, height: 52, borderRadius: 12, backgroundColor: colors.burdeos[600],
    justifyContent: 'center', alignItems: 'center',
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: colors.blanco },

  docHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  tachado: { textDecorationLine: 'line-through' },
  anuladoBadge: {
    fontSize: 11, fontWeight: '800', color: colors.sangre, backgroundColor: '#fdf0f1',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden',
  },
})
