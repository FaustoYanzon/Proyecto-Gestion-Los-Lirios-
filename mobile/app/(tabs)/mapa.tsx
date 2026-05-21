import { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  ScrollView,
} from 'react-native'
import { WebView, WebViewMessageEvent } from 'react-native-webview'
import { Ionicons } from '@expo/vector-icons'
import api from '../../lib/api'
import type { Parcela } from '../../lib/types'
import { FINCA_FEATURES } from '../../lib/kmlData'

const TYPE_COLORS: Record<string, { stroke: string; fill: string }> = {
  parral:   { stroke: '#15803d', fill: '#22c55e' },
  potrero:  { stroke: '#1d4ed8', fill: '#3b82f6' },
  pasero:   { stroke: '#b45309', fill: '#f59e0b' },
  cabezal:  { stroke: '#0e7490', fill: '#06b6d4' },
  finca:    { stroke: '#15803d', fill: 'transparent' },
  pipeline: { stroke: '#c47e2a', fill: 'transparent' },
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
const ESTADO_COLORS: Record<string, string> = {
  brotacion: '#84cc16', floracion: '#f472b6', cuaje: '#fb923c',
  envero: '#c084fc', madurez: '#facc15', cosecha: '#22c55e', latencia: '#94a3b8',
}

interface EstadoActual {
  parcela_id: string
  parcela_nombre: string
  estado_fenologico: string | null
  fecha_estado: string | null
}

interface ParcelPanel {
  parcela: Parcela
  estado: EstadoActual | null
  mmTotal: number | null
  tareas: { tarea: string; fecha: string }[]
  loadingExtra: boolean
}

function buildMapHTML(parcelas: Parcela[]): string {
  const featuresJSON = JSON.stringify(FINCA_FEATURES)
  const parcelasJSON = JSON.stringify(
    parcelas.map((p) => ({
      id: p.id, nombre: p.nombre, tipo: p.tipo,
      variedad: p.variedad, superficie_ha: p.superficie_ha, cabezal_riego: p.cabezal_riego,
    }))
  )
  const typeColorsJSON = JSON.stringify(TYPE_COLORS)
  const varColorsJSON = JSON.stringify(VAR_COLORS)

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
html,body,#map { width:100%; height:100%; }
.leaflet-container { font-family: -apple-system, sans-serif; }
#mode-btn {
  position:absolute; top:10px; left:10px; z-index:1000;
  background:#fff; border:1px solid #d1d5db; border-radius:8px;
  padding:7px 12px; font-size:12px; font-weight:700;
  color:#374151; cursor:pointer; display:flex; align-items:center; gap:5px;
  box-shadow:0 1px 4px rgba(0,0,0,0.12);
}
#legend {
  position:absolute; bottom:20px; left:10px; z-index:1000;
  background:rgba(255,255,255,0.96); border:1px solid #e5e7eb;
  border-radius:10px; padding:10px 12px;
  box-shadow:0 2px 8px rgba(0,0,0,0.12); min-width:110px;
}
.legend-title { font-size:10px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:7px; }
.legend-item { display:flex; align-items:center; gap:7px; margin-bottom:5px; }
.legend-dot { width:12px; height:12px; border-radius:3px; flex-shrink:0; }
.legend-label { font-size:12px; color:#374151; }
</style>
</head>
<body>
<div id="map"></div>
<button id="mode-btn" onclick="toggleMode()">&#9632; Por tipo</button>
<div id="legend"><div class="legend-title" id="legend-title">Tipo</div><div id="legend-items"></div></div>

<script>
const FEATURES = ${featuresJSON};
const PARCELAS = ${parcelasJSON};
const TYPE_COLORS = ${typeColorsJSON};
const VAR_COLORS = ${varColorsJSON};

let colorMode = 'type';
let selectedName = null;
const polyMap = {};

const map = L.map('map', { center: [-32.027, -68.397], zoom: 15, attributionControl: false });
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20 }).addTo(map);

