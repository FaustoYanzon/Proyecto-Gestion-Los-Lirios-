// Depósitos: stock de Fitosanitarios, Insumos varios, Paseros, Bodega (pasa) y
// Alfalfa en una sola pantalla. Fitosanitarios e Insumos varios permiten
// registrar un ingreso. Solo encargado o superior. Requiere conexión.
import { useState, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { colors } from '../../lib/theme'
import { useAuthStore } from '../../store/authStore'
import IngresoInsumoModal from '../../components/IngresoInsumoModal'
import { puedeAltaProduccion, fmtKg } from '../../lib/altaProduccion'
import { PRODUCTO_LABELS, PRODUCTO_UNIDAD, getStockAlfalfa, type StockAlfalfa } from '../../lib/alfalfa'
import {
  getInsumosStock, getResumenBodega, getResumenPaseros,
  type InsumoStock, type ResumenBodega, type ResumenPasero, type TipoInsumoDeposito,
} from '../../lib/depositos'

// Each card loads on its own: one failing source must not blank the others.
type Carga<T> = { estado: 'cargando' } | { estado: 'error' } | { estado: 'ok'; datos: T }

const CARGANDO = { estado: 'cargando' } as const
const PREVIEW = 5

async function cargar<T>(fn: () => Promise<T>): Promise<Carga<T>> {
  try {
    return { estado: 'ok', datos: await fn() }
  } catch {
    return { estado: 'error' }
  }
}

export default function DepositosScreen() {
  const role = useAuthStore((s) => s.user?.role)

  const [fito, setFito] = useState<Carga<InsumoStock[]>>(CARGANDO)
  const [varios, setVarios] = useState<Carga<InsumoStock[]>>(CARGANDO)
  const [paseros, setPaseros] = useState<Carga<ResumenPasero>>(CARGANDO)
  const [bodega, setBodega] = useState<Carga<ResumenBodega>>(CARGANDO)
  const [alfalfa, setAlfalfa] = useState<Carga<StockAlfalfa[]>>(CARGANDO)
  const [refreshing, setRefreshing] = useState(false)
  const [ingresoTipo, setIngresoTipo] = useState<TipoInsumoDeposito | null>(null)

  const fetchData = useCallback(async () => {
    await Promise.all([
      cargar(() => getInsumosStock('fitosanitario')).then(setFito),
      cargar(() => getInsumosStock('vario')).then(setVarios),
      cargar(getResumenPaseros).then(setPaseros),
      cargar(getResumenBodega).then(setBodega),
      cargar(getStockAlfalfa).then(setAlfalfa),
    ])
    setRefreshing(false)
  }, [])

  useFocusEffect(useCallback(() => { fetchData() }, [fetchData]))

  if (!puedeAltaProduccion(role)) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No tenés acceso a esta sección</Text>
      </View>
    )
  }

  const insumosDelModal = ingresoTipo === 'fitosanitario' ? fito : varios

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData() }} tintColor={colors.tierra} />
        }
      >
        <InsumosCard
          titulo="Fitosanitarios"
          carga={fito}
          vacio="No hay fitosanitarios cargados"
          onIngreso={() => setIngresoTipo('fitosanitario')}
        />
        <InsumosCard
          titulo="Insumos varios"
          carga={varios}
          vacio="No hay insumos varios cargados"
          onIngreso={() => setIngresoTipo('vario')}
        />

        <Card titulo="Paseros" carga={paseros}>
          {(d) => (
            <>
              <Text style={styles.kgText}>{fmtKg(d.kgTotal)} kg de uva fresca</Text>
              {d.porVariedad.length === 0 && <Text style={styles.muted}>Sin uva en los paseros</Text>}
              {d.porVariedad.map((v) => (
                <Fila key={v.variedad} label={v.variedad} valor={`${fmtKg(v.kg)} kg`} />
              ))}
            </>
          )}
        </Card>

        <Card titulo="Bodega (pasa)" carga={bodega}>
          {(d) => (
            <>
              <Text style={styles.kgText}>{fmtKg(d.kgSaldo)} kg de pasa</Text>
              <Text style={styles.metaText}>
                {d.lotes === 1 ? '1 lote con saldo' : `${d.lotes} lotes con saldo`}
              </Text>
            </>
          )}
        </Card>

        <Card titulo="Alfalfa" carga={alfalfa}>
          {(d) => (
            <>
              {d.length === 0 && <Text style={styles.muted}>Sin stock de alfalfa</Text>}
              {d.map((s) => (
                <Fila
                  key={s.producto}
                  label={PRODUCTO_LABELS[s.producto]}
                  valor={
                    PRODUCTO_UNIDAD[s.producto] === 'unidades'
                      ? `${fmtKg(s.unidades)} u. · ${fmtKg(s.kg)} kg`
                      : `${fmtKg(s.kg)} kg`
                  }
                />
              ))}
            </>
          )}
        </Card>
      </ScrollView>

      {ingresoTipo && insumosDelModal.estado === 'ok' && (
        <IngresoInsumoModal
          tipo={ingresoTipo}
          insumos={insumosDelModal.datos}
          onClose={() => setIngresoTipo(null)}
          onSaved={fetchData}
        />
      )}
    </View>
  )
}

