// Contenido de la landing institucional (Fase 4 de Trazabilidad).
// TODO Fausto: reemplazar los textos y la lista de fotos por el material real.
// Todo lo editable vive acá; app/page.tsx solo lo maqueta.

export interface LandingContent {
  empresa: {
    nombre: string
    tagline: string
    ubicacion: string
    descripcionCorta: string
  }
  nosotros: {
    titulo: string
    parrafos: string[]
  }
  produccion: {
    titulo: string
    intro: string
    grupos: { rubro: string; variedades: string[] }[]
  }
  trazabilidad: {
    titulo: string
    parrafos: string[]
  }
  contacto: {
    email: string
    domicilio: string
    telefono?: string
  }
}

export const LANDING: LandingContent = {
  empresa: {
    nombre: 'Los Lirios SA',
    tagline: 'Producción de uva de mesa y vino en el oeste argentino',
    // TODO: confirmar provincia/localidad exacta a mostrar públicamente.
    ubicacion: 'San Juan, Argentina',
    descripcionCorta:
      'Empresa familiar dedicada a la producción vitícola, con manejo agronómico ' +
      'registrado parcela por parcela y trazabilidad verificable de cada cosecha.',
  },
  nosotros: {
    titulo: 'Quiénes somos',
    parrafos: [
      // TODO: historia real de la finca (fundación, familia, superficie, fincas).
      'Los Lirios SA es una empresa familiar con varias décadas de trabajo en la ' +
        'viticultura del oeste argentino. Producimos uva de mesa para el mercado ' +
        'interno y la exportación, y uva para vinificación destinada a bodegas de la región.',
      'Trabajamos nuestras fincas con un sistema de gestión que registra cada tarea ' +
        'agronómica —riego, manejo sanitario, labores culturales y cosecha— a nivel de ' +
        'parcela, lo que nos permite responder por el origen y el manejo de cada lote.',
    ],
  },
  produccion: {
    titulo: 'Qué producimos',
    intro:
      'Nuestras parcelas combinan variedades de mesa y de vinificación, más lotes de ' +
      'forraje para la rotación y el manejo del suelo.',
    grupos: [
      { rubro: 'Uva de mesa', variedades: ['Flame Seedless', 'Red Globe', 'Fiesta', 'Sultanina'] },
      { rubro: 'Uva para vino', variedades: ['Bonarda', 'Syrah', 'Aspirant Bouschet'] },
      { rubro: 'Forraje', variedades: ['Alfalfa'] },
    ],
  },
  trazabilidad: {
    titulo: 'Trazabilidad verificable',
    parrafos: [
      'Cada envío de Los Lirios SA puede incluir un código QR que abre la trazabilidad ' +
        'completa de la parcela de origen para el período de esa cosecha: riego aplicado, ' +
        'manejo fitosanitario con sus períodos de carencia, registros de cosecha y análisis ' +
        'de calidad.',
      'Si recibiste una caja o un pallet con nuestro código, escaneá el QR o abrí el enlace ' +
        'que figura en la carta de trazabilidad. La información se consulta en vivo sobre ' +
        'nuestros registros; el enlace no requiere usuario ni contraseña.',
    ],
  },
  contacto: {
    email: 'administracion@losliriossa.com',
    domicilio: 'Juez Ramón Díaz (S) 473, San Juan',
    // telefono: '+54 ...',
  },
}
