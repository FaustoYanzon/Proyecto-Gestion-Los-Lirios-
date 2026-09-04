// Contenido de la landing institucional (Fase 4 de Trazabilidad).
// TODO Fausto: reemplazar los textos y las fotos por el material real.
// La geometría del mapa se genera aparte (scripts/build-finca-map.mjs).

export interface VariedadDef {
  key: string
  label: string
  rubro: 'Uva de mesa' | 'Uva para vino' | 'Forraje'
  /** nombre de la CSS var definida en globals.css bajo .landing */
  cssVar: string
}

// El orden acá manda el orden de la leyenda del mapa.
export const VARIEDADES: VariedadDef[] = [
  { key: 'flame', label: 'Flame Seedless', rubro: 'Uva de mesa', cssVar: '--v-flame' },
  { key: 'red_globe', label: 'Red Globe', rubro: 'Uva de mesa', cssVar: '--v-red_globe' },
  { key: 'fiesta', label: 'Fiesta', rubro: 'Uva de mesa', cssVar: '--v-fiesta' },
  { key: 'sultanina', label: 'Sultanina', rubro: 'Uva de mesa', cssVar: '--v-sultanina' },
  { key: 'syrah', label: 'Syrah', rubro: 'Uva para vino', cssVar: '--v-syrah' },
  { key: 'bonarda', label: 'Bonarda', rubro: 'Uva para vino', cssVar: '--v-bonarda' },
  { key: 'aspirant', label: 'Aspirant Bouschet', rubro: 'Uva para vino', cssVar: '--v-aspirant' },
]

export const VARIEDAD_BY_KEY: Record<string, VariedadDef> = Object.fromEntries(
  VARIEDADES.map((v) => [v.key, v]),
)

export const LANDING = {
  empresa: {
    nombre: 'Los Lirios',
    razonSocial: 'Los Lirios SA',
    // TODO: confirmar provincia/localidad exacta a mostrar públicamente.
    ubicacion: 'San Juan, Argentina',
    desde: '1991',
  },

  hero: {
    // Una sola idea, grande.
    titulo: 'Uva con nombre\ny procedencia',
    bajada:
      'Finca familiar en el oeste argentino. Cada cosecha queda registrada ' +
      'cuadro por cuadro y se puede verificar.',
    foto: { src: '/finca/atardecer.jpg', w: 1280, h: 960, alt: 'Atardecer sobre los cuadros de la finca, con las sierras en el horizonte' },
  },

  nosotros: {
    titulo: 'Una finca que se\nadministra como se debe',
    parrafos: [
      // TODO: historia real (fundación, familia, superficie total, fincas).
      'Trabajamos la vid desde hace más de tres décadas en el oeste argentino: ' +
        'uva de mesa para el mercado interno y la exportación, y uva de vinificación ' +
        'para bodegas de la región.',
      'Cada tarea de campo (el riego, el manejo sanitario, las labores culturales y ' +
        'la cosecha) se carga en un sistema de gestión a nivel de cada cuadro. Eso ' +
        'nos deja responder, con datos, por el origen y el manejo de cada lote que sale.',
    ],
    foto: { src: '/finca/racimo.jpg', w: 589, h: 1049, alt: 'Racimo secándose en la planta, a contraluz' },
  },

  mapa: {
    kicker: 'Parcelario',
    titulo: 'Dónde está\ncada variedad',
    intro:
      'Diecinueve cuadros de parral, agrupados por lo que producen. Pasá el cursor ' +
      'o tocá un cuadro para ver la variedad y la superficie.',
  },

  trazabilidad: {
    titulo: 'La trazabilidad\nse verifica, no se promete',
    parrafos: [
      'Cada envío puede llevar un código QR que abre la trazabilidad completa del ' +
        'cuadro de origen para el período de esa cosecha: riego aplicado, manejo ' +
        'fitosanitario con sus períodos de carencia, registros de cosecha y análisis de calidad.',
      'El enlace consulta los datos en vivo sobre nuestros registros y no pide usuario ' +
        'ni contraseña. Si recibiste una caja o un pallet con nuestro código, escaneá el QR.',
    ],
    urlEjemplo: 'losliriossa.com/trazabilidad/publica/…',
    foto: { src: '/finca/hilera.jpg', w: 589, h: 1050, alt: 'Hilera de parral con el interfilar empastado' },
  },

  contacto: {
    email: 'administracion@losliriossa.com',
    domicilio: 'Juez Ramón Díaz (S) 473, San Juan',
    // telefono: '+54 ...',
  },
} as const
