// frontend/lib/theme.ts
// Los Lirios — design tokens exportados para TypeScript.
// El CSS los tiene en globals.css; esto los expone a componentes
// (charts de recharts, mapas de leaflet, lógica que necesita el color como string).

export const colors = {
  burdeos: {
    700: '#5a1320',
    600: '#7a1f2c', // primary
    500: '#9a3140',
    200: '#e6c8cd',
  },
  ink:      '#1f1a17',
  ink60:    '#5a544c',
  niebla:   '#a09584',
  blanco:   '#ffffff',
  hueso:    '#fbfaf6',
  crema:    '#faf6ec',
  oro:      '#c89a3a',
  verdeCampo: '#3f5c3a',
  tierra:   '#8a5a2b',
  cielo:    '#3d6b86',
  sangre:   '#a3293a',
} as const;

// Color por tipo de parcela (reemplaza el TIPO_COLORS actual).
export const parcelaColors = {
  parral:  colors.burdeos[600],
  potrero: colors.verdeCampo,
  pasero:  colors.tierra,
  cabezal: colors.cielo,
} as const;

export type TipoParcela = keyof typeof parcelaColors;

// Etiquetas legibles (mantener en español).
export const parcelaLabels: Record<TipoParcela, string> = {
  parral:  'Parrales',
  potrero: 'Potreros',
  pasero:  'Paseros',
  cabezal: 'Cabezales',
};

// Estados de campaña / fenología — colores aproximados, refinar con el agrónomo.
export const fenologiaColors: Record<string, string> = {
  reposo:           colors.ink60,
  lloro:            colors.cielo,
  brotacion:        colors.verdeCampo,
  hojas_extendidas: '#5a8755',
  floracion:        '#a6c97b',
  cuaje:            colors.oro,
  envero:           '#b9663f',
  maduracion:       colors.burdeos[500],
  cosecha:          colors.burdeos[700],
  post_cosecha:     colors.tierra,
};

// Roles → permisos (mantener sincronizado con backend/app/api/deps.py).
export const ROLE_RANK = {
  super_admin: 5,
  gerencial:   4,
  encargado:   3,
  regador:     2,
  obrero:      1,
} as const;

export type Role = keyof typeof ROLE_RANK;

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  gerencial:   'Gerencial',
  encargado:   'Encargado',
  regador:     'Regador',
  obrero:      'Obrero',
};

// ¿El usuario puede ver Finanzas? — sólo super_admin + gerencial.
export function canSeeFinanzas(role: Role): boolean {
  return role === 'super_admin' || role === 'gerencial';
}

// ¿El usuario puede ver Admin? — sólo super_admin + gerencial.
export function canSeeAdmin(role: Role): boolean {
  return role === 'super_admin' || role === 'gerencial';
}

// Coordenadas de las 3 fincas — usadas por el widget de clima.
// Reemplazar con las coordenadas reales (Fausto).
export const FINCA_COORDS: Record<string, { lat: number; lng: number; label: string }> = {
  los_mimbres: { lat: -31.45, lng: -68.55, label: 'Los Mimbres' },
  media_agua:  { lat: -31.97, lng: -68.42, label: 'Media Agua' },
  caucete:     { lat: -31.65, lng: -68.28, label: 'Caucete' },
};

// Helper de formato de monto en ARS.
export function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n);
}

// Helper de formato en USD.
export function formatUSD(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(n);
}

// Helper de fecha corta en es-AR.
export function formatDateShort(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')) : d;
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}