function Fila({ label, valor }: { label: string; valor: string }) {
  return (
    <View style={styles.fila}>
      <Text style={styles.filaLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.filaValor}>{valor}</Text>
    </View>
  )
}

// Shared shell: title + loading/error states; the body is rendered only with data.
function Card<T>({
  titulo, carga, accion, children,
}: {
  titulo: string
  carga: Carga<T>
  accion?: React.ReactNode
  children: (datos: T) => React.ReactNode
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{titulo}</Text>
        {accion}
      </View>
      {carga.estado === 'cargando' && <ActivityIndicator color={colors.tierra} style={{ alignSelf: 'flex-start' }} />}
      {carga.estado === 'error' && <Text style={styles.errorText}>No disponible</Text>}
      {carga.estado === 'ok' && children(carga.datos)}
    </View>
  )
}

function InsumosCard({
  titulo, carga, vacio, onIngreso,
}: {
  titulo: string
  carga: Carga<InsumoStock[]>
  vacio: string
  onIngreso: () => void
}) {
  const [verTodos, setVerTodos] = useState(false)
  return (
    <Card
      titulo={titulo}
      carga={carga}
      accion={
        carga.estado === 'ok' ? (
          <TouchableOpacity style={styles.ingresoBtn} onPress={onIngreso} activeOpacity={0.85}>
            <Text style={styles.ingresoBtnText}>+ Ingreso</Text>
          </TouchableOpacity>
        ) : null
      }
    >
      {(items) => {
        if (items.length === 0) return <Text style={styles.muted}>{vacio}</Text>
        const visibles = verTodos ? items : items.slice(0, PREVIEW)
        return (
          <>
            <Text style={styles.metaText}>{items.length === 1 ? '1 producto' : `${items.length} productos`}</Text>
            {visibles.map((i) => (
              <Fila key={i.id} label={i.nombre} valor={`${fmtKg(i.stock_actual)} ${i.unidad}`} />
            ))}
            {items.length > PREVIEW && (
              <TouchableOpacity onPress={() => setVerTodos((v) => !v)} activeOpacity={0.8} style={styles.verTodos}>
                <Text style={styles.verTodosText}>{verTodos ? 'Ver menos' : `Ver todos (${items.length})`}</Text>
              </TouchableOpacity>
            )}
          </>
        )
      }}
    </Card>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.hueso },
  content: { padding: 16, paddingBottom: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.hueso },
  muted: { fontSize: 13, color: colors.ink60 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.ink60 },
  errorText: { fontSize: 13, color: colors.sangre, fontWeight: '600' },

  card: {
    backgroundColor: colors.blanco, borderRadius: 14, padding: 16, marginBottom: 10, gap: 6,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  metaText: { fontSize: 12, color: colors.ink60 },
  kgText: { fontSize: 20, fontWeight: '800', color: colors.ink },

  fila: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  filaLabel: { flex: 1, fontSize: 14, color: colors.ink },
  filaValor: { fontSize: 14, fontWeight: '700', color: colors.ink },

  ingresoBtn: { height: 36, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.burdeos[600], justifyContent: 'center' },
  ingresoBtnText: { fontSize: 13, fontWeight: '700', color: colors.blanco },
  verTodos: { paddingVertical: 8 },
  verTodosText: { fontSize: 13, fontWeight: '800', color: colors.burdeos[600] },
})
