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
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import api from '../../lib/api'
import type { Parcela, FaseVariedad } from '../../lib/types'
import { GEO_LAYERS, type GeoLayerData } from '../../lib/geoLayers'

// Único polígono que no es una fila de `parcelas` (es el contorno de toda la
// finca) — extraído una vez del KML real (frontend/public/Los Lirios 2026.kml,
// placemark "Finca"). Prácticamente no cambia, a diferencia de los parrales.
const FINCA_OUTLINE: [number, number][] = [
  [-32.02103353983581, -68.39024972191801],
  [-32.02112802929084, -68.40075245858213],
  [-32.03636257095692, -68.40782074280381],
  [-32.03914072169965, -68.38977272146781],
  [-32.02103353983581, -68.39024972191801],
]

// Paleta unificada con frontend/components/map/FincaMapInner.tsx (TYPE_STYLES).
const TYPE_COLORS: Record<string, { stroke: string; fill: string }> = {
  parral:  { stroke: '#5a1320', fill: '#7a1f2c' },
  potrero: { stroke: '#2d4a28', fill: '#3f5c3a' },
  pasero:  { stroke: '#6b4420', fill: '#8a5a2b' },
  cabezal: { stroke: '#2d5468', fill: '#3d6b86' },
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
// Unificado con FincaMapInner.tsx ESTADO_COLORS — antes estaban invertidos.
const ESTADO_COLORS: Record<string, string> = {
  brotacion: '#eab308', floracion: '#ec4899', cuaje: '#f97316',
  envero: '#a855f7', madurez: '#22c55e', cosecha: '#ef4444', latencia: '#6b7280',
}

// ── Cosecha / Riego (modos de color nuevos, mismos endpoints que el mapa web) ──

interface CosechaResumenPorParcela {
  parcela_id: string | null
  kg_total: number
}

interface EficienciaHidricaParcela {
  parcela_id: string
  porcentaje_cumplimiento: number | null
}

// Mismo gradiente que cosechaColor() en FincaMapInner.tsx.
function cosechaColor(kg: number, maxKg: number): string {
  if (kg <= 0 || maxKg <= 0) return '#f3f4f6'
  const t = Math.min(1, kg / maxKg)
  const from = [220, 252, 231]
  const to = [21, 128, 61]
  const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * t))
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
}

// Mismo semáforo que riegoColor() en FincaMapInner.tsx.
function riegoColor(pct: number | null): string {
  if (pct == null) return '#f3f4f6'
  if (pct < 50) return '#dc2626'
  if (pct < 85) return '#f59e0b'
  if (pct <= 115) return '#16a34a'
  return '#3d6b86'
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
  fenologia: FaseVariedad | null
  mmTotal: number | null
  riegoCount: number | null
  tareas: { tarea: string; fecha: string }[]
  fitos: { id: string; fecha: string; producto_nombre: string; dosis_lt_ha: number }[]
  loadingExtra: boolean
}

