'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Droplets, ClipboardList, DollarSign, Sprout, Layers, Edit2, Save, XCircle, ShoppingBasket } from 'lucide-react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { loadFincaKML, type KMLFeature } from '@/lib/kml'
import {
  getEstadoActual, VARIEDAD_LABELS,
  type ParcelaItem, type EstadoActualItem, getParcelasMapa,
} from '@/lib/api/produccion'
import { useAuthStore } from '@/store/authStore'
import api from '@/lib/api'

type ColorMode = 'type' | 'variedad' | 'cosecha'

const TYPE_STYLES: Record<string, { color: string; fillColor: string }> = {
  parral:   { color: '#16a34a', fillColor: '#22c55e' },
  potrero:  { color: '#2563eb', fillColor: '#3b82f6' },
  pasero:   { color: '#d97706', fillColor: '#f59e0b' },
  cabezal:  { color: '#0891b2', fillColor: '#06b6d4' },
  finca:    { color: '#16a34a', fillColor: '#22c55e' },
  pipeline: { color: '#c47e2a', fillColor: '#c47e2a' },
}

const VAR_COLORS: Record<string, string> = {
  flame: '#ef4444', red_globe: '#dc2626', fiesta: '#22c55e',
  bonarda: '#8b5cf6', sultanina: '#f59e0b', syrah: '#6366f1',
  aspirant: '#06b6d4', alfalfa: '#84cc16', otro: '#94a3b8',
}

const ESTADO_LABELS: Record<string, string> = {
  brotacion: 'Brotación', floracion: 'Floración', cuaje: 'Cuaje',
  envero: 'Envero', madurez: 'Madurez', cosecha: 'Cosecha', latencia: 'Latencia',
}

