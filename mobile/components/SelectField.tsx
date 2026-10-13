// Menú desplegable de selección única: un campo que muestra la opción elegida y,
// al tocarlo, abre una hoja con la lista. Para listas largas (parrales,
// productores) donde los chips ocupan toda la pantalla.
import { useState } from 'react'
import { View, Text, TouchableOpacity, Modal, FlatList, StyleSheet } from 'react-native'
import { ICONS, ICON_STROKE } from '../lib/icons'
import { colors } from '../lib/theme'

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
  const selected = options.find((o) => o.value === value) ?? null

  function pick(v: string) {
    onChange(v)
    setOpen(false)
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={[styles.field, selected && styles.fieldFilled]}
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={[styles.fieldText, !selected && styles.placeholder]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <ICONS.desplegar size={20} color={colors.ink60} strokeWidth={ICON_STROKE} />
      </TouchableOpacity>
      {options.length === 0 && emptyText ? <Text style={styles.empty}>{emptyText}</Text> : null}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <TouchableOpacity onPress={() => setOpen(false)} style={styles.closeBtn} hitSlop={10}>
              <ICONS.cerrar size={20} color={colors.ink} strokeWidth={ICON_STROKE} />
            </TouchableOpacity>
          </View>
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

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    maxHeight: '70%', backgroundColor: colors.blanco,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 24,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.borde,
  },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.crema,
    justifyContent: 'center', alignItems: 'center',
  },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  optionActive: { backgroundColor: colors.crema },
  optionText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  optionSub: { fontSize: 12, color: colors.ink60, marginTop: 2 },
})
