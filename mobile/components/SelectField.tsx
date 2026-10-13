// Menú desplegable de selección única: un campo que muestra la opción elegida y,
// al tocarlo, abre la lista pegada debajo del propio casillero (o arriba si abajo
// no entra). Para listas largas (parrales, productores) donde los chips ocupan
// toda la pantalla. No usa hoja inferior: los bordes redondeados del iPhone la tapaban.
import { useRef, useState } from 'react'
import { View, Text, TouchableOpacity, Modal, FlatList, StyleSheet, useWindowDimensions } from 'react-native'
import { ICONS, ICON_STROKE } from '../lib/icons'
import { colors } from '../lib/theme'

const ROW_H = 52

export interface SelectOption {
  value: string
  label: string
  sub?: string
}

interface Props {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  /** Texto cuando no hay opciones cargadas. */
  emptyText?: string
  /** Permite volver a "sin selección" (campos opcionales). */
  clearLabel?: string
}

export default function SelectField({ label, value, options, onChange, placeholder = 'Seleccionar…', emptyText, clearLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const fieldRef = useRef<View>(null)
  const { height: winH } = useWindowDimensions()
  const selected = options.find((o) => o.value === value) ?? null

  // Mide el casillero en pantalla y abre la lista junto a él.
  function abrir() {
    fieldRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, w, h })
      setOpen(true)
    })
  }

  // Abajo si entra (mín. 220 px); si no, hacia arriba. Margen para el notch / barra inferior.
  const MARGEN = 40
  const filas = options.length + (clearLabel ? 1 : 0)
  const alto = Math.max(1, filas) * ROW_H
  const libreAbajo = anchor ? winH - (anchor.y + anchor.h) - MARGEN : 0
  const libreArriba = anchor ? anchor.y - MARGEN : 0
  const haciaArriba = !!anchor && libreAbajo < Math.min(alto, 220) && libreArriba > libreAbajo
  const maxH = Math.max(120, Math.min(alto, 320, haciaArriba ? libreArriba : libreAbajo))

  function pick(v: string) {
    onChange(v)
    setOpen(false)
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View ref={fieldRef} collapsable={false}>
      <TouchableOpacity
        style={[styles.field, selected && styles.fieldFilled]}
        onPress={abrir}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={[styles.fieldText, !selected && styles.placeholder]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <ICONS.desplegar size={20} color={colors.ink60} strokeWidth={ICON_STROKE} />
      </TouchableOpacity>
      </View>
      {options.length === 0 && emptyText ? <Text style={styles.empty}>{emptyText}</Text> : null}

      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpen(false)} />
        {anchor && (
          <View
            style={[
              styles.popover,
              { left: anchor.x, width: anchor.w, maxHeight: maxH },
              haciaArriba ? { bottom: winH - anchor.y + 4 } : { top: anchor.y + anchor.h + 4 },
            ]}
          >
            <FlatList
              data={options}
              keyExtractor={(o) => o.value}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={clearLabel ? (
                <TouchableOpacity style={[styles.option, value === '' && styles.optionActive]} onPress={() => pick('')}>
                  <Text style={styles.optionText}>{clearLabel}</Text>
                </TouchableOpacity>
              ) : null}
              ListEmptyComponent={<Text style={styles.empty}>{emptyText ?? 'No hay opciones'}</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.option, item.value === value && styles.optionActive]}
                  onPress={() => pick(item.value)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionText}>{item.label}</Text>
                    {item.sub ? <Text style={styles.optionSub}>{item.sub}</Text> : null}
                  </View>
                  {item.value === value && <ICONS.check size={18} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />}
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: {
    fontSize: 11, fontWeight: '700', color: colors.ink60,
    letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8,
  },
  field: {
    minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.borde,
    paddingHorizontal: 14,
  },
  fieldFilled: { borderColor: colors.burdeos[600], borderWidth: 1.5 },
  fieldText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  placeholder: { color: colors.niebla, fontWeight: '400' },
  empty: { fontSize: 13, color: colors.ink60, marginTop: 6, padding: 4 },

  popover: {
    position: 'absolute', backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.borde, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 14, elevation: 10,
  },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, minHeight: ROW_H, borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  optionActive: { backgroundColor: colors.crema },
  optionText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  optionSub: { fontSize: 12, color: colors.ink60, marginTop: 2 },
})