function getStyle(f, selected) {
  const p = PARCELAS.find(p => p.nombre === f.name);
  let stroke, fill;
  if (colorMode === 'variedad' && f.type === 'parral' && p && p.variedad) {
    stroke = fill = VAR_COLORS[p.variedad] || '#94a3b8';
  } else {
    const c = TYPE_COLORS[f.type] || TYPE_COLORS.parral;
    stroke = c.stroke; fill = c.fill;
  }
  return {
    color: stroke, weight: selected ? 3 : 1.5,
    fillColor: fill, fillOpacity: selected ? 0.65 : (f.type === 'finca' ? 0.02 : 0.3),
    dashArray: f.type === 'finca' ? '7,4' : undefined,
  };
}

function updateLegend() {
  const title = document.getElementById('legend-title');
  const items = document.getElementById('legend-items');
  if (colorMode === 'type') {
    title.textContent = 'Tipo';
    const types = [{ k:'parral',label:'Parral'},{ k:'potrero',label:'Potrero'},{ k:'pasero',label:'Pasero'},{ k:'cabezal',label:'Cabezal'}];
    items.innerHTML = types.map(t => '<div class="legend-item"><div class="legend-dot" style="background:'+TYPE_COLORS[t.k].fill+'"></div><span class="legend-label">'+t.label+'</span></div>').join('');
  } else {
    title.textContent = 'Variedad';
    const vars = [{k:'flame',label:'Flame'},{k:'red_globe',label:'Red Globe'},{k:'fiesta',label:'Fiesta'},{k:'bonarda',label:'Bonarda'},{k:'sultanina',label:'Sultanina'},{k:'syrah',label:'Syrah/Asp.'}];
    items.innerHTML = vars.map(v => '<div class="legend-item"><div class="legend-dot" style="background:'+(VAR_COLORS[v.k]||'#94a3b8')+'"></div><span class="legend-label">'+v.label+'</span></div>').join('');
  }
}

function updateStyles() {
  Object.entries(polyMap).forEach(([name, poly]) => {
    const f = FEATURES.find(f => f.name === name);
    if (f) poly.setStyle(getStyle(f, name === selectedName));
  });
}

function toggleMode() {
  colorMode = colorMode === 'type' ? 'variedad' : 'type';
  document.getElementById('mode-btn').innerHTML = colorMode === 'type' ? '&#9632; Por tipo' : '&#9632; Por variedad';
  updateStyles(); updateLegend();
}

FEATURES.forEach(f => {
  if (f.geometry === 'line') {
    L.polyline(f.coords, { color: '#c47e2a', weight: 1.5, opacity: 0.6, interactive: false }).addTo(map);
    return;
  }
  if (f.type === 'finca') {
    L.polygon(f.coords, { color: '#15803d', weight: 2.5, fill: false, dashArray: '8,5', interactive: false }).addTo(map);
    return;
  }
  const poly = L.polygon(f.coords, getStyle(f, false));
  poly.bindTooltip(f.name, { direction: 'center', opacity: 0.9, permanent: false });
  poly.on('click', () => {
    const p = PARCELAS.find(p => p.nombre === f.name);
    if (!p) return;
    if (selectedName === f.name) {
      selectedName = null; updateStyles();
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'close' }));
    } else {
      selectedName = f.name; updateStyles();
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'select', parcela: p }));
    }
  });
  polyMap[f.name] = poly;
  poly.addTo(map);
});

