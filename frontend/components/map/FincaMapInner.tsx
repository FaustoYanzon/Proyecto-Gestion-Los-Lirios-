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
import LayerControl, { type LayerVisibility } from './LayerControl'

type ColorMode = 'type' | 'variedad' | 'cosecha'

const TYPE_STYLES: Record<string, { color: string; fillColor: string }> = {
  parral:   { color: '#5a1320', fillColor: '#7a1f2c' },
  potrero:  { color: '#2d4a28', fillColor: '#3f5c3a' },
  pasero:   { color: '#6b4420', fillColor: '#8a5a2b' },
  cabezal:  { color: '#2d5468', fillColor: '#3d6b86' },
  finca:    { color: '#2d4a28', fillColor: '#3f5c3a' },
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
    fillOpacity: f.type === 'finca' ? 0.04
      : f.type === 'parral' ? (selected ? 0.28 : 0.15)
      : (selected ? 0.55 : 0.3),
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
  onQuickAction: (a: 'riego' | 'tarea' | 'fito') => void
}

function ParcelPanel({ name, parcelas, estadoActual, cosechaByParcelaId, onClose, onQuickAction }: PanelProps) {
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
              className="p-1.5 rounded text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
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
              <div className="space-y-3 bg-[#faf6ec] border border-[#fbfaf6] rounded-lg p-3">
                <p className="text-xs font-medium text-[#7a1f2c]">Editar parcela</p>
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
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium bg-[#7a1f2c] text-white rounded-md py-1.5 hover:bg-[#5a1320] disabled:opacity-60"
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
                  <span className="text-sm font-bold text-[#3d6b86]">{mmTotal.toFixed(1)} mm</span>
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
                <p className="text-base font-bold text-[#3f5c3a]">{costoTotal > 0 ? formatARS(costoTotal) : '—'}</p>
              )}
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-400 text-center py-8">No hay registro de {name} en la base de datos.</p>
        )}
      </div>

      {/* Acciones rápidas */}
      {parcela && (
        <div className="flex-shrink-0 border-t border-[#fbfaf6] px-4 py-3 flex gap-2">
          {([
            { key: 'riego', label: '+ Riego' },
            { key: 'tarea', label: '+ Tarea' },
            { key: 'fito',  label: '+ Fito'  },
          ] as { key: 'riego' | 'tarea' | 'fito'; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onQuickAction(key)}
              className="flex-1 py-1.5 text-xs font-medium rounded-md border transition-colors
                         border-[#fbfaf6] text-[#5a544c] hover:bg-[#7a1f2c] hover:text-white hover:border-[#7a1f2c]"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────

interface Props { compact?: boolean; height?: string; cosechaByParcelaId?: Record<string, number> }

// ── GeoJSON coordinate helpers ───────────────────────────────────────────────
// GeoJSON spec: [lng, lat]. Some tools (Google Earth, QGIS export) save [lat, lng].
// For Los Lirios (Mendoza): lat ≈ -32, lng ≈ -68.
// Detection: if first coordinate value > -60, it's latitude-first → swap.

function swapCoordsArr(c: unknown): unknown {
  if (!Array.isArray(c)) return c
  if (c.length >= 2 && typeof c[0] === 'number') return [c[1], c[0], ...c.slice(2)]
  return c.map(swapCoordsArr)
}

function normalizeGeoJSON(raw: object): object {
  const data = raw as { features?: Array<{ geometry: { type: string; coordinates: unknown } }> }
  if (!data?.features?.length) return raw
  const geom = data.features[0]?.geometry
  let sample: number[] | null = null
  if (geom?.type === 'Point')           sample = geom.coordinates as number[]
  else if (geom?.type === 'LineString') sample = (geom.coordinates as number[][])[0]
  else if (geom?.type === 'Polygon')    sample = ((geom.coordinates as number[][][])[0])?.[0]
  else if (geom?.type === 'MultiLineString') sample = ((geom.coordinates as number[][][])[0])?.[0]
  if (!sample || sample[0] < -60) return raw // already lng-first (valid for Mendoza)
  // Swap [lat, lng] → [lng, lat] throughout all features
  const cloned = JSON.parse(JSON.stringify(raw)) as typeof data
  cloned.features?.forEach(f => { f.geometry.coordinates = swapCoordsArr(f.geometry.coordinates) })
  return cloned as object
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeInfraPopup(label: string): (feature: any, layer: L.Layer) => void {
  return (feature, layer) => {
    const props = feature?.properties as Record<string, unknown> | null
    if (!props) return
    const entries = Object.entries(props).filter(([, v]) => v != null && v !== '')
    if (entries.length === 0) return
    const rows = entries.map(([k, v]) =>
      `<div style="margin:0 0 2px"><span style="color:#9ca3af;text-transform:capitalize">${k.replace(/_/g, ' ')}:</span> ${v}</div>`
    ).join('')
    ;(layer as L.Path).bindPopup(
      `<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:11px;color:#4b5563">` +
      `<p style="font-size:11px;font-weight:700;color:#111827;margin:0 0 5px;padding-bottom:4px;border-bottom:1px solid #f0f0f0">${label}</p>` +
      rows + `</div>`,
      { maxWidth: 260 }
    )
  }
}

const INFRA_LEGEND = [
  { label: 'Acequias',        color: '#38bdf8', shape: 'line'   as const },
  { label: 'Línea eléctrica', color: '#facc15', shape: 'line'   as const },
  { label: 'Cañerías',        color: '#1e3a8a', shape: 'line'   as const },
  { label: 'Válvulas',        color: '#1e3a8a', shape: 'dot'    as const },
  { label: 'Cuadrantes',      color: '#9ca3af', shape: 'poly'   as const },
]

export default function FincaMapInner({ compact = false, height = '100%', cosechaByParcelaId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerGroupRef = useRef<L.LayerGroup | null>(null)
  const polyRef = useRef(new Map<string, L.Polygon>())

  // Extra infrastructure layers
  const extraGroupsRef = useRef<Partial<Record<keyof LayerVisibility, L.LayerGroup>>>({})
  const visibleLayersRef = useRef<LayerVisibility>({
    acequias: false, lineaElectrica: false, canerias: false, valvulas: false, cuadrantesRiego: false,
  })

  const [features, setFeatures] = useState<KMLFeature[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [colorMode, setColorMode] = useState<ColorMode>('type')
  const [quickAction, setQuickAction] = useState<'riego' | 'tarea' | 'fito' | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [visibleLayers, setVisibleLayers] = useState<LayerVisibility>({
    acequias: false, lineaElectrica: false, canerias: false, valvulas: false, cuadrantesRiego: false,
  })
  const [layerData, setLayerData] = useState<Partial<Record<keyof LayerVisibility, object>>>({})

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

  // ── Map initialisation ───────────────────────────────────────────────────────
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
    setMapReady(true)
    // Force tile recalculation after container fully settles
    const t = setTimeout(() => map.invalidateSize(), 100)
    return () => {
      clearTimeout(t)
      map.remove()
      mapRef.current = null
      layerGroupRef.current = null
      extraGroupsRef.current = {}
      setMapReady(false)
    }
  }, [compact])

  // ── KML polygon layers ───────────────────────────────────────────────────────
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

  // ── Style updates ────────────────────────────────────────────────────────────
  useEffect(() => {
    const maxKg = maxKgLegend
    polyRef.current.forEach((poly, name) => {
      const f = features.find(feat => feat.name === name)
      const p = parcelas.find(parc => parc.nombre === name)
      if (f) poly.setStyle(getPolyStyle(f, p, name === selected, colorMode, cosechaByParcelaId, maxKg))
    })
  }, [features, parcelas, selected, colorMode, cosechaByParcelaId, maxKgLegend])

  // ── Load GeoJSON layer data ──────────────────────────────────────────────────
  useEffect(() => {
    const layers: Array<{ key: keyof LayerVisibility; path: string }> = [
      { key: 'acequias',        path: '/layers/Acequias.geojson'                                    },
      { key: 'lineaElectrica',  path: '/layers/Linea%20Electrica.geojson'                           },
      { key: 'canerias',        path: '/layers/Ca%C3%B1erias%20Primarias%20y%20Secundarias.geojson' },
      { key: 'valvulas',        path: '/layers/Valvulas.geojson'                                    },
      { key: 'cuadrantesRiego', path: '/layers/Cuadrantes%20de%20Riego.geojson'                     },
    ]
    Promise.allSettled(
      layers.map(({ key, path }) =>
        fetch(path)
          .then(r => r.ok ? r.json() : null)
          .then(data => ({ key, data }))
          .catch((err) => { console.error(`[mapa] Error cargando capa "${key}":`, err); return { key, data: null } })
      )
    ).then(results => {
      const newData: Partial<Record<keyof LayerVisibility, object>> = {}
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value?.data) newData[r.value.key] = r.value.data
      })
      setLayerData(newData)
    })
  }, [])

  // ── Build Leaflet layer groups when map + data are ready ─────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current

    // Remove old groups
    Object.values(extraGroupsRef.current).forEach(g => {
      if (g && map.hasLayer(g)) map.removeLayer(g)
    })
    extraGroupsRef.current = {}

    type CfgEntry = { key: keyof LayerVisibility; build: (data: object) => L.Layer }
    const configs: CfgEntry[] = [
      {
        key: 'acequias',
        build: d => L.geoJSON(normalizeGeoJSON(d) as never, {
          style: () => ({ color: '#38bdf8', weight: 2, opacity: 0.85 }),
          onEachFeature: makeInfraPopup('Acequia'),
        }),
      },
      {
        key: 'lineaElectrica',
        build: d => L.geoJSON(normalizeGeoJSON(d) as never, {
          style: () => ({ color: '#facc15', weight: 2, opacity: 0.85 }),
          onEachFeature: makeInfraPopup('Línea eléctrica'),
        }),
      },
      {
        key: 'canerias',
        build: d => L.geoJSON(normalizeGeoJSON(d) as never, {
          style: () => ({ color: '#1e3a8a', weight: 2, opacity: 0.85 }),
          onEachFeature: makeInfraPopup('Cañería'),
        }),
      },
      {
        key: 'valvulas',
        build: d => L.geoJSON(normalizeGeoJSON(d) as never, {
          pointToLayer: (_f, latlng) =>
            L.circleMarker(latlng, {
              radius: 5, color: '#1e3a8a', fillColor: '#1e3a8a',
              fillOpacity: 1, weight: 1.5,
            }),
          onEachFeature: makeInfraPopup('Válvula'),
        }),
      },
      {
        key: 'cuadrantesRiego',
        build: d => L.geoJSON(normalizeGeoJSON(d) as never, {
          style: () => ({ color: '#d1d5db', fillColor: '#d1d5db', fillOpacity: 0.15, weight: 1.5 }),
          interactive: false,
        }),
      },
    ]

    configs.forEach(({ key, build }) => {
      const data = layerData[key]
      if (!data) return
      const group = L.layerGroup([build(data)])
      extraGroupsRef.current[key] = group
      // Respect current visibility state (use ref to avoid stale closure)
      if (visibleLayersRef.current[key]) group.addTo(map)
    })
  }, [mapReady, layerData])

  // ── Toggle layer visibility ──────────────────────────────────────────────────
  useEffect(() => {
    visibleLayersRef.current = visibleLayers
    if (!mapRef.current) return
    const map = mapRef.current
    ;(Object.keys(visibleLayers) as Array<keyof LayerVisibility>).forEach(key => {
      const group = extraGroupsRef.current[key]
      if (!group) return
      if (visibleLayers[key] && !map.hasLayer(group)) group.addTo(map)
      if (!visibleLayers[key] && map.hasLayer(group)) map.removeLayer(group)
    })
  }, [visibleLayers])

  const showPanel = !compact && !!selected && features.find(f => f.name === selected)?.type !== 'finca'

  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      <div ref={containerRef} className="absolute inset-0" />

      {/* Color mode chips — top left */}
      {!compact && (
        <div className="absolute top-3 left-3 z-[1000] flex items-center gap-1 bg-white/95 backdrop-blur-sm rounded-lg shadow-md border border-gray-200 p-1">
          <Layers size={12} className="text-gray-400 ml-1 mr-0.5 flex-shrink-0" />
          {([
            { mode: 'type',    label: 'Tipo'     },
            { mode: 'variedad', label: 'Variedad' },
            { mode: 'cosecha',  label: 'Cosecha'  },
          ] as { mode: ColorMode; label: string }[]).map(({ mode, label }) => (
            <button
              key={mode}
              onClick={() => setColorMode(mode)}
              className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
              style={
                colorMode === mode
                  ? { backgroundColor: '#7a1f2c', color: '#ffffff' }
                  : { color: '#5a544c' }
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Layer control — top right */}
      {!compact && (
        <LayerControl visible={visibleLayers} onChange={setVisibleLayers} />
      )}

      {/* Legend — bottom left */}
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

          {/* ── Infrastructure layers divider ──────────────────────── */}
          <div className="border-t border-gray-100 mt-2 pt-2 space-y-1.5">
            {INFRA_LEGEND.map(({ label, color, shape }) => (
              <div key={label} className="flex items-center gap-2">
                {shape === 'line' && (
                  <div className="w-4 flex items-center flex-shrink-0">
                    <div className="w-full h-[2px] rounded-full" style={{ background: color }} />
                  </div>
                )}
                {shape === 'dot' && (
                  <div className="w-3 flex items-center justify-center flex-shrink-0">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                  </div>
                )}
                {shape === 'poly' && (
                  <div
                    className="w-3 h-3 rounded-[2px] border flex-shrink-0"
                    style={{ background: color, borderColor: '#9ca3af' }}
                  />
                )}
                <span className="text-xs text-gray-500">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showPanel && (
        <ParcelPanel
          name={selected!}
          parcelas={parcelas}
          estadoActual={estadoActual}
          cosechaByParcelaId={cosechaByParcelaId}
          onClose={() => setSelected(null)}
          onQuickAction={setQuickAction}
        />
      )}

      {/* Modal placeholder acciones rápidas */}
      {quickAction && (
        <div
          className="absolute inset-0 z-[2000] flex items-center justify-center"
          style={{ backgroundColor: 'rgba(31,26,23,0.4)' }}
          onClick={() => setQuickAction(null)}
        >
          <div
            className="bg-white rounded-[14px] px-8 py-6 text-center"
            style={{ boxShadow: '0 12px 32px rgba(31,26,23,0.12)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-[#1f1a17] mb-1">
              Nuevo {quickAction === 'riego' ? 'Riego' : quickAction === 'tarea' ? 'Tarea' : 'Fitosanitario'}
            </p>
            <p className="text-xs text-[#a09584] mb-4">Formulario disponible en Fase 4</p>
            <button
              onClick={() => setQuickAction(null)}
              className="px-4 py-1.5 rounded-md text-sm font-medium bg-[#7a1f2c] text-white hover:bg-[#5a1320] transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
