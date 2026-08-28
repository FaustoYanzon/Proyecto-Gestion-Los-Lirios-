// Vocabulario de íconos de Los Lirios.
// UNA familia en las dos plataformas: Lucide. Antes mobile usaba Ionicons y web
// lucide-react, con grosores y metáforas distintas para el mismo concepto.
//
// Regla: si un concepto ya está acá, se usa este ícono y ningún otro. Si falta,
// se agrega EN LOS DOS archivos con la misma clave — nunca se importa suelto.
//
// Los siete de navegación son los que frontend/lib/navigation.ts ya declara en
// ALL_NAV: se adoptan tal cual, no se reemplazan.
//
// Requiere: npx expo install lucide-react-native react-native-svg

import {
  LayoutDashboard, Map, Sprout, DollarSign, BookOpen, Settings, LogOut, ClipboardList, Droplet, FlaskConical, ShoppingBasket, Grape, Wheat, Bell, User, Search, Layers, BarChart3, AlertTriangle, Sun, Gauge,
  X, Check, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Calendar, Plus, Minus, Trash2, CheckCircle2, Leaf, Pencil, Fingerprint, AlertCircle, XCircle, MapPin, Camera, AtSign, Mail, ShieldCheck, Lock, Eye, EyeOff, Gift, CloudUpload, Clock, Play, RefreshCw, Wind, Zap, CloudOff, Cloud, CloudSun, CloudRain, CloudSnow, CloudLightning, SquareCheck, Square,
} from 'lucide-react-native'

export const ICONS = {
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

  // Acciones e íconos de interfaz — agregados en la Fase 2 al migrar mobile
  // desde Ionicons. Cada clave nueva reemplaza uno o más nombres de Ionicons
  // (ver el mapeo en el commit de la fase); mismo criterio: un concepto, una
  // clave, nunca un ícono suelto en el componente.
  cerrar:          X,             // close
  check:           Check,         // checkmark
  atras:           ChevronLeft,   // chevron-back
  avance:          ChevronRight,  // chevron-forward
  desplegar:       ChevronDown,   // chevron-down
  plegar:          ChevronUp,     // chevron-up
  fecha:           Calendar,      // calendar-outline
  agregar:         Plus,          // add, add-circle-outline
  quitar:          Minus,         // remove
  eliminar:        Trash2,        // trash-outline
  completado:      CheckCircle2,  // checkmark-circle(-outline)
  hoja:            Leaf,          // leaf-outline
  editar:          Pencil,        // create-outline
  huella:          Fingerprint,   // finger-print-outline
  aviso:           AlertCircle,   // alert-circle(-outline) — círculo, distinto de "alerta" (triángulo)
  cancelar:        XCircle,       // close-circle
  ubicacion:       MapPin,        // location, location-outline
  camara:          Camera,        // camera
  arroba:          AtSign,        // at-outline
  correo:          Mail,          // mail-outline
  escudo:          ShieldCheck,   // shield-checkmark-outline
  candado:         Lock,          // lock-closed-outline
  ver:             Eye,           // eye-outline
  ocultar:         EyeOff,        // eye-off-outline
  regalo:          Gift,          // gift-outline
  subir:           CloudUpload,   // cloud-upload-outline
  hora:            Clock,         // time, time-outline
  iniciar:         Play,          // play, play-circle-outline
  refrescar:       RefreshCw,     // refresh-outline
  viento:          Wind,          // speedometer-outline (viento del clima)
  humedad:         Droplet,       // water-outline (humedad del clima — mismo ícono que "riego")
  uv:              Zap,           // flash-outline (índice UV)
  desconectado:    CloudOff,      // cloud-offline-outline
  nublado:         Cloud,         // cloudy-outline, cloud-outline, niebla
  nubesol:         CloudSun,      // partly-sunny-outline
  lluvia:          CloudRain,     // rainy-outline
  nieve:           CloudSnow,     // snow-outline
  tormenta:        CloudLightning,// thunderstorm-outline
  casillamarcada:  SquareCheck,   // checkbox (recordarme)
  casilla:         Square,        // square-outline (recordarme)
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
