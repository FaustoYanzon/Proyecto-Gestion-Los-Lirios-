// Vocabulario de íconos de Los Lirios.
// UNA familia en las dos plataformas: Lucide. Antes mobile usaba Ionicons y web
// lucide-react, con grosores y metáforas distintas para el mismo concepto.
//
// Regla: si un concepto ya está acá, se usa este ícono y ningún otro. Si falta,
// se agrega EN LOS DOS archivos con la misma clave — nunca se importa suelto.
//
// Los siete de navegación son los que frontend/lib/navigation.ts ya declara en
// ALL_NAV: se adoptan tal cual, no se reemplazan.

import {
  LayoutDashboard, Map, Sprout, DollarSign, BookOpen, Settings, LogOut, ClipboardList, Droplet, FlaskConical, ShoppingBasket, Grape, Wheat, Bell, User, Search, Layers, BarChart3, AlertTriangle, Sun, Gauge,
} from 'lucide-react'

export const ICONS = {
  // Navegación — ya en navigation.ts
  inicio:          LayoutDashboard,
  mapa:            Map,
  produccion:      Sprout,
  finanzas:        DollarSign,
  documentacion:   BookOpen,
  admin:           Settings,
  salir:           LogOut,
  tarea:           ClipboardList,
  riego:           Droplet,
  fitosanitario:   FlaskConical,
  cosecha:         ShoppingBasket,
  campana:         Grape,
  parcela:         Wheat,
  notificacion:    Bell,
  usuario:         User,
  buscar:          Search,
  capas:           Layers,
  dashboard:       BarChart3,
  alerta:          AlertTriangle,
  clima:           Sun,
  termografo:      Gauge,
} as const

// Cinco tamaños, un solo grosor. Sin esta escala cada componente elige lo suyo
// y el conjunto se ve desprolijo.
export const ICON_SIZE = {
  inline:  16,  // dentro de texto, celdas de tabla
  control: 18,  // botones, chips, inputs
  tab:     20,  // tab bar de mobile, ítems de lista
  nav:     22,  // sidebar web, headers
  section: 24,  // encabezados de sección, estados vacíos
} as const

// 1.75 en todo. A 24px bajar a 1.5 para que no se engrose de más.
export const ICON_STROKE = 1.75
export const ICON_STROKE_LARGE = 1.5

export type IconKey = keyof typeof ICONS
