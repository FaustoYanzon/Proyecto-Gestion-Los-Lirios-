import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native'
import api from '../lib/api'
import { colors } from '../lib/theme'
import { ICONS, ICON_STROKE } from '../lib/icons'
import type { Insumo } from '../lib/types'

function normalizar(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g'), '')
    .trim()
    .toLowerCase()
}

interface Props {
  value: string
  insumoId?: string
  insumosDb: Insumo[]
  onChange: (nombre: string, insumoId?: string, unidad?: 'kg' | 'lt') => void
  onCreated?: (nuevo: Insumo) => void
  placeholder?: string
}

// Mismo criterio que TrabajadorPicker: elegir de la lista es obligatorio, no
// se acepta texto libre como producto (hace falta un Insumo real con unidad
// conocida para calcular cantidad total y descontar stock). Ver
// frontend/components/produccion/InsumoSelect.tsx (mismo comportamiento web).
export default function InsumoPicker({ value, insumoId, insumosDb, onChange, onCreated, placeholder }: Props) {
  const [focused, setFocused] = useState(false)
  const [addMode, setAddMode] = useState(false)
  const [addName, setAddName] = useState('')
  const [addUnidad, setAddUnidad] = useState<'kg' | 'lt'>('lt')
  const [creating, setCreating] = useState(false)

  const trimmed = value.trim()
  const matches = trimmed
    ? insumosDb.filter((i) => normalizar(i.nombre).includes(normalizar(trimmed))).slice(0, 5)
    : []

  function openAddPanel() {
    setAddName(trimmed)
    setAddUnidad('lt')
    setAddMode(true)
    setFocused(false)
  }

  const parecidos = addMode
    ? insumosDb.filter((i) => {
        const a = normalizar(i.nombre)
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
      const { data } = await api.post<Insumo>('/insumos/', { nombre, unidad: addUnidad })
      onChange(data.nombre, data.id, data.unidad)
      onCreated?.(data)
      setAddMode(false)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      Alert.alert('Error', typeof detail === 'string' ? detail : 'Error al crear el insumo.')
    } finally {
      setCreating(false)
    }
  }

  if (addMode) {
    return (
      <View style={styles.addPanel}>
        <View style={styles.addPanelHeader}>
          <Text style={styles.addPanelTitle}>Nuevo insumo</Text>
          <TouchableOpacity onPress={() => setAddMode(false)}>
            <ICONS.cancelar size={18} color={colors.niebla} strokeWidth={ICON_STROKE} />
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          value={addName}
          onChangeText={setAddName}
          placeholder="Nombre del producto"
          placeholderTextColor={colors.niebla}
          autoFocus
        />
        <View style={styles.unidadRow}>
          {(['lt', 'kg'] as const).map((u) => (
            <TouchableOpacity
              key={u}
              style={[styles.unidadBtn, addUnidad === u && styles.unidadBtnActive]}
              onPress={() => setAddUnidad(u)}
            >
              <Text style={[styles.unidadBtnText, addUnidad === u && styles.unidadBtnTextActive]}>
                {u === 'lt' ? 'Litros (lt)' : 'Kilogramos (kg)'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {parecidos.length > 0 && (
          <View style={styles.parecidosBox}>
            <Text style={styles.parecidosTitle}>¿Ya está uno de estos?</Text>
            {parecidos.map((i) => (
              <TouchableOpacity key={i.id} onPress={() => { onChange(i.nombre, i.id, i.unidad); setAddMode(false) }}>
                <Text style={styles.parecidosItem}>{i.nombre} ({i.stock_actual} {i.unidad})</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={styles.addPanelActions}>
          <TouchableOpacity style={styles.addPanelCancel} onPress={() => setAddMode(false)}>
            <Text style={styles.addPanelCancelText}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addPanelConfirm} disabled={creating} onPress={confirmarNuevo}>
            <Text style={styles.addPanelConfirmText}>{creating ? 'Creando...' : 'Sí, crear insumo nuevo'}</Text>
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
        onChangeText={(v) => onChange(v, undefined, undefined)}
        onFocus={() => setFocused(true)}
        placeholder={placeholder ?? 'Buscar insumo...'}
        placeholderTextColor={colors.niebla}
      />
      {focused && (
        <View style={styles.suggestBox}>
          {matches.map((i) => (
            <TouchableOpacity key={i.id} style={styles.suggestItem} onPress={() => { onChange(i.nombre, i.id, i.unidad); setFocused(false) }}>
              <Text style={styles.suggestItemText}>{i.nombre}</Text>
              <Text style={styles.suggestItemStock}>{i.stock_actual} {i.unidad}</Text>
            </TouchableOpacity>
          ))}
          {trimmed && matches.length === 0 && (
            <Text style={styles.suggestEmpty}>Ningún insumo coincide con &quot;{trimmed}&quot;.</Text>
          )}
          <TouchableOpacity style={styles.addRow} onPress={openAddPanel}>
            <ICONS.agregar size={15} color={colors.burdeos[600]} strokeWidth={ICON_STROKE} />
            <Text style={styles.addRowText}>Agregar nuevo insumo</Text>
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
  suggestItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.hueso,
  },
  suggestItemText: { fontSize: 14, color: colors.ink, fontWeight: '500' },
  suggestItemStock: { fontSize: 12, color: colors.niebla, fontVariant: ['tabular-nums'] },
  suggestEmpty: { paddingVertical: 10, paddingHorizontal: 12, fontSize: 13, color: colors.niebla },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 12 },
  addRowText: { fontSize: 14, fontWeight: '700', color: colors.burdeos[600] },
  addPanel: {
    backgroundColor: colors.blanco, borderRadius: 12, borderWidth: 1, borderColor: colors.hueso,
    padding: 12, gap: 10,
  },
  addPanelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addPanelTitle: { fontSize: 12, fontWeight: '700', color: colors.ink60 },
  unidadRow: { flexDirection: 'row', gap: 8 },
  unidadBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.borde,
    alignItems: 'center',
  },
  unidadBtnActive: { backgroundColor: colors.burdeos[600], borderColor: colors.burdeos[600] },
  unidadBtnText: { fontSize: 12, fontWeight: '600', color: colors.ink60 },
  unidadBtnTextActive: { color: colors.blanco },
  parecidosBox: { backgroundColor: colors.crema, borderRadius: 10, borderWidth: 1, borderColor: colors.burdeos[200], padding: 10, gap: 4 },
  parecidosTitle: { fontSize: 12, fontWeight: '700', color: colors.ink },
  parecidosItem: { fontSize: 13, color: colors.burdeos[600], fontWeight: '600', textDecorationLine: 'underline', paddingVertical: 2 },
  addPanelActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  addPanelCancel: { paddingVertical: 8, paddingHorizontal: 4 },
  addPanelCancelText: { fontSize: 13, fontWeight: '600', color: colors.ink60 },
  addPanelConfirm: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.burdeos[600] },
  addPanelConfirmText: { fontSize: 13, fontWeight: '700', color: colors.blanco },
})
