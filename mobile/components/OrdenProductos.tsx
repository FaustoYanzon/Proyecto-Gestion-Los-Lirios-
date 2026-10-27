// Product list of an application order (one order can carry several products,
// each confirmed as its own fito record server-side). Shared by the pending
// order card and the confirmation modals in OrdenesPendientes.
import { View, Text, StyleSheet } from 'react-native'
import { colors } from '../lib/theme'
import { calcularCantidad } from '../lib/cantidad'
import type { OrdenAplicacion, VariedadUva } from '../lib/types'
import { VARIEDAD_LABELS } from '../lib/types'

export interface ProductoOrden {
  key: string
  nombre: string
  unidad: string
  dosisPorHa: number
}

// Falls back to the legacy single-product fields when the response has no
// `lineas` (old server or data fetched before the multi-product release).
export function productosDeOrden(orden: OrdenAplicacion): ProductoOrden[] {
  if (orden.lineas && orden.lineas.length > 0) {
    return orden.lineas.map((l) => ({
      key: l.id,
      nombre: l.insumo_nombre,
      unidad: l.insumo_unidad,
      // Number() guards against a server serializing the dose as a string.
      dosisPorHa: Number(l.dosis_por_ha),
    }))
  }
  return [{
    key: orden.insumo_id,
    nombre: orden.insumo_nombre,
    unidad: orden.insumo_unidad,
    dosisPorHa: Number(orden.dosis_por_ha),
  }]
}

export function variedadesDeOrden(orden: OrdenAplicacion): VariedadUva[] {
  return orden.variedades && orden.variedades.length > 0 ? orden.variedades : [orden.variedad]
}

export function labelVariedades(orden: OrdenAplicacion): string {
  return variedadesDeOrden(orden).map((v) => VARIEDAD_LABELS[v] ?? v).join(', ')
}

export function formatDosis(p: ProductoOrden): string {
  if (!Number.isFinite(p.dosisPorHa)) return '—'
  return `${p.dosisPorHa.toLocaleString('es-AR', { maximumFractionDigits: 3 })} ${p.unidad}/ha`
}

// es-AR with exactly 2 decimals ("2,35"). Input is already rounded, so the
// double conversion cannot move the second decimal.
export function formatDosDecimales(value: string | number): string {
  return Number(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Quantity for a surface, computed exactly as the server stores it (dose × ha,
// half-even to 0.01). Null/invalid surface → "—" (the server rejects the
// confirmation with a 422 in that case).
export function formatCantidad(p: ProductoOrden, superficieHa: string | number | null | undefined): string {
  const cantidad = calcularCantidad(p.dosisPorHa, superficieHa)
  if (cantidad === null) return '—'
  return `${formatDosDecimales(cantidad)} ${p.unidad}`
}

// Compact list for the order card: "Super folpan  1,5 kg/ha" per row.
export function ProductosLista({ productos }: { productos: ProductoOrden[] }) {
  return (
    <View style={styles.lista}>
      {productos.map((p) => (
        <View key={p.key} style={styles.listaRow}>
          <Text style={styles.listaNombre} numberOfLines={2}>{p.nombre}</Text>
          <Text style={styles.listaDosis}>{formatDosis(p)}</Text>
        </View>
      ))}
    </View>
  )
}

// Modal block: every product with its dose and, when the surface is known,
// the quantity to apply on it. `superficieHa` undefined = surface not known
// by the screen (only doses are shown); null = known to be missing ("—").
export function ProductosCantidades({
  productos, superficieHa,
}: {
  productos: ProductoOrden[]
  superficieHa?: string | number | null
}) {
  const mostrarCantidad = superficieHa !== undefined
  return (
    <View style={styles.card}>
      {productos.map((p, idx) => (
        <View
          key={p.key}
          style={[styles.cardRow, idx < productos.length - 1 && styles.cardRowBorder]}
        >
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.cardNombre}>{p.nombre}</Text>
            <Text style={styles.cardDosis}>{formatDosis(p)}</Text>
          </View>
          {mostrarCantidad && (
            <Text style={styles.cardCantidad}>{formatCantidad(p, superficieHa)}</Text>
          )}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  lista: { marginTop: 8, gap: 4 },
  listaRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  listaNombre: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink, paddingRight: 8 },
  listaDosis: { fontSize: 13, fontWeight: '600', color: colors.ink60 },
  card: {
    backgroundColor: colors.blanco, borderRadius: 16,
    borderWidth: 1, borderColor: colors.hueso, overflow: 'hidden',
  },
  cardRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  cardRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.hueso },
  cardNombre: { fontSize: 14, fontWeight: '700', color: colors.ink },
  cardDosis: { fontSize: 12, color: colors.ink60, marginTop: 2 },
  cardCantidad: { fontSize: 16, fontWeight: '800', color: colors.tierra },
})
