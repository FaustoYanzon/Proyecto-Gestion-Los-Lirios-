'use client'

import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sprout, Save, X, Sparkles, PenLine, RotateCcw } from 'lucide-react'
import {
  getFenologiaEstadoActual, createCicloCampana, getParcelasMapa, VARIEDAD_LABELS,
  limpiarOverridesFenologia,
  type FaseVariedadItem,
} from '@/lib/api/produccion'

// ── Constants ─────────────────────────────────────────────────────────────────

const ESTADOS = [
  'brotacion', 'floracion', 'cuaje', 'envero', 'madurez', 'cosecha', 'latencia',
] as const
type EstadoKey = (typeof ESTADOS)[number]

const ESTADO_LABELS: Record<EstadoKey, string> = {
  brotacion: 'Brotación', floracion: 'Floración', cuaje: 'Cuaje',
  envero: 'Envero', madurez: 'Madurez', cosecha: 'Cosecha', latencia: 'Latencia',
}

const ESTADO_COLORS: Record<EstadoKey, { bg: string; text: string; dot: string; border: string }> = {
  brotacion: { bg: 'bg-lime-50',   text: 'text-lime-700',   dot: 'bg-lime-500',   border: 'border-lime-300' },
  floracion:  { bg: 'bg-pink-50',   text: 'text-pink-700',   dot: 'bg-pink-500',   border: 'border-pink-300' },
  cuaje:      { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500', border: 'border-orange-300' },
  envero:     { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500', border: 'border-purple-300' },
  madurez:    { bg: 'bg-green-50',  text: 'text-green-700',  dot: 'bg-green-500',  border: 'border-green-300' },
  cosecha:    { bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-500',    border: 'border-red-300' },
  latencia:   { bg: 'bg-gray-50',   text: 'text-gray-600',   dot: 'bg-gray-400',   border: 'border-gray-300' },
}

const TIMELINE_DOTS: Record<EstadoKey, string> = {
  brotacion: 'bg-lime-500', floracion: 'bg-pink-500', cuaje: 'bg-orange-500',
  envero: 'bg-purple-500', madurez: 'bg-green-500', cosecha: 'bg-red-500', latencia: 'bg-gray-400',
}

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(date: string | null): string {
  if (!date) return '—'
  return date.split('-').reverse().join('/')
}

function toEstadoKey(estado: string): EstadoKey {
  return (ESTADOS as readonly string[]).includes(estado) ? (estado as EstadoKey) : 'latencia'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EstadoBadge({ estado }: { estado: string }) {
  const c = ESTADO_COLORS[toEstadoKey(estado)]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {ESTADO_LABELS[toEstadoKey(estado)]}
    </span>
  )
}

function EstadoTimeline({ estado }: { estado: string }) {
  const idx = ESTADOS.indexOf(toEstadoKey(estado))
  return (
    <div className="flex items-center gap-0.5 w-36">
      {ESTADOS.map((e, i) => (
        <div
          key={e}
          title={ESTADO_LABELS[e]}
          className={`h-2 flex-1 rounded-sm transition-all ${
            i === idx ? TIMELINE_DOTS[e] : i < idx ? 'bg-gray-300' : 'bg-gray-100'
          }`}
        />
      ))}
    </div>
  )
}

function FuenteTag({ fuente, fecha }: { fuente: string; fecha: string | null }) {
  if (fuente === 'manual') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[#7a1f2c] font-medium">
        <PenLine size={11} /> Confirmado a mano{fecha ? ` · ${fmt(fecha)}` : ''}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
      <Sparkles size={11} /> Estimado automático
    </span>
  )
}

// ── Update Modal (bulk por variedad) ────────────────────────────────────────────

function UpdateModal({
  item,
  parcelaIds,
  onClose,
  onSaved,
}: {
  item: FaseVariedadItem
  parcelaIds: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [estado, setEstado] = useState<EstadoKey>(toEstadoKey(item.estado_fenologico))
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (parcelaIds.length === 0) {
      setError('No hay parrales activos para esta variedad.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const anio = new Date().getMonth() >= 4 ? new Date().getFullYear() : new Date().getFullYear() - 1
      const fecha_estado = new Date().toISOString().split('T')[0]
      // Confirma el estado para TODOS los parrales de la variedad a la vez
      // (la campaña ahora se gestiona por variedad, no parral por parral).
      await Promise.all(
        parcelaIds.map((parcela_id) =>
          createCicloCampana({
            parcela_id,
            anio,
            estado_fenologico: estado,
            fecha_estado,
            observaciones: obs.trim() || null,
          })
        )
      )
      onSaved()
      onClose()
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50">
          <div>
            <h2 className="font-semibold text-gray-900">{VARIEDAD_LABELS[item.variedad] ?? item.variedad}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Confirmar estado real — se aplica a {parcelaIds.length} parral{parcelaIds.length !== 1 ? 'es' : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Estado Fenológico</p>
            <div className="space-y-1.5">
              {ESTADOS.map((e) => {
                const c = ESTADO_COLORS[e]
                const isSelected = estado === e
                return (
                  <button
                    key={e}
                    onClick={() => setEstado(e)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 transition-all text-left ${
                      isSelected
                        ? `${c.bg} ${c.border} ${c.text}`
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    <span className={`w-3 h-3 rounded-full flex-shrink-0 ${isSelected ? c.dot : 'bg-gray-200'}`} />
                    <span className={`text-sm font-medium ${isSelected ? c.text : ''}`}>{ESTADO_LABELS[e]}</span>
                    {isSelected && <span className="ml-auto text-xs font-bold">✓</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Observaciones — opcional
            </label>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Notas adicionales..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]"
            />
          </div>

          <p className="text-xs text-gray-400">
            Esta confirmación reemplaza el estimado automático para esta variedad durante ~45 días.
            Pasado ese tiempo, si no se vuelve a confirmar, el sistema retoma el cálculo automático.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-[2] flex items-center justify-center gap-2 bg-[#7a1f2c] text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-[#5a1320] disabled:opacity-60 transition-colors"
          >
            <Save size={14} />
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CampanaPage() {
  const [editing, setEditing] = useState<FaseVariedadItem | null>(null)
  const [resetting, setResetting] = useState(false)
  const qc = useQueryClient()

  const { data: fases = [], isLoading } = useQuery({
    queryKey: ['fenologia-campana'],
    queryFn: getFenologiaEstadoActual,
    staleTime: 30_000,
  })

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas-mapa'],
    queryFn: getParcelasMapa,
    staleTime: 5 * 60_000,
  })

  // Cuenta parrales (no variedades) por estado, para que los badges de
  // resumen sigan reflejando cuánta superficie está en cada fase.
  const summary = useMemo(() =>
    ESTADOS.reduce<Record<string, number>>((acc, e) => {
      acc[e] = fases
        .filter((f) => toEstadoKey(f.estado_fenologico) === e)
        .reduce((s, f) => s + f.parcelas.length, 0)
      return acc
    }, {}),
  [fases])

  const sinCalendario = useMemo(() => {
    const conVariedad = new Set(fases.map((f) => f.variedad))
    return parcelas.filter((p) => p.tipo === 'parral' && p.is_active && p.variedad && !conVariedad.has(p.variedad))
  }, [fases, parcelas])

  function parcelaIdsDeVariedad(variedad: string): string[] {
    return parcelas
      .filter((p) => p.tipo === 'parral' && p.is_active && p.variedad === variedad)
      .map((p) => p.id)
  }

  function onSaved() {
    qc.invalidateQueries({ queryKey: ['fenologia-campana'] })
    qc.invalidateQueries({ queryKey: ['fenologia-mapa'] })
    qc.invalidateQueries({ queryKey: ['fenologia-notificaciones'] })
  }

  const hasManual = fases.some((f) => f.fuente === 'manual')

  async function handleReset() {
    if (!confirm(
      'Esto borra las confirmaciones manuales de fenología cargadas para probar el sistema ' +
      '(no toca el historial real de cosecha) y deja el estado de cada variedad 100% gobernado ' +
      'por el calendario automático. ¿Continuar?'
    )) return
    setResetting(true)
    try {
      await limpiarOverridesFenologia()
      onSaved()
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="space-y-5">
      {editing && (
        <UpdateModal
          item={editing}
          parcelaIds={parcelaIdsDeVariedad(editing.variedad)}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Ciclo de Campaña</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Estado fenológico por variedad · Campaña {DEFAULT_YEAR}/{DEFAULT_YEAR + 1}
          </p>
        </div>
        {hasManual && (
          <button
            onClick={handleReset}
            disabled={resetting}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#7a1f2c] border border-gray-200 hover:border-[#7a1f2c] rounded-lg px-3 py-1.5 transition-colors disabled:opacity-60"
          >
            <RotateCcw size={13} />
            {resetting ? 'Limpiando...' : 'Resetear a automático'}
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="flex flex-wrap gap-2">
        {ESTADOS.filter((e) => (summary[e] ?? 0) > 0).map((e) => {
          const c = ESTADO_COLORS[e]
          return (
            <span
              key={e}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${c.bg} ${c.text}`}
            >
              <span className={`w-2 h-2 rounded-full ${c.dot}`} />
              {ESTADO_LABELS[e]} · {summary[e]} parral{summary[e] !== 1 ? 'es' : ''}
            </span>
          )
        })}
        {sinCalendario.length > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-50 text-gray-500">
            <span className="w-2 h-2 rounded-full bg-gray-300" />
            Sin calendario definido · {sinCalendario.length}
          </span>
        )}
      </div>

      {/* Tabla por variedad */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" style={{ opacity: 1 - i * 0.15 }} />
            ))}
          </div>
        ) : fases.length === 0 ? (
          <div className="p-10 text-center">
            <Sprout size={32} className="mx-auto text-gray-200 mb-3" />
            <p className="text-gray-400">Sin variedades con calendario definido todavía</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Variedad
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Parrales
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Progresión
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Estado actual
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Tareas recomendadas
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {fases.map((item) => (
                <tr key={item.variedad} className="hover:bg-gray-50 transition-colors align-top">
                  <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">
                    {VARIEDAD_LABELS[item.variedad] ?? item.variedad}
                    <p className="text-[11px] font-normal text-gray-400 capitalize">{item.tipo_uso}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[220px]">
                    {item.parcelas.join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    <EstadoTimeline estado={item.estado_fenologico} />
                  </td>
                  <td className="px-4 py-3">
                    <EstadoBadge estado={item.estado_fenologico} />
                    <div className="mt-1">
                      <FuenteTag fuente={item.fuente} fecha={item.fecha_confirmacion} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[280px]">
                    {item.tareas_recomendadas.slice(0, 2).map((t, i) => (
                      <p key={i} className="leading-snug">• {t}</p>
                    ))}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => setEditing(item)}
                      className="text-xs text-[#7a1f2c] hover:text-[#5a1320] font-semibold hover:underline transition-colors"
                    >
                      Actualizar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