function buildMapHTML(
  parcelas: Parcela[], layers: GeoLayerData, fenologia: FaseVariedad[],
  cosecha: CosechaResumenPorParcela[], riego: EficienciaHidricaParcela[],
): string {
  // Los polígonos de cada parcela vienen de la API (parcelas.coordenadas, ya
  // poblada desde el KML real) — ya no de un snapshot hardcodeado. El único
  // polígono que no es una parcela (el contorno de la finca) se dibuja aparte
  // desde FINCA_OUTLINE.
  const featuresJSON = JSON.stringify(
    parcelas
      .filter((p) => Array.isArray(p.coordenadas) && p.coordenadas.length > 0)
      .map((p) => ({ name: p.nombre, type: p.tipo, coords: p.coordenadas }))
  )
  const fincaOutlineJSON = JSON.stringify(FINCA_OUTLINE)
  const parcelasJSON = JSON.stringify(
    parcelas.map((p) => ({
      id: p.id, nombre: p.nombre, tipo: p.tipo,
      variedad: p.variedad, superficie_ha: p.superficie_ha, cabezal_riego: p.cabezal_riego,
    }))
  )
  const typeColorsJSON = JSON.stringify(TYPE_COLORS)
  const varColorsJSON = JSON.stringify(VAR_COLORS)
  const estadoColorsJSON = JSON.stringify(ESTADO_COLORS)
  const estadoLabelsJSON = JSON.stringify(ESTADO_LABELS)
  // Keyed by variedad for O(1) lookup inside the WebView JS.
  const fenologiaJSON = JSON.stringify(
    Object.fromEntries(fenologia.map((f) => [f.variedad, f]))
  )
  // Keyed by parcela_id, mismo criterio que el mapa web.
  const cosechaByParcelaId = Object.fromEntries(
    cosecha.filter((c) => c.parcela_id).map((c) => [c.parcela_id as string, c.kg_total])
  )
  const maxKg = Math.max(0, ...Object.values(cosechaByParcelaId))
  const cosechaJSON = JSON.stringify(cosechaByParcelaId)
  const riegoByParcelaId = Object.fromEntries(
    riego.map((r) => [r.parcela_id, r.porcentaje_cumplimiento])
  )
  const riegoJSON = JSON.stringify(riegoByParcelaId)

  // Serialize each layer; null-safe (empty FeatureCollection → no features rendered)
  const acequiasJSON = JSON.stringify(layers.acequias)
  const lineaElectricaJSON = JSON.stringify(layers.lineaElectrica)
  const caneriasJSON = JSON.stringify(layers.canerias)
  const valvulasJSON = JSON.stringify(layers.valvulas)
  const cuadrantesRiegoJSON = JSON.stringify(layers.cuadrantesRiego)

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

/* ── Mode button ──────────────────────────────── */
#mode-btn {
  position:absolute; top:10px; left:10px; z-index:1000;
  background:#fff; border:1px solid #d1d5db; border-radius:8px;
  padding:7px 12px; font-size:12px; font-weight:700;
  color:#374151; cursor:pointer; display:flex; align-items:center; gap:5px;
  box-shadow:0 1px 4px rgba(0,0,0,0.12);
}

