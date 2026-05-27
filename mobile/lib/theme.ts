// mobile/lib/theme.ts
// Espejo de frontend/lib/theme.ts para React Native.
// Mantener sincronizado a mano (no hay tooling de tokens compartido todavía).

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

export const parcelaColors = {
  parral:  colors.burdeos[600],
  potrero: colors.verdeCampo,
  pasero:  colors.tierra,
  cabezal: colors.cielo,
} as const;

export type TipoParcela = keyof typeof parcelaColors;

export const parcelaLabels: Record<TipoParcela, string> = {
  parral:  'Parrales',
  potrero: 'Potreros',
  pasero:  'Paseros',
  cabezal: 'Cabezales',
};

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  gerencial:   'Gerencial',
  encargado:   'Encargado',
  regador:     'Regador',
  obrero:      'Obrero',
} as const;

export type Role = keyof typeof ROLE_LABELS;

// ============================================================
// Spacing, radius, sizing — usados con StyleSheet de RN.
// ============================================================
export const space = {
  s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s8: 32, s12: 48,
} as const;

export const radius = {
  sm: 6, md: 10, lg: 14, pill: 999,
} as const;

// Mobile: tap targets más grandes que la web.
export const tapTarget = {
  primary: 56,   // botón principal de carga
  default: 48,   // botón normal
  icon:    44,   // botones de ícono pequeños
} as const;

// ============================================================
// Tipografía. Cargar fonts con expo-font + useFonts en _layout.tsx.
// ============================================================
export const fonts = {
  sans:    'PublicSans_400Regular',
  sansBold:'PublicSans_700Bold',
  display: 'Fraunces_600SemiBold',
  mono:    'JetBrainsMono_500Medium',
} as const;

export const text = {
  display:   { fontFamily: fonts.display,  fontSize: 32, lineHeight: 38 },
  h1:        { fontFamily: fonts.sansBold, fontSize: 24, lineHeight: 30 },
  h2:        { fontFamily: fonts.sansBold, fontSize: 20, lineHeight: 26 },
  h3:        { fontFamily: fonts.sansBold, fontSize: 17, lineHeight: 22 },
  body:      { fontFamily: fonts.sans,     fontSize: 15, lineHeight: 22 },
  small:     { fontFamily: fonts.sans,     fontSize: 13, lineHeight: 18 },
  micro:     { fontFamily: fonts.sansBold, fontSize: 11, lineHeight: 14, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  mono:      { fontFamily: fonts.mono,     fontSize: 14, lineHeight: 18 },
  monoLarge: { fontFamily: fonts.mono,     fontSize: 18, lineHeight: 22 },
} as const;

// ============================================================
// Coordenadas de las fincas. Reemplazar por las reales.
// ============================================================
export const FINCA_COORDS = {
  los_mimbres: { lat: -31.45, lng: -68.55, label: 'Los Mimbres' },
  media_agua:  { lat: -31.97, lng: -68.42, label: 'Media Agua' },
  caucete:     { lat: -31.65, lng: -68.28, label: 'Caucete' },
} as const;

// ============================================================
// Helpers
// ============================================================
export function getInitials(fullName?: string | null): string {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

export function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n);
}

export function formatUSD(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2,
  }).format(n);
}