updateLegend();
setTimeout(() => map.invalidateSize(), 200);
</script>
</body>
</html>`
}

// ─── Native parcel panel ──────────────────────────────────────────────────────

function ParcelPanelView({ panel, onClose }: { panel: ParcelPanel; onClose: () => void }) {
  const p = panel.parcela
  const estado = panel.estado?.estado_fenologico
  const estadoColor = estado ? (ESTADO_COLORS[estado] ?? '#94a3b8') : null
  const estadoLabel = estado ? (ESTADO_LABELS[estado] ?? estado) : null

  return (
    <View style={panelStyles.container}>
      <View style={panelStyles.handle} />
      <View style={panelStyles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={panelStyles.name}>{p.nombre}</Text>
          <Text style={panelStyles.sub}>
            {p.tipo.charAt(0).toUpperCase() + p.tipo.slice(1)}
            {p.variedad ? ` · ${p.variedad.replace('_', ' ')}` : ''}
          </Text>
        </View>
        <TouchableOpacity style={panelStyles.closeBtn} onPress={onClose}>
          <Ionicons name="close" size={16} color="#374151" />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14 }}>
        {/* Stats grid */}
        <View style={panelStyles.statsRow}>
          {p.superficie_ha != null && (
            <View style={panelStyles.statCard}>
              <Text style={panelStyles.statLabel}>SUPERFICIE</Text>
              <Text style={panelStyles.statValue}>{p.superficie_ha.toFixed(2)} ha</Text>
            </View>
          )}
          {p.cabezal_riego != null && (
            <View style={panelStyles.statCard}>
              <Text style={panelStyles.statLabel}>CABEZAL</Text>
              <Text style={panelStyles.statValue}>{p.cabezal_riego}</Text>
            </View>
          )}
          {panel.mmTotal !== null && (
            <View style={[panelStyles.statCard, { borderColor: '#bfdbfe' }]}>
              <Text style={panelStyles.statLabel}>MM · CAMPAÑA</Text>
              <Text style={[panelStyles.statValue, { color: '#1d4ed8' }]}>
                {panel.mmTotal.toFixed(1)} mm
              </Text>
            </View>
          )}
        </View>

        {/* Estado fenológico */}
        {estadoLabel && estadoColor && (
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>ESTADO FENOLÓGICO</Text>
            <View style={[panelStyles.estadoBadge, { backgroundColor: `${estadoColor}18`, borderColor: `${estadoColor}40` }]}>
              <View style={[panelStyles.estadoDot, { backgroundColor: estadoColor }]} />
              <Text style={[panelStyles.estadoLabel, { color: estadoColor }]}>{estadoLabel}</Text>
              {panel.estado?.fecha_estado && (
                <Text style={panelStyles.estadoFecha}>
                  {panel.estado.fecha_estado.split('-').reverse().join('/')}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Últimas tareas */}
        {panel.tareas.length > 0 && (
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>TAREAS RECIENTES</Text>
            {panel.tareas.slice(0, 5).map((t) => (
              <View key={`${t.tarea}-${t.fecha}`} style={panelStyles.tareaRow}>
                <Text style={panelStyles.tareaName} numberOfLines={1}>{t.tarea}</Text>
                <Text style={panelStyles.tareaFecha}>{t.fecha.split('-').reverse().join('/')}</Text>
              </View>
            ))}
          </View>
        )}

        {panel.loadingExtra && (
          <ActivityIndicator color="#16a34a" style={{ marginTop: 8 }} />
        )}

        {!panel.loadingExtra && !estadoLabel && panel.tareas.length === 0 && panel.mmTotal === 0 && (
          <Text style={panelStyles.emptyText}>Sin registros en la campaña actual</Text>
        )}
      </ScrollView>
    </View>
  )
}

const panelStyles = StyleSheet.create({
  container: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: 380, shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 12,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#d1d5db', alignSelf: 'center', marginTop: 10 },
  headerRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#f0f2f5',
  },
  name: { fontSize: 16, fontWeight: '800', color: '#111827' },
  sub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  closeBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#f3f4f6',
    justifyContent: 'center', alignItems: 'center',
  },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statCard: {
    flex: 1, backgroundColor: '#f9fafb', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#e8eaed',
  },
  statLabel: { fontSize: 9, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  statValue: { fontSize: 15, fontWeight: '800', color: '#111827' },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 10, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  estadoBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
  },
  estadoDot: { width: 10, height: 10, borderRadius: 5 },
  estadoLabel: { fontSize: 14, fontWeight: '700', flex: 1 },
  estadoFecha: { fontSize: 11, color: '#9ca3af' },
  tareaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  tareaName: { fontSize: 13, color: '#374151', fontWeight: '500', flex: 1, marginRight: 8 },
  tareaFecha: { fontSize: 12, color: '#9ca3af' },
  emptyText: { fontSize: 13, color: '#9ca3af', textAlign: 'center', paddingVertical: 8 },
})

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MapaScreen() {
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [estados, setEstados] = useState<EstadoActual[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [panel, setPanel] = useState<ParcelPanel | null>(null)
  const webviewRef = useRef<InstanceType<typeof WebView>>(null)

  const loadData = useCallback(async () => {
    try {
      const [parcelasRes, estadosRes] = await Promise.all([
        api.get<Parcela[]>('/parcelas/mapa'),
        api.get<EstadoActual[]>('/produccion/campana/estado-actual/'),
      ])
      setParcelas(parcelasRes.data.filter((p) => p.is_active))
      setEstados(estadosRes.data)
    } catch { /* offline */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  async function fetchPanelExtras(parcelaId: string): Promise<{ mmTotal: number; tareas: { tarea: string; fecha: string }[] }> {
    const now = new Date()
    const year = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
    const desde = `${year}-05-01`
    const today = now.toISOString().split('T')[0]
    try {
      const [riegosRes, tareasRes] = await Promise.all([
        api.get<{ mm_aplicados: number | null }[]>('/produccion/riego/', {
          params: { parcela_id: parcelaId, fecha_desde: desde, fecha_hasta: today, limit: 200 },
        }),
        api.get<{ tarea: string; fecha: string }[]>('/produccion/trabajo/', {
          params: { parcela_id: parcelaId, fecha_desde: desde, fecha_hasta: today, limit: 200 },
        }),
      ])
      const mmTotal = riegosRes.data.reduce((s, r) => s + (Number(r.mm_aplicados) || 0), 0)
      // Deduplicate: last date per task type
      const tareaMap = new Map<string, string>()
      for (const t of tareasRes.data) {
        if (!tareaMap.has(t.tarea) || t.fecha > tareaMap.get(t.tarea)!) tareaMap.set(t.tarea, t.fecha)
      }
      const tareas = Array.from(tareaMap.entries()).map(([tarea, fecha]) => ({ tarea, fecha }))
        .sort((a, b) => b.fecha.localeCompare(a.fecha))
      return { mmTotal, tareas }
    } catch {
      return { mmTotal: 0, tareas: [] }
    }
  }

  async function handleParcelSelect(parcela: Parcela) {
    const estado = estados.find((e) => e.parcela_id === parcela.id) ?? null
    setPanel({ parcela, estado, mmTotal: null, tareas: [], loadingExtra: true })
    const { mmTotal, tareas } = await fetchPanelExtras(parcela.id)
    setPanel((prev) => prev ? { ...prev, mmTotal, tareas, loadingExtra: false } : null)
  }

  function handleMessage(event: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(event.nativeEvent.data)
      if (msg.type === 'select') {
        const parcela = parcelas.find((p) => p.id === msg.parcela.id)
        if (parcela) handleParcelSelect(parcela)
      } else if (msg.type === 'close') {
        setPanel(null)
      }
    } catch { /* ignore */ }
  }

  function refresh() {
    setLoading(true)
    setPanel(null)
    loadData().then(() => setRefreshKey((k) => k + 1))
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#16a34a" />
        <Text style={styles.loadingText}>Cargando mapa...</Text>
      </View>
    )
  }

  const html = buildMapHTML(parcelas)

  return (
    <View style={styles.container}>
      <WebView
        key={refreshKey}
        ref={webviewRef}
        source={{ html, baseUrl: '' }}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        bounces={false}
        startInLoadingState
        onMessage={handleMessage}
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#16a34a" />
          </View>
        )}
      />

      {panel && (
        <ParcelPanelView
          panel={panel}
          onClose={() => {
            setPanel(null)
            webviewRef.current?.injectJavaScript('selectedName = null; updateStyles(); true;')
          }}
        />
      )}

      <TouchableOpacity
        style={[styles.refreshBtn, panel && { bottom: 400 }]}
        onPress={refresh}
      >
        <Ionicons name="refresh-outline" size={18} color="#374151" />
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  webview: { flex: 1 },
  loadingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f4f6f8', gap: 12,
  },
  loadingText: { fontSize: 14, color: '#6b7280', fontWeight: '500' },
  refreshBtn: {
    position: 'absolute', bottom: 20, right: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 6, elevation: 4,
  },
})