/* ── Layer control ────────────────────────────── */
#layer-btn-wrap {
  position:absolute; top:10px; right:10px; z-index:1000;
}
#layer-toggle-btn {
  background:#fff; border:1px solid #d1d5db; border-radius:8px;
  padding:7px 12px; font-size:12px; font-weight:700; color:#374151;
  cursor:pointer; display:flex; align-items:center; gap:6px;
  box-shadow:0 1px 4px rgba(0,0,0,0.12); white-space:nowrap;
}
#layer-panel {
  display:none; position:absolute; top:calc(100% + 6px); right:0;
  background:#fff; border:1px solid #e5e7eb; border-radius:10px;
  padding:10px 12px; box-shadow:0 2px 8px rgba(0,0,0,0.15);
  min-width:164px;
}
.lp-title {
  font-size:10px; font-weight:700; color:#6b7280;
  text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;
}
.lp-row {
  display:flex; align-items:center; gap:7px;
  margin-bottom:7px; cursor:pointer;
}
.lp-row:last-child { margin-bottom:0; }
.lp-row input[type=checkbox] {
  width:14px; height:14px; accent-color:#16a34a; cursor:pointer; flex-shrink:0;
}
.lp-line { width:18px; height:3px; border-radius:2px; flex-shrink:0; }
.lp-dot  { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
.lp-poly { width:12px; height:12px; border-radius:2px; border:1px solid #6b7280; flex-shrink:0; }
.lp-lbl  { font-size:12px; color:#374151; }

/* ── Legend ───────────────────────────────────── */
#legend {
  position:absolute; bottom:20px; left:10px; z-index:1000;
  background:rgba(255,255,255,0.96); border:1px solid #e5e7eb;
  border-radius:10px; padding:10px 12px;
  box-shadow:0 2px 8px rgba(0,0,0,0.12); min-width:110px;
}
.legend-title { font-size:10px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:7px; }
.legend-item  { display:flex; align-items:center; gap:7px; margin-bottom:5px; }
.legend-dot   { width:12px; height:12px; border-radius:3px; flex-shrink:0; }
.legend-label { font-size:12px; color:#374151; }
.legend-sep   { border-top:1px solid #e5e7eb; margin:6px 0 5px; }
.legend-item-sm { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
</style>
</head>
<body>
<div id="map"></div>

<!-- Mode button -->
<button id="mode-btn" onclick="toggleMode()">&#9632; Por tipo</button>

<!-- Layer control -->
<div id="layer-btn-wrap">
  <button id="layer-toggle-btn" onclick="toggleLayerPanel()">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="12 2 2 7 12 12 22 7"/>
      <polyline points="2 17 12 22 22 17"/>
      <polyline points="2 12 12 17 22 12"/>
    </svg>
    Capas
  </button>
  <div id="layer-panel">
    <div class="lp-title">Infraestructura</div>
    <label class="lp-row"><input type="checkbox" id="cb-acequias" onchange="toggleLayer('acequias')"><span class="lp-line" style="background:#38bdf8"></span><span class="lp-lbl">Acequias</span></label>
    <label class="lp-row"><input type="checkbox" id="cb-lineaElectrica" onchange="toggleLayer('lineaElectrica')"><span class="lp-line" style="background:#facc15"></span><span class="lp-lbl">Línea eléctrica</span></label>
    <label class="lp-row"><input type="checkbox" id="cb-canerias" checked onchange="toggleLayer('canerias')"><span class="lp-line" style="background:#1e3a8a"></span><span class="lp-lbl">Cañerías</span></label>
    <label class="lp-row"><input type="checkbox" id="cb-valvulas" onchange="toggleLayer('valvulas')"><span class="lp-dot" style="background:#1e3a8a"></span><span class="lp-lbl">Válvulas</span></label>
    <label class="lp-row"><input type="checkbox" id="cb-cuadrantesRiego" onchange="toggleLayer('cuadrantesRiego')"><span class="lp-poly" style="background:#d1d5db"></span><span class="lp-lbl">Cuadrantes</span></label>
  </div>
</div>

<!-- Legend -->
<div id="legend">
  <div class="legend-title" id="legend-title">Tipo</div>
  <div id="legend-items"></div>
  <div class="legend-sep"></div>
  <div class="legend-item-sm"><div style="width:16px;height:3px;border-radius:2px;background:#38bdf8;flex-shrink:0"></div><span class="legend-label">Acequias</span></div>
  <div class="legend-item-sm"><div style="width:16px;height:3px;border-radius:2px;background:#facc15;flex-shrink:0"></div><span class="legend-label">L. eléctrica</span></div>
  <div class="legend-item-sm"><div style="width:16px;height:3px;border-radius:2px;background:#1e3a8a;flex-shrink:0"></div><span class="legend-label">Cañerías</span></div>
  <div class="legend-item-sm"><div style="width:10px;height:10px;border-radius:50%;background:#1e3a8a;flex-shrink:0"></div><span class="legend-label">Válvulas</span></div>
  <div class="legend-item-sm"><div style="width:12px;height:12px;border-radius:2px;border:1px solid #6b7280;background:#d1d5db;flex-shrink:0"></div><span class="legend-label">Cuadrantes</span></div>
</div>

<script>
const FEATURES = ${featuresJSON};
const FINCA_OUTLINE = ${fincaOutlineJSON};
const PARCELAS = ${parcelasJSON};
const TYPE_COLORS = ${typeColorsJSON};
const VAR_COLORS = ${varColorsJSON};
const ESTADO_COLORS = ${estadoColorsJSON};
const ESTADO_LABELS = ${estadoLabelsJSON};
const FENOLOGIA = ${fenologiaJSON}; // keyed by variedad
const COSECHA_BY_PARCELA = ${cosechaJSON}; // keyed by parcela_id -> kg_total
const MAX_KG = ${maxKg};
const RIEGO_BY_PARCELA = ${riegoJSON}; // keyed by parcela_id -> porcentaje_cumplimiento

// Infrastructure GeoJSON data
const GEO_DATA = {
  acequias:        ${acequiasJSON},
  lineaElectrica:  ${lineaElectricaJSON},
  canerias:        ${caneriasJSON},
  valvulas:        ${valvulasJSON},
  cuadrantesRiego: ${cuadrantesRiegoJSON},
};

let colorMode = 'type';
let selectedName = null;
const polyMap = {};
const layerGroups = {};

const map = L.map('map', { center: [-32.027, -68.397], zoom: 15, attributionControl: false });
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20 }).addTo(map);

// ── KML parcelas ────────────────────────────────────────────────────────────
function getStyle(f, selected) {
  const p = PARCELAS.find(p => p.nombre === f.name);
  let stroke, fill;
  if (colorMode === 'cosecha') {
    const kg = (p && COSECHA_BY_PARCELA[p.id]) || 0;
    stroke = '#166534'; fill = cosechaColor(kg, MAX_KG);
  } else if (colorMode === 'riego') {
    const pct = p ? RIEGO_BY_PARCELA[p.id] : null;
    stroke = '#2d5468'; fill = riegoColor(pct == null ? null : pct);
  } else if (colorMode === 'fenologia' && f.type === 'parral' && p && p.variedad && FENOLOGIA[p.variedad]) {
    const estado = FENOLOGIA[p.variedad].estado_fenologico;
    stroke = fill = ESTADO_COLORS[estado] || '#94a3b8';
  } else if (colorMode === 'variedad' && f.type === 'parral' && p && p.variedad) {
    stroke = fill = VAR_COLORS[p.variedad] || '#94a3b8';
  } else {
    const c = TYPE_COLORS[f.type] || TYPE_COLORS.parral;
    stroke = c.stroke; fill = c.fill;
  }
  return {
    color: stroke, weight: selected ? 3 : 1.5,
    fillColor: fill,
    fillOpacity: selected ? 0.65 : 0.3,
  };
}

// Mismo gradiente que cosechaColor() del lado React (y de FincaMapInner.tsx web).
function cosechaColor(kg, maxKg) {
  if (kg <= 0 || maxKg <= 0) return '#f3f4f6';
  const t = Math.min(1, kg / maxKg);
  const from = [220, 252, 231], to = [21, 128, 61];
  const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
}

// Mismo semáforo que riegoColor() del lado React (y de FincaMapInner.tsx web).
function riegoColor(pct) {
  if (pct == null) return '#f3f4f6';
  if (pct < 50) return '#dc2626';
  if (pct < 85) return '#f59e0b';
  if (pct <= 115) return '#16a34a';
  return '#3d6b86';
}

function updateLegend() {
  const title = document.getElementById('legend-title');
  const items = document.getElementById('legend-items');
  if (colorMode === 'type') {
    title.textContent = 'Tipo';
    const types = [{ k:'parral',label:'Parral'},{ k:'potrero',label:'Potrero'},{ k:'pasero',label:'Pasero'},{ k:'cabezal',label:'Cabezal'}];
    items.innerHTML = types.map(t => '<div class="legend-item"><div class="legend-dot" style="background:'+TYPE_COLORS[t.k].fill+'"></div><span class="legend-label">'+t.label+'</span></div>').join('');
  } else if (colorMode === 'variedad') {
    title.textContent = 'Variedad';
    const vars = [{k:'flame',label:'Flame'},{k:'red_globe',label:'Red Globe'},{k:'fiesta',label:'Fiesta'},{k:'bonarda',label:'Bonarda'},{k:'sultanina',label:'Sultanina'},{k:'syrah',label:'Syrah/Asp.'}];
    items.innerHTML = vars.map(v => '<div class="legend-item"><div class="legend-dot" style="background:'+(VAR_COLORS[v.k]||'#94a3b8')+'"></div><span class="legend-label">'+v.label+'</span></div>').join('');
  } else if (colorMode === 'cosecha') {
    title.textContent = 'Cosecha';
    items.innerHTML =
      '<div class="legend-item"><div class="legend-dot" style="background:#f3f4f6;border:1px solid #e5e7eb"></div><span class="legend-label">Sin datos</span></div>' +
      '<div class="legend-item"><div class="legend-dot" style="background:'+cosechaColor(MAX_KG*0.3, MAX_KG)+'"></div><span class="legend-label">Bajo</span></div>' +
      '<div class="legend-item"><div class="legend-dot" style="background:'+cosechaColor(MAX_KG, MAX_KG)+'"></div><span class="legend-label">Alto</span></div>';
  } else if (colorMode === 'riego') {
    title.textContent = 'Riego';
    const niveles = [{c:'#dc2626',label:'Déficit severo'},{c:'#f59e0b',label:'Déficit'},{c:'#16a34a',label:'En objetivo'},{c:'#3d6b86',label:'Posible exceso'}];
    items.innerHTML = niveles.map(n => '<div class="legend-item"><div class="legend-dot" style="background:'+n.c+'"></div><span class="legend-label">'+n.label+'</span></div>').join('');
  } else {
    title.textContent = 'Fenología';
    const estados = ['brotacion','floracion','cuaje','envero','madurez','cosecha','latencia'];
    items.innerHTML = estados.map(e => '<div class="legend-item"><div class="legend-dot" style="background:'+(ESTADO_COLORS[e]||'#94a3b8')+'"></div><span class="legend-label">'+(ESTADO_LABELS[e]||e)+'</span></div>').join('');
  }
}

function updateStyles() {
  Object.entries(polyMap).forEach(([name, poly]) => {
    const f = FEATURES.find(f => f.name === name);
    if (f) poly.setStyle(getStyle(f, name === selectedName));
  });
}

const MODE_LABELS = {
  type: '&#9632; Por tipo', variedad: '&#9632; Por variedad',
  cosecha: '&#9632; Cosecha', riego: '&#9632; Riego', fenologia: '&#9632; Fenología',
};
const MODE_ORDER = ['type', 'variedad', 'cosecha', 'riego', 'fenologia'];

function toggleMode() {
  colorMode = MODE_ORDER[(MODE_ORDER.indexOf(colorMode) + 1) % MODE_ORDER.length];
  document.getElementById('mode-btn').innerHTML = MODE_LABELS[colorMode];
  updateStyles(); updateLegend();
}

L.polygon(FINCA_OUTLINE, { color: '#2d4a28', weight: 2.5, fill: false, dashArray: '6,4', interactive: false }).addTo(map);

FEATURES.forEach(f => {
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

// ── Coordinate normalisation ────────────────────────────────────────────────
// GeoJSON spec: [lng, lat]. Some tools export [lat, lng] by mistake.
// For Los Lirios (Mendoza): lat ≈ -32, lng ≈ -68.
// If first coordinate value > -60 it is latitude-first → swap everything.
function swapCoordsArr(c) {
  if (!Array.isArray(c)) return c;
  if (c.length >= 2 && typeof c[0] === 'number') return [c[1], c[0]].concat(c.slice(2));
  return c.map(swapCoordsArr);
}

function normalizeGeoJSON(data) {
  if (!data || !Array.isArray(data.features) || !data.features.length) return data;
  var geom = data.features[0] && data.features[0].geometry;
  var sample = null;
  if (geom) {
    if (geom.type === 'Point') sample = geom.coordinates;
    else if (geom.type === 'LineString') sample = geom.coordinates[0];
    else if (geom.type === 'Polygon') sample = geom.coordinates[0] && geom.coordinates[0][0];
    else if (geom.type === 'MultiLineString') sample = geom.coordinates[0] && geom.coordinates[0][0];
  }
  if (!sample || sample[0] < -60) return data; // already lng-first
  var cloned = JSON.parse(JSON.stringify(data));
  cloned.features.forEach(function(f) {
    f.geometry.coordinates = swapCoordsArr(f.geometry.coordinates);
  });
  return cloned;
}

// ── Infrastructure layers ───────────────────────────────────────────────────
function hasFeatures(data) {
  return data && Array.isArray(data.features) && data.features.length > 0;
}

function makePopupHandler(label) {
  return function(feature, layer) {
    var props = feature && feature.properties;
    if (!props) return;
    var entries = Object.keys(props).filter(function(k) {
      return props[k] != null && props[k] !== '';
    });
    if (!entries.length) return;
    var rows = entries.map(function(k) {
      return '<div style="margin:0 0 2px"><span style="color:#9ca3af;text-transform:capitalize">' +
        k.replace(/_/g, ' ') + ':</span> ' + props[k] + '</div>';
    }).join('');
    layer.bindPopup(
      '<div style="font-family:-apple-system,sans-serif;font-size:12px;color:#4b5563">' +
      '<p style="font-size:12px;font-weight:700;color:#111827;margin:0 0 5px;padding-bottom:4px;border-bottom:1px solid #f0f0f0">' +
      label + '</p>' + rows + '</div>',
      { maxWidth: 240 }
    );
  };
}

function initExtraLayers() {
  var cfgs = [
    { key: 'acequias',        type: 'line',  color: '#38bdf8', label: 'Acequia'         },
    { key: 'lineaElectrica',  type: 'line',  color: '#facc15', label: 'Línea eléctrica' },
    { key: 'canerias',        type: 'line',  color: '#1e3a8a', label: 'Cañería'         },
    { key: 'valvulas',        type: 'point', color: '#1e3a8a', label: 'Válvula'         },
    { key: 'cuadrantesRiego', type: 'poly',  color: '#d1d5db', label: null              },
  ];

  cfgs.forEach(function(cfg) {
    var raw = GEO_DATA[cfg.key];
    if (!hasFeatures(raw)) return;
    var data = normalizeGeoJSON(raw);

    var geoLayer;
    if (cfg.type === 'point') {
      geoLayer = L.geoJSON(data, {
        pointToLayer: function(feature, latlng) {
          return L.circleMarker(latlng, {
            radius: 5, color: cfg.color, fillColor: cfg.color,
            fillOpacity: 1, weight: 1.5,
          });
        },
        onEachFeature: cfg.label ? makePopupHandler(cfg.label) : null,
      });
    } else if (cfg.type === 'poly') {
      geoLayer = L.geoJSON(data, {
        style: function() {
          return { color: cfg.color, fillColor: cfg.color, fillOpacity: 0.15, weight: 1.5 };
        },
        interactive: false,
      });
    } else {
      geoLayer = L.geoJSON(data, {
        style: function() { return { color: cfg.color, weight: 2, opacity: 0.85 }; },
        onEachFeature: cfg.label ? makePopupHandler(cfg.label) : null,
      });
    }

    var group = L.layerGroup([geoLayer]);
    layerGroups[cfg.key] = group;
    // Layers are off by default; user enables them via panel — except
    // "canerias", which starts visible (reemplaza las líneas viejas
    // hardcodeadas que se dibujaban siempre antes de este fix).
    if (cfg.key === 'canerias') group.addTo(map);
  });
}

// ── Layer panel toggle ──────────────────────────────────────────────────────
function toggleLayerPanel() {
  var panel = document.getElementById('layer-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function toggleLayer(key) {
  var group = layerGroups[key];
  if (!group) return;
  var cb = document.getElementById('cb-' + key);
  if (cb && cb.checked) {
    if (!map.hasLayer(group)) group.addTo(map);
  } else {
    if (map.hasLayer(group)) map.removeLayer(group);
  }
}

// ── Init ────────────────────────────────────────────────────────────────────
updateLegend();
initExtraLayers();
setTimeout(function() { map.invalidateSize(); }, 200);
</script>
</body>
</html>`
}

// ─── Native parcel panel ──────────────────────────────────────────────────────

function ParcelPanelView({ panel, onClose }: { panel: ParcelPanel; onClose: () => void }) {
  const router = useRouter()
  const p = panel.parcela
  // Prefer the automatic/override fenología engine (per-variedad) when available;
  // fall back to the raw manual per-parral estado for parcelas without a variedad match.
  const estado = panel.fenologia?.estado_fenologico ?? panel.estado?.estado_fenologico
  const estadoColor = estado ? (ESTADO_COLORS[estado] ?? '#94a3b8') : null
  const estadoLabel = panel.fenologia?.fase_label ?? (estado ? (ESTADO_LABELS[estado] ?? estado) : null)

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
        </View>

        {/* Ciclo de Campaña */}
        {estadoLabel && estadoColor && (
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>CICLO DE CAMPAÑA</Text>
            <View style={[panelStyles.estadoBadge, { backgroundColor: `${estadoColor}18`, borderColor: `${estadoColor}40` }]}>
              <View style={[panelStyles.estadoDot, { backgroundColor: estadoColor }]} />
              <Text style={[panelStyles.estadoLabel, { color: estadoColor }]}>{estadoLabel}</Text>
              {(panel.fenologia?.fecha_confirmacion ?? panel.estado?.fecha_estado) && (
                <Text style={panelStyles.estadoFecha}>
                  {(panel.fenologia?.fecha_confirmacion ?? panel.estado?.fecha_estado ?? '').split('-').reverse().join('/')}
                </Text>
              )}
            </View>
            {panel.fenologia && (
              <>
                <Text style={panelStyles.fuenteTag}>
                  {panel.fenologia.fuente === 'manual' ? '✎ Confirmado a mano' : '✦ Estimado automático'}
                </Text>
                {panel.fenologia.proxima_fase_label && (
                  <Text style={panelStyles.proximaFase}>
                    Próxima: {panel.fenologia.proxima_fase_label}
                    {panel.fenologia.proxima_fase_fecha
                      ? ` · ${panel.fenologia.proxima_fase_fecha.split('-').reverse().join('/')}`
                      : ''}
                  </Text>
                )}
                {panel.fenologia.tareas_recomendadas.slice(0, 3).map((t, i) => (
                  <Text key={i} style={panelStyles.tareaSugerida} numberOfLines={1}>• {t}</Text>
                ))}
              </>
            )}
          </View>
        )}

        {/* Riego */}
        {!panel.loadingExtra && (
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>RIEGO — CAMPAÑA</Text>
            {panel.mmTotal === null ? (
              <Text style={panelStyles.emptyText}>Sin datos</Text>
            ) : (
              <View style={panelStyles.riegoRow}>
                <Text style={panelStyles.mmValue}>{panel.mmTotal.toFixed(1)} mm</Text>
                {panel.riegoCount != null && (
                  <Text style={panelStyles.riegoSub}>
                    {panel.riegoCount} riego{panel.riegoCount !== 1 ? 's' : ''}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* Aplicaciones Fito */}
        {!panel.loadingExtra && (
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>APLICACIONES FITO</Text>
            {panel.fitos.length === 0 ? (
              <Text style={panelStyles.emptyText}>Sin aplicaciones</Text>
            ) : (
              panel.fitos.map((f) => (
                <View key={f.id} style={panelStyles.tareaRow}>
                  <Text style={panelStyles.tareaName} numberOfLines={1}>
                    {f.producto_nombre} · {f.dosis_lt_ha} L/ha
                  </Text>
                  <Text style={panelStyles.tareaFecha}>{f.fecha.split('-').reverse().join('/')}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {/* Tareas recientes */}
        {!panel.loadingExtra && (
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>TAREAS RECIENTES</Text>
            {panel.tareas.length === 0 ? (
              <Text style={panelStyles.emptyText}>Sin tareas</Text>
            ) : (
              panel.tareas.slice(0, 5).map((t) => (
                <View key={`${t.tarea}-${t.fecha}`} style={panelStyles.tareaRow}>
                  <Text style={panelStyles.tareaName} numberOfLines={1}>{t.tarea}</Text>
                  <Text style={panelStyles.tareaFecha}>{t.fecha.split('-').reverse().join('/')}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {panel.loadingExtra && (
          <ActivityIndicator color="#16a34a" style={{ marginTop: 8 }} />
        )}
      </ScrollView>

      {/* ── Quick actions ── */}
      <View style={panelStyles.actionsBar}>
        {([
          { key: 'riego', label: '+ Riego', route: '/(tabs)/riego'  },
          { key: 'tarea', label: '+ Tarea', route: '/(tabs)/tareas' },
          { key: 'fito',  label: '+ Fito',  route: '/fito'          },
        ] as const).map(({ key, label, route }) => (
          <TouchableOpacity
            key={key}
            style={panelStyles.actionBtn}
            onPress={() => { onClose(); router.push(route) }}
            activeOpacity={0.75}
          >
            <Text style={panelStyles.actionBtnText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

const panelStyles = StyleSheet.create({
  container: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: 460, shadowColor: '#000',
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
  fuenteTag: { fontSize: 10, color: '#9ca3af', marginTop: 6, fontWeight: '600' },
  proximaFase: { fontSize: 12, color: '#6b7280', marginTop: 6 },
  tareaSugerida: { fontSize: 12, color: '#374151', marginTop: 4 },
  tareaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  tareaName: { fontSize: 13, color: '#374151', fontWeight: '500', flex: 1, marginRight: 8 },
  tareaFecha: { fontSize: 12, color: '#9ca3af' },
  emptyText: { fontSize: 13, color: '#9ca3af', fontStyle: 'italic' },
  riegoRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  mmValue: { fontSize: 18, fontWeight: '800', color: '#1d4ed8' },
  riegoSub: { fontSize: 12, color: '#9ca3af' },
  actionsBar: {
    flexDirection: 'row', gap: 8, padding: 12,
    borderTopWidth: 1, borderTopColor: '#f0f2f5',
  },
  actionBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#f0f2f5', backgroundColor: '#fff',
    alignItems: 'center',
  },
  actionBtnText: { fontSize: 12, fontWeight: '700', color: '#7a1f2c' },
})

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MapaScreen() {
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [estados, setEstados] = useState<EstadoActual[]>([])
  const [fenologia, setFenologia] = useState<FaseVariedad[]>([])
  const [cosecha, setCosecha] = useState<CosechaResumenPorParcela[]>([])
  const [riego, setRiego] = useState<EficienciaHidricaParcela[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [panel, setPanel] = useState<ParcelPanel | null>(null)
  const webviewRef = useRef<InstanceType<typeof WebView>>(null)

  const loadData = useCallback(async () => {
    const now = new Date()
    const anio = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
    try {
      const [parcelasRes, estadosRes, fenologiaRes, cosechaRes, riegoRes] = await Promise.all([
        api.get<Parcela[]>('/parcelas/mapa'),
        api.get<EstadoActual[]>('/produccion/campana/estado-actual/'),
        api.get<FaseVariedad[]>('/produccion/fenologia/estado-actual'),
        api.get<CosechaResumenPorParcela[]>('/produccion/cosecha/resumen/por-parcela', { params: { temporada: anio } }),
        api.get<EficienciaHidricaParcela[]>('/produccion/dashboard/eficiencia-hidrica', { params: { anio } }),
      ])
      setParcelas(parcelasRes.data.filter((p) => p.is_active))
      setEstados(estadosRes.data)
      setFenologia(fenologiaRes.data)
      setCosecha(cosechaRes.data)
      setRiego(riegoRes.data)
    } catch { /* offline */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  async function fetchPanelExtras(parcelaId: string): Promise<{
    mmTotal: number; riegoCount: number;
    tareas: { tarea: string; fecha: string }[];
    fitos: { id: string; fecha: string; producto_nombre: string; dosis_lt_ha: number }[];
  }> {
    const now = new Date()
    const year = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
    const desde = `${year}-05-01`
    const today = now.toISOString().split('T')[0]
    try {
      const [riegosRes, tareasRes, fitosRes] = await Promise.all([
        api.get<{ mm_aplicados: number | null }[]>('/produccion/riego/', {
          params: { parcela_id: parcelaId, fecha_desde: desde, fecha_hasta: today, limit: 200 },
        }),
        api.get<{ tarea: string; fecha: string }[]>('/produccion/trabajo/', {
          params: { parcela_id: parcelaId, fecha_desde: desde, fecha_hasta: today, limit: 200 },
        }),
        api.get<{ id: string; fecha: string; producto_nombre: string; dosis_lt_ha: number }[]>('/produccion/fitosanitarios/', {
          params: { parcela_id: parcelaId, fecha_desde: desde, fecha_hasta: today, limit: 100 },
        }),
      ])
      const mmTotal = riegosRes.data.reduce((s, r) => s + (Number(r.mm_aplicados) || 0), 0)
      const riegoCount = riegosRes.data.length
      const tareaMap = new Map<string, string>()
      for (const t of tareasRes.data) {
        if (!tareaMap.has(t.tarea) || t.fecha > tareaMap.get(t.tarea)!) tareaMap.set(t.tarea, t.fecha)
      }
      const tareas = Array.from(tareaMap.entries()).map(([tarea, fecha]) => ({ tarea, fecha }))
        .sort((a, b) => b.fecha.localeCompare(a.fecha))
      const fitos = [...fitosRes.data].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 5)
      return { mmTotal, riegoCount, tareas, fitos }
    } catch {
      return { mmTotal: 0, riegoCount: 0, tareas: [], fitos: [] }
    }
  }

  async function handleParcelSelect(parcela: Parcela) {
    const estado = estados.find((e) => e.parcela_id === parcela.id) ?? null
    const fase = parcela.variedad
      ? fenologia.find((f) => f.variedad === parcela.variedad) ?? null
      : null
    setPanel({ parcela, estado, fenologia: fase, mmTotal: null, riegoCount: null, tareas: [], fitos: [], loadingExtra: true })
    const { mmTotal, riegoCount, tareas, fitos } = await fetchPanelExtras(parcela.id)
    setPanel((prev) => prev ? { ...prev, mmTotal, riegoCount, tareas, fitos, loadingExtra: false } : null)
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

  const html = buildMapHTML(parcelas, GEO_LAYERS, fenologia, cosecha, riego)

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
        style={[styles.refreshBtn, panel && { bottom: 480 }]}
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
