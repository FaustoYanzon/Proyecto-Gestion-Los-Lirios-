import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import api from '../lib/api'
import { colors } from '../lib/theme'
import { ICONS, ICON_STROKE } from '../lib/icons'
import type { Trabajador as TrabajadorDb } from '../lib/types'

function normalizar(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g'), '')
    .trim()
    .toLowerCase()
}

interface Props {
  value: string
  trabajadorId?: string
  trabajadoresDb: TrabajadorDb[]
  onChange: (nombre: string, trabajadorId?: string) => void
  onCreated?: (nuevo: TrabajadorDb) => void
  placeholder?: string
}

// Elegir de la lista existente es obligatorio -- ya no se acepta texto libre
// como trabajador (causaba duplicados silenciosos, ver
// scripts/normalizar_trabajadores.py). Si de verdad no está, "Agregar nuevo
// trabajador" pide confirmar con un aviso de los nombres más parecidos antes
// de crearlo (doble verificación) -- mismo comportamiento que
// frontend/components/produccion/TrabajadorSelect.tsx.
export default function TrabajadorPicker({ value, trabajadorId, trabajadoresDb, onChange, onCreated, placeholder }: Props) {
  const [focused, setFocused] = useState(false)
  const [addMode, setAddMode] = useState(false)
  const [addName, setAddName] = useState('')
  const [creating, setCreating] = useState(false)

  const trimmed = value.trim()
  const matches = trimmed
    ? trabajadoresDb.filter((t) => normalizar(t.nombre_completo).includes(normalizar(trimmed))).slice(0, 5)
    : []

  function openAddPanel() {
    setAddName(trimmed)
    setAddMode(true)
    setFocused(false)
  }

  const parecidos = addMode
    ? trabajadoresDb.filter((t) => {
        const a = normalizar(t.nombre_completo)
        const b = normalizar(addName)
        return b.length > 1 && (a.includes(b) || b.includes(a))
      }).slice(0, 3)
    : []

  async function confirmarNuevo() {
    const nombre = addName.trim()
    if (!nombre) {
      Alert.alert('Error', 'Ingresá un nombre.')
      return
    }
    setCreating(true)
    try {
      const { data } = await api.post<TrabajadorDb>('/trabajadores/', { nombre_completo: nombre })
      onChange(data.nombre_completo, data.id)
      onCreated?.(data)
      setAddMode(false)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', typeof detail === 'string' ? detail : 'Error al crear el trabajador.')
    } finally {
      setCreating(false)
    }
  }

  if (addMode) {
    return (
      <View style={styles.addPanel}>
        <View style={styles.addPanelHeader}>
          <Text style={styles.addPanelTitle}>Nuevo trabajador</Text>
          <TouchableOpacity onPress={() => setAddMode(false)}>
            <ICONS.cancelar size={18} color={colors.niebla} strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          value={addName}
          onChangeText={setAddName}
          placeholder="Nombre completo"
          placeholderTextColor={colors.niebla}
          autoCapitalize="words"
          autoFocus
        />
        {parecidos.length > 0 && (
          <View style={styles.parecidosBox}>
            <Text style={styles.parecidosTitle}>¿Ya está uno de estos?</Text>
            {parecidos.map((t) => (
              <TouchableOpacity key={t.id} onPress={() => { onChange(t.nombre_completo, t.id); setAddMode(false) }}>
                <Text style={styles.parecidosItem}>{t.nombre_completo}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={styles.addPanelActions}>
          <TouchableOpacity style={styles.addPanelCancel} onPress={() => setAddMode(false)}>
            <Text style={styles.addPanelCancelText}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addPanelConfirm} disabled={creating} onPress={confirmarNuevo}>
            <Text style={styles.addPanelConfirmText}>{creating ? 'Creando...' : 'Sí, crear trabajador nuevo'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <View>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={(v) => onChange(v, undefined)}
        onFocus={() => setFocused(true)}
        placeholder={placeholder ?? 'Buscar trabajador...'}
        placeholderTextColor={colors.niebla}
        autoCapitalize="words"
      />
      {focused && (
        <View style={styles.suggestBox}>
          {matches.map((t) => (
            <TouchableOpacity key={t.id} style={styles.suggestItem} onPress={() => { onChange(t.nombre_completo, t.id); setFocused(false) }}>
              <Text style={styles.suggestItemText}>{t.nombre_completo}</Text>
            </TouchableOpacity>
          ))}
          {trimmed && matches.length === 0 && (
            <Text style={styles.suggestEmpty}>Nadie coincide con &quot;{trimmed}&quot;.</Text>
          )}
          <TouchableOpacity style={styles.addRow} onPress={openAddPanel}>
            <ICONS.agregar size={15} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />
            <Text style={styles.addRowText}>Agregar nuevo trabajador</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  input: {
    height: 48, backgroundColor: colors.blanco, borderRadius: 12,
    borderWidth: 1, borderColor: colors.borde,
    paddingHorizontal: 14, fontSize: 15, color: colors.ink,
  },
  suggestBox: {
    backgroundColor: colors.blanco, borderRadius: 10, borderWidth: 1, borderColor: colors.hueso,
    marginTop: 6, overflow: 'hidden',
  },
  suggestItem: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.hueso },
  suggestItemText: { fontSize: 14, color: colors.ink, fontWeight: '500' },
  suggestEmpty: { paddingVertical: 10, paddingHorizontal: 12, fontSize: 13, color: colors.niebla },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 12 },
  addRowText: { fontSize: 14, fontWeight: '700', color: colors.burdeos[600] },
  addPanel: {
    backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.hueso,
    padding: 12, gap: 10,
  },
  addPanelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addPanelTitle: { fontSize: 12, fontWeight: '700', color: colors.ink60 },
  parecidosBox: { backgroundColor: colors.crema, borderRadius: 10, borderWidth: 1, borderColor: colors.burdeos[200], padding: 10, gap: 4 },
  parecidosTitle: { fontSize: 12, fontWeight: '700', color: colors.ink },
  parecidosItem: { fontSize: 13, color: colors.burdeos[600], fontWeight: '600', textDecorationLine: 'underline', paddingVertical: 2 },
  addPanelActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  addPanelCancel: { paddingVertical: 8, paddingHorizontal: 4 },
  addPanelCancelText: { fontSize: 13, fontWeight: '600', color: colors.ink60 },
  addPanelConfirm: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.burdeos[600] },
  addPanelConfirmText: { fontSize: 13, fontWeight: '700', color: colors.blanco },
})
