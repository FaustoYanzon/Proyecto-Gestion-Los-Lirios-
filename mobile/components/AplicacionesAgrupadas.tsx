// Read-only tree of the campaign's fito applications: orden -> parcela -> valvula.
// Mobile port of frontend/components/produccion/AplicacionesAgrupadas.tsx; the
// grouping and carencia rules live in lib/fitosanitariosAgrupar.ts.
import { useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import EmptyState from './ui/EmptyState'
import { ICONS, ICON_STROKE } from '../lib/icons'
import { colors } from '../lib/theme'
import {
  agruparRegistros, carenciaPorParcela, formatFecha,
  type CarenciaParcela, type GrupoOrden, type GrupoParcela,
} from '../lib/fitosanitariosAgrupar'
import type { OrdenAplicacion, Parcela, RegistroFitosanitario } from '../lib/types'

interface Props {
  registros: RegistroFitosanitario[]
  ordenes: OrdenAplicacion[]
  parcelas: Parcela[]
  // Local date YYYY-MM-DD; injected so the carencia is computed against one clock.
  hoy: string
}

// Same thresholds as the web chip, using theme colors only.
function colorCarencia(dias: number): string {
  if (dias >= 15) return colors.sangre
  if (dias >= 7) return colors.tierra
  return colors.oro
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

function tituloOrden(g: GrupoOrden): string {
  if (g.ordenId === null) return 'Cargas manuales (sin orden)'
  return g.orden?.objetivo || 'Orden de otra campaña'
}

function contarAplicaciones(parcelas: GrupoParcela[]): number {
  return parcelas.reduce((a, p) => a + p.valvulas.reduce((b, v) => b + v.registros.length, 0), 0)
}

function ultimaFecha(parcelas: GrupoParcela[]): string | null {
  let max: string | null = null
  for (const p of parcelas) for (const v of p.valvulas) if (!max || v.fecha > max) max = v.fecha
  return max
}

function subtituloOrden(g: GrupoOrden): string {
  const partes: string[] = []
  if (g.orden?.fecha_planificada) partes.push(`Planificada ${formatFecha(g.orden.fecha_planificada)}`)
  partes.push(plural(g.parcelas.length, 'parcela', 'parcelas'))
  partes.push(plural(contarAplicaciones(g.parcelas), 'aplicación', 'aplicaciones'))
  const ultima = ultimaFecha(g.parcelas)
  if (ultima) partes.push(formatFecha(ultima))
  const productos = [...new Set((g.orden?.lineas ?? []).map((l) => l.insumo_nombre))]
  if (productos.length > 0) partes.push(productos.join(', '))
  return partes.join(' · ')
}

function CarenciaChip({ carencia }: { carencia: CarenciaParcela | undefined }) {
  const bg = carencia ? colorCarencia(carencia.dias) : colors.verdeCampo
  const texto = carencia ? `Carencia ${carencia.dias} ${carencia.dias === 1 ? 'día' : 'días'}` : 'Habilitado'
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={styles.chipText}>{texto}</Text>
    </View>
  )
}

function Chevron({ abierto }: { abierto: boolean }) {
  const Icon = abierto ? ICONS.plegar : ICONS.desplegar
  return <Icon size={18} color={colors.ink60} strokeWidth={ICON_STROKE} />
}

export default function AplicacionesAgrupadas({ registros, ordenes, parcelas, hoy }: Props) {
  const grupos = useMemo(() => agruparRegistros(registros, ordenes), [registros, ordenes])
  const carencias = useMemo(() => carenciaPorParcela(registros, hoy), [registros, hoy])
  const nombreParcela = useMemo(() => new Map(parcelas.map((p) => [p.id, p.nombre])), [parcelas])
  // Explicit user toggles only; untouched nodes fall back to the defaults
  // (first order open, parcels closed) so data refreshes don't reset the tree.
  const [toggles, setToggles] = useState<Record<string, boolean>>({})

  if (grupos.length === 0) {
    return (
      <EmptyState
        icon="fitosanitario"
        title="Sin aplicaciones en la campaña"
        description="Todavía no hay aplicaciones confirmadas."
      />
    )
  }

  const estaAbierto = (clave: string, porDefecto: boolean) => toggles[clave] ?? porDefecto
  const alternar = (clave: string, porDefecto: boolean) =>
    setToggles((t) => ({ ...t, [clave]: !(t[clave] ?? porDefecto) }))

  return (
    <View>
      <Text style={styles.sectionLabel}>APLICACIONES DE LA CAMPAÑA</Text>
      {grupos.map((g, i) => {
        const ordenAbierta = estaAbierto(g.clave, i === 0)
        return (
          <View key={g.clave} style={styles.ordenCard}>
            <TouchableOpacity
              style={styles.ordenHeader}
              onPress={() => alternar(g.clave, i === 0)}
              activeOpacity={0.75}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.ordenTitulo}>{tituloOrden(g)}</Text>
                <Text style={styles.sub}>{subtituloOrden(g)}</Text>
              </View>
              <Chevron abierto={ordenAbierta} />
            </TouchableOpacity>

            {ordenAbierta && g.parcelas.map((p) => {
              const claveP = `${g.clave}|${p.parcelaId}`
              const parcelaAbierta = estaAbierto(claveP, false)
              const ultima = ultimaFecha([p])
              return (
                <View key={claveP} style={styles.parcelaBox}>
                  <TouchableOpacity
                    style={styles.parcelaRow}
                    onPress={() => alternar(claveP, false)}
                    activeOpacity={0.75}
                  >
                    <Chevron abierto={parcelaAbierta} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.parcelaNombre}>{nombreParcela.get(p.parcelaId) ?? 'Sin parcela'}</Text>
                      <Text style={styles.sub}>
                        {plural(contarAplicaciones([p]), 'aplicación', 'aplicaciones')}
                        {ultima ? ` · ${formatFecha(ultima)}` : ''}
                      </Text>
                    </View>
                    <CarenciaChip carencia={carencias.get(p.parcelaId)} />
                  </TouchableOpacity>

                  {parcelaAbierta && p.valvulas.map((v) => (
                    <View key={v.clave} style={styles.valvulaBox}>
                      <Text style={styles.valvulaNombre}>{v.nombre}</Text>
                      <Text style={styles.sub}>
                        {formatFecha(v.fecha)}{v.responsable ? ` · ${v.responsable}` : ''}
                      </Text>
                      {v.registros.map((r) => (
                        <Text key={r.id} style={styles.registroLinea}>
                          {r.producto_nombre} · {Number(r.dosis_por_ha)} {r.unidad ?? ''}/ha
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              )
            })}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: colors.niebla,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10,
  },
  ordenCard: {
    backgroundColor: colors.blanco, borderRadius: 14, marginBottom: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.borde,
  },
  ordenHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  ordenTitulo: { fontSize: 15, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 12, color: colors.ink60, marginTop: 2 },
  parcelaBox: { borderTopWidth: 1, borderTopColor: colors.borde },
  parcelaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14 },
  parcelaNombre: { fontSize: 14, fontWeight: '700', color: colors.ink },
  chip: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  chipText: { fontSize: 11, fontWeight: '700', color: colors.blanco },
  valvulaBox: {
    backgroundColor: colors.crema, paddingVertical: 10, paddingLeft: 40, paddingRight: 14,
    borderTopWidth: 1, borderTopColor: colors.borde,
  },
  valvulaNombre: { fontSize: 13, fontWeight: '700', color: colors.ink },
  registroLinea: { fontSize: 12, color: colors.tierra, fontWeight: '600', marginTop: 4 },
})
