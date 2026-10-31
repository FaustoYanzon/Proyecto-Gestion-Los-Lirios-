// Pure helpers for the "Aplicadas" tab: carencia per parcel and the
// orden -> parcela -> valvula grouping of fitosanitario records. No React or
// network here so they can be checked in isolation.
import type { FitosanitarioResponse } from '@/lib/api/fitosanitarios'
import type { OrdenAplicacion, OrdenAplicacionValvula } from '@/lib/api/ordenesAplicacion'

const MS_DIA = 86_400_000

// Local calendar date (YYYY-MM-DD). `toISOString()` is UTC, which rolls over to
// "tomorrow" after 21:00 in Argentina and would shift every carencia by a day.
export function hoyLocalISO(now: Date = new Date()): string {
  const mes = String(now.getMonth() + 1).padStart(2, '0')
  const dia = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mes}-${dia}`
}

function utcDia(fechaISO: string): number {
  const [y, m, d] = fechaISO.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

// Whole calendar days from `desdeISO` to `hastaISO`; negative when already past.
export function diasEntre(desdeISO: string, hastaISO: string): number {
  return Math.round((utcDia(hastaISO) - utcDia(desdeISO)) / MS_DIA)
}

export function formatFecha(fechaISO: string): string {
  const [y, m, d] = fechaISO.split('-')
  return `${d}/${m}/${y}`
}

// ─── Carencia por parcela ────────────────────────────────────────────────────

export interface CarenciaParcela {
  parcelaId: string
  // Farthest fecha_habilitacion_cosecha among the parcel's records.
  hasta: string
  // Whole days left until `hasta` (>= 1 while still in carencia).
  dias: number
  // Records that tie for the farthest date: they are what keeps the parcel closed.
  limitantes: FitosanitarioResponse[]
  // Every record still in carencia, nearest date last, for the detail view.
  vigentes: FitosanitarioResponse[]
}

// A record is in carencia while its habilitation date is strictly after today;
// on that date itself the parcel is already enabled (same rule as the table's
// old "Estado" icon).
export function carenciaPorParcela(
  registros: FitosanitarioResponse[],
  hoy: string,
): Map<string, CarenciaParcela> {
  const vigentesPorParcela = new Map<string, FitosanitarioResponse[]>()
  for (const r of registros) {
    if (r.fecha_habilitacion_cosecha <= hoy) continue
    const lista = vigentesPorParcela.get(r.parcela_id) ?? []
    lista.push(r)
    vigentesPorParcela.set(r.parcela_id, lista)
  }

  const resultado = new Map<string, CarenciaParcela>()
  for (const [parcelaId, lista] of vigentesPorParcela) {
    const vigentes = [...lista].sort((a, b) =>
      b.fecha_habilitacion_cosecha.localeCompare(a.fecha_habilitacion_cosecha),
    )
    const hasta = vigentes[0].fecha_habilitacion_cosecha
    resultado.set(parcelaId, {
      parcelaId,
      hasta,
      dias: diasEntre(hoy, hasta),
      limitantes: vigentes.filter((r) => r.fecha_habilitacion_cosecha === hasta),
      vigentes,
    })
  }
  return resultado
}

// ─── Agrupación orden -> parcela -> válvula ──────────────────────────────────

export interface GrupoValvula {
  clave: string
  // null for records without a valve (whole-parcel confirmation or manual).
  ordenValvulaId: string | null
  nombre: string
  // Display date: latest registro.fecha of the group.
  fecha: string
  responsable: string
  registros: FitosanitarioResponse[]
  // Sort key (epoch ms): confirmation time when the order is known, else the
  // latest created_at of the group's records.
  ultimaMs: number
}

export interface GrupoParcela {
  parcelaId: string
  valvulas: GrupoValvula[]
  ultimaMs: number
}

export interface GrupoOrden {
  clave: string
  // null for the "sin orden" bucket (manual records).
  ordenId: string | null
  // Undefined when the order is not in the loaded campaign.
  orden?: OrdenAplicacion
  parcelas: GrupoParcela[]
  ultimaMs: number
}

const SIN_ORDEN = 'sin-orden'

function ms(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

function maxMs(valores: number[]): number {
  return valores.reduce((a, b) => (b > a ? b : a), 0)
}

function nombreSinValvula(r: FitosanitarioResponse): string {
  if (r.orden_valvula_id) return 'Válvula' // its order is outside the loaded campaign
  return r.orden_id ? 'Parcela completa' : 'Carga manual'
}

// Newest first everywhere: orders, parcels inside an order, valves inside a parcel.
export function agruparRegistros(
  registros: FitosanitarioResponse[],
  ordenes: OrdenAplicacion[],
): GrupoOrden[] {
  const ordenPorId = new Map(ordenes.map((o) => [o.id, o]))
  const valvulaPorId = new Map<string, OrdenAplicacionValvula>()
  for (const o of ordenes) {
    for (const p of o.parcelas) for (const v of p.valvulas ?? []) valvulaPorId.set(v.id, v)
  }

  // orden -> parcela -> valvula key -> records
  const arbol = new Map<string, Map<string, Map<string, FitosanitarioResponse[]>>>()
  for (const r of registros) {
    const ordenKey = r.orden_id ?? SIN_ORDEN
    const porParcela = arbol.get(ordenKey) ?? new Map<string, Map<string, FitosanitarioResponse[]>>()
    const porValvula = porParcela.get(r.parcela_id) ?? new Map<string, FitosanitarioResponse[]>()
    // Valve-born records share orden_valvula_id; whole-parcel and manual ones
    // collapse to a single pseudo-valve per parcel (manual: per day).
    const valvulaKey = r.orden_valvula_id
      ?? (r.orden_id ? 'parcela' : `manual:${r.fecha}`)
    const lista = porValvula.get(valvulaKey) ?? []
    lista.push(r)
    porValvula.set(valvulaKey, lista)
    porParcela.set(r.parcela_id, porValvula)
    arbol.set(ordenKey, porParcela)
  }

  const grupos: GrupoOrden[] = []
  for (const [ordenKey, porParcela] of arbol) {
    const parcelas: GrupoParcela[] = []
    for (const [parcelaId, porValvula] of porParcela) {
      const valvulas: GrupoValvula[] = []
      for (const [valvulaKey, lista] of porValvula) {
        const fila = valvulaKey !== 'parcela' && !valvulaKey.startsWith('manual:')
          ? valvulaPorId.get(valvulaKey)
          : undefined
        const ultimaMs = ms(fila?.confirmada_at) || maxMs(lista.map((r) => ms(r.created_at)))
        valvulas.push({
          clave: `${ordenKey}|${parcelaId}|${valvulaKey}`,
          ordenValvulaId: lista[0].orden_valvula_id,
          nombre: fila ? `Válvula ${fila.valvula_nombre}` : nombreSinValvula(lista[0]),
          fecha: lista.reduce((a, r) => (r.fecha > a ? r.fecha : a), lista[0].fecha),
          responsable: lista[0].responsable,
          registros: [...lista].sort((a, b) => a.producto_nombre.localeCompare(b.producto_nombre)),
          ultimaMs,
        })
      }
      valvulas.sort((a, b) => b.ultimaMs - a.ultimaMs)
      parcelas.push({ parcelaId, valvulas, ultimaMs: maxMs(valvulas.map((v) => v.ultimaMs)) })
    }
    parcelas.sort((a, b) => b.ultimaMs - a.ultimaMs)
    grupos.push({
      clave: ordenKey,
      ordenId: ordenKey === SIN_ORDEN ? null : ordenKey,
      orden: ordenPorId.get(ordenKey),
      parcelas,
      ultimaMs: maxMs(parcelas.map((p) => p.ultimaMs)),
    })
  }

  // Manual records go last no matter how recent they are.
  grupos.sort((a, b) => {
    if (a.ordenId === null) return 1
    if (b.ordenId === null) return -1
    return b.ultimaMs - a.ultimaMs
  })
  return grupos
}