function formatARS(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

function cosechaColor(kg: number, maxKg: number): string {
  if (kg <= 0 || maxKg <= 0) return '#f3f4f6'
  const ratio = Math.min(kg / maxKg, 1)
  const r = Math.round(220 - ratio * (220 - 21))
  const g = Math.round(252 - ratio * (252 - 128))
  const b = Math.round(231 - ratio * (231 - 61))
  return `rgb(${r},${g},${b})`
}

function getPolyStyle(
  f: KMLFeature,
  p: ParcelaItem | undefined,
  selected: boolean,
  mode: ColorMode,
  cosechaByParcelaId?: Record<string, number>,
  maxKg?: number,
): L.PathOptions {
  if (mode === 'cosecha') {
    const kg = (p?.id != null && cosechaByParcelaId?.[p.id]) ? cosechaByParcelaId[p.id] : 0
    const fill = cosechaColor(kg, maxKg ?? 0)
    return {
      color: '#166534',
      weight: selected ? 3 : 1.5,
      fillColor: fill,
      fillOpacity: selected ? 0.75 : 0.6,
    }
  }
  let color: string, fill: string
  if (mode === 'variedad' && f.type === 'parral' && p?.variedad) {
    color = fill = VAR_COLORS[p.variedad] ?? '#94a3b8'
  } else {
    const ts = TYPE_STYLES[f.type] ?? TYPE_STYLES.parral
    color = ts.color; fill = ts.fillColor
  }
  return {
    color,
    weight: selected ? 3 : 1.5,
    fillColor: fill,
    fillOpacity: selected ? 0.55 : f.type === 'finca' ? 0.04 : 0.3,
    dashArray: f.type === 'finca' ? '6,4' : undefined,
  }
}

// ── Panel de detalle ─────────────────────────────────────────────────────────

interface PanelProps {
  name: string
  parcelas: ParcelaItem[]
  estadoActual: EstadoActualItem[]
  cosechaByParcelaId?: Record<string, number>
  onClose: () => void
}

function ParcelPanel({ name, parcelas, estadoActual, cosechaByParcelaId, onClose }: PanelProps) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const parcela = parcelas.find(p => p.nombre === name)
  const estado = estadoActual.find(e => e.parcela_nombre === name)
  const [editing, setEditing] = useState(false)
  const [editVariedad, setEditVariedad] = useState(parcela?.variedad ?? '')
  const [editSuperficie, setEditSuperficie] = useState(String(parcela?.superficie_ha ?? ''))
  const [saving, setSaving] = useState(false)

  const { fechaDesde, fechaHasta } = useMemo(() => {
    const now = new Date()
    const year = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
    return { fechaDesde: `${year}-05-01`, fechaHasta: now.toISOString().split('T')[0] }
  }, [])

  const { data: trabajos = [], isLoading: loadTrab } = useQuery({
    queryKey: ['panel-trabajo', parcela?.id, fechaDesde],
    queryFn: async () => {
      const { data } = await api.get<{ id: string; fecha: string; tarea: string; monto_total: number }[]>(
        '/produccion/trabajo/', { params: { parcela_id: parcela!.id, fecha_desde: fechaDesde, fecha_hasta: fechaHasta, limit: 500 } }
      )
      return data
    },
    enabled: !!parcela?.id,
    staleTime: 60_000,
  })

  const { data: riegos = [], isLoading: loadRiego } = useQuery({
    queryKey: ['panel-riego', parcela?.id, fechaDesde],
    queryFn: async () => {
      const { data } = await api.get<{ id: string; inicio: string; mm_aplicados: number }[]>(
        '/produccion/riego/', { params: { parcela_id: parcela!.id, fecha_desde: fechaDesde, fecha_hasta: fechaHasta, limit: 200 } }
      )
      return data
    },
    enabled: !!parcela?.id,
    staleTime: 60_000,
  })

  const costoTotal = useMemo(() => trabajos.reduce((s, t) => s + Number(t.monto_total), 0), [trabajos])
  const mmTotal = useMemo(() => riegos.reduce((s, r) => s + Number(r.mm_aplicados), 0), [riegos])
  const lastTareas = useMemo(() => {
    const m = new Map<string, string>()
    ;[...trabajos].sort((a, b) => b.fecha.localeCompare(a.fecha)).forEach(t => {
      if (!m.has(t.tarea)) m.set(t.tarea, t.fecha)
    })
    return [...m.entries()].slice(0, 4)
  }, [trabajos])

  async function handleSave() {
    if (!parcela) return
    setSaving(true)
    try {
      await api.put(`/parcelas/${parcela.id}`, {
        variedad: editVariedad || null,
        superficie_ha: editSuperficie ? parseFloat(editSuperficie) : null,
      })
      qc.invalidateQueries({ queryKey: ['parcelas-mapa'] })
      qc.invalidateQueries({ queryKey: ['parcelas'] })
      setEditing(false)
    } catch { /* ignore */ }
    setSaving(false)
  }

  const canEdit = user?.role === 'super_admin'

  const tipoLabel = parcela?.tipo === 'parral' ? 'Parral'
    : parcela?.tipo === 'potrero' ? 'Potrero'
    : parcela?.tipo === 'pasero' ? 'Pasero'
    : 'Cabezal'

  return (
    <div className="absolute right-0 top-0 bottom-0 w-72 bg-white shadow-2xl z-[1000] flex flex-col border-l border-gray-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50 flex-shrink-0">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 text-sm truncate">{name}</h3>
          {parcela && (
            <p className="text-xs text-gray-500">
              {tipoLabel}
              {parcela.variedad ? ` · ${VARIEDAD_LABELS[parcela.variedad] ?? parcela.variedad}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
          {canEdit && parcela && !editing && (
            <button
              onClick={() => { setEditVariedad(parcela.variedad ?? ''); setEditSuperficie(String(parcela.superficie_ha ?? '')); setEditing(true) }}
              className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            >
              <Edit2 size={14} />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {parcela ? (
          <>
            {editing ? (
              <div className="space-y-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-medium text-blue-700">Editar parcela</p>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Variedad</label>
                  <select
                    value={editVariedad}
                    onChange={e => setEditVariedad(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
                  >
                    <option value="">— ninguna —</option>
                    {Object.entries(VARIEDAD_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Superficie (ha)</label>
                  <input
                    type="number" step="0.1" value={editSuperficie}
                    onChange={e => setEditSuperficie(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSave} disabled={saving}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-blue-600 text-white rounded-md py-1.5 hover:bg-blue-700 disabled:opacity-60"
                  >
                    <Save size={12} /> {saving ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button onClick={() => setEditing(false)} className="px-3 text-xs text-gray-600 border border-gray-300 rounded-md py-1.5 hover:bg-gray-50">
                    <XCircle size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-gray-50 rounded-md p-2.5">
                  <p className="text-xs text-gray-400 mb-0.5">Superficie</p>
                  <p className="text-sm font-semibold text-gray-800">{parcela.superficie_ha ? `${parcela.superficie_ha} ha` : '—'}</p>
                </div>
                <div className="bg-gray-50 rounded-md p-2.5">
                  <p className="text-xs text-gray-400 mb-0.5">Cabezal</p>
                  <p className="text-sm font-semibold text-gray-800">{parcela.cabezal_riego ?? '—'}</p>
                </div>
              </div>
            )}

            {estado?.estado_fenologico && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-md px-3 py-2">
                <Sprout size={14} className="text-green-600 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-green-800">
                    {ESTADO_LABELS[estado.estado_fenologico] ?? estado.estado_fenologico}
                  </p>
                  {estado.fecha_estado && (
                    <p className="text-xs text-green-500">{estado.fecha_estado.split('-').reverse().join('/')}</p>
                  )}
                </div>
              </div>
            )}

            {cosechaByParcelaId && parcela?.id && cosechaByParcelaId[parcela.id] != null && (
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1.5">
                  <ShoppingBasket size={13} /> Cosecha — campaña actual
                </p>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-green-700">
                    {cosechaByParcelaId[parcela.id].toLocaleString('es-AR')} kg
                  </span>
                  <span className="text-xs text-gray-400">
                    {(cosechaByParcelaId[parcela.id] / 1000).toFixed(1)} t
                  </span>
                </div>
              </div>
            )}

            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1.5">
                <Droplets size={13} /> Agua — campaña actual
              </p>
              {loadRiego ? (
                <div className="h-7 bg-gray-100 rounded animate-pulse" />
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-blue-700">{mmTotal.toFixed(1)} mm</span>
                  <span className="text-xs text-gray-400">{riegos.length} riego{riegos.length !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>

            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1.5">
                <ClipboardList size={13} /> Últimas tareas — campaña actual
              </p>
              {loadTrab ? (
                <div className="space-y-1.5">
                  {[1, 2, 3].map(i => <div key={i} className="h-5 bg-gray-100 rounded animate-pulse" />)}
                </div>
              ) : lastTareas.length === 0 ? (
                <p className="text-xs text-gray-400">Sin tareas recientes</p>
              ) : (
                <div className="space-y-1">
                  {lastTareas.map(([tarea, fecha]) => (
                    <div key={tarea} className="flex justify-between text-xs">
                      <span className="text-gray-700 truncate mr-2">{tarea}</span>
                      <span className="text-gray-400 flex-shrink-0">{fecha.split('-').reverse().join('/')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500 mb-1.5">
                <DollarSign size={13} /> Costo laboral — campaña actual
              </p>
              {loadTrab ? (
                <div className="h-7 bg-gray-100 rounded animate-pulse" />
              ) : (
                <p className="text-base font-bold text-green-700">{costoTotal > 0 ? formatARS(costoTotal) : '—'}</p>
              )}
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-400 text-center py-8">No hay registro de {name} en la base de datos.</p>
        )}
      </div>
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────

interface Props { compact?: boolean; height?: string; cosechaByParcelaId?: Record<string, number> }

export default function FincaMapInner({ compact = false, height = '100%', cosechaByParcelaId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerGroupRef = useRef<L.LayerGroup | null>(null)
  const polyRef = useRef(new Map<string, L.Polygon>())

  const [features, setFeatures] = useState<KMLFeature[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [colorMode, setColorMode] = useState<ColorMode>('type')

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas-mapa'],
    queryFn: getParcelasMapa,
    staleTime: 5 * 60_000,
  })

  const { data: estadoActual = [] } = useQuery({
    queryKey: ['estado-actual'],
    queryFn: getEstadoActual,
    staleTime: 5 * 60_000,
  })

  useEffect(() => { loadFincaKML().then(setFeatures) }, [])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      center: [-32.027, -68.397],
      zoom: compact ? 14 : 15,
      zoomControl: !compact,
      attributionControl: false,
      scrollWheelZoom: !compact,
      dragging: !compact,
    })
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 20 }
    ).addTo(map)
    layerGroupRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    // Force tile recalculation after container fully settles
    const t = setTimeout(() => map.invalidateSize(), 100)
    return () => {
      clearTimeout(t)
      map.remove()
      mapRef.current = null
      layerGroupRef.current = null
    }
  }, [compact])

  // Create polygon layers (only when features change)
  useEffect(() => {
    if (!mapRef.current || !layerGroupRef.current || features.length === 0) return
    layerGroupRef.current.clearLayers()
    polyRef.current.clear()

    features.forEach(f => {
      if (!layerGroupRef.current) return
      if (f.geometry === 'line') {
        L.polyline(f.coords, { color: '#c47e2a', weight: 1.5, opacity: 0.6, interactive: false })
          .addTo(layerGroupRef.current)
        return
      }
      if (f.type === 'finca') {
        L.polygon(f.coords, { color: '#16a34a', weight: 2.5, fill: false, dashArray: '8,5', interactive: false })
          .addTo(layerGroupRef.current)
        return
      }
      const poly = L.polygon(f.coords, getPolyStyle(f, undefined, false, 'type'))
      if (!compact) {
        poly.bindTooltip(f.name, { direction: 'center', opacity: 0.9 })
        poly.on('click', () => setSelected(prev => prev === f.name ? null : f.name))
      }
      polyRef.current.set(f.name, poly)
      poly.addTo(layerGroupRef.current)
    })
  }, [features, compact])

  const maxKgLegend = useMemo(() => {
    const vals = Object.values(cosechaByParcelaId ?? {})
    return vals.length > 0 ? Math.max(...vals) : 0
  }, [cosechaByParcelaId])

  // Update styles when parcelas, selection, colorMode, or cosecha data changes
  useEffect(() => {
    const maxKg = maxKgLegend
    polyRef.current.forEach((poly, name) => {
      const f = features.find(feat => feat.name === name)
      const p = parcelas.find(parc => parc.nombre === name)
      if (f) poly.setStyle(getPolyStyle(f, p, name === selected, colorMode, cosechaByParcelaId, maxKg))
    })
  }, [features, parcelas, selected, colorMode, cosechaByParcelaId, maxKgLegend])

  const showPanel = !compact && !!selected && features.find(f => f.name === selected)?.type !== 'finca'

  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />

      {!compact && (
        <button
          onClick={() => setColorMode(m => m === 'type' ? 'variedad' : m === 'variedad' ? 'cosecha' : 'type')}
          className="absolute top-3 left-3 z-[1000] flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg shadow-md text-xs font-medium text-gray-700 hover:bg-gray-50 border border-gray-200 transition-colors"
        >
          <Layers size={13} />
          {colorMode === 'type' ? 'Por tipo' : colorMode === 'variedad' ? 'Por variedad' : '🌿 kg cosechados'}
        </button>
      )}

      {!compact && (
        <div className="absolute bottom-4 left-3 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-gray-200 px-3 py-2.5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {colorMode === 'type' ? 'Tipo' : colorMode === 'variedad' ? 'Variedad' : 'Cosecha'}
          </p>
          {colorMode === 'cosecha' ? (
            <div>
              <div className="w-28 h-3 rounded mb-1" style={{ background: 'linear-gradient(to right, #dcfce7, #15803d)' }} />
              <div className="flex justify-between text-xs text-gray-500">
                <span>0</span>
                <span>{maxKgLegend > 0 ? `${(maxKgLegend / 1000).toFixed(1)}t` : '—'}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {colorMode === 'type' ? (
                [
                  { k: 'parral', label: 'Parral' },
                  { k: 'potrero', label: 'Potrero' },
                  { k: 'pasero', label: 'Pasero' },
                  { k: 'cabezal', label: 'Cabezal' },
                ].map(({ k, label }) => (
                  <div key={k} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: TYPE_STYLES[k].fillColor }} />
                    <span className="text-xs text-gray-700">{label}</span>
                  </div>
                ))
              ) : (
                Object.entries(VARIEDAD_LABELS).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: VAR_COLORS[k] ?? '#94a3b8' }} />
                    <span className="text-xs text-gray-700">{v}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {showPanel && (
        <ParcelPanel
          name={selected!}
          parcelas={parcelas}
          estadoActual={estadoActual}
          cosechaByParcelaId={cosechaByParcelaId}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
