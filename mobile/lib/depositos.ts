// Stock summary per depósito (insumos, paseros, bodega, alfalfa) and insumo ingreso.
// Backend Decimals arrive as JSON strings: converted to number here, in the API layer.
//
// Writes need connection (no offline queue). The movimientos endpoint has no
// idempotency key: the UI guards double submits, see IngresoInsumoModal.
import api from './api'
import { getStockPasero, getLotesPasa } from './altaProduccion'

const num = (v: unknown): number => Number(v)

export type TipoInsumoDeposito = 'fitosanitario' | 'vario'

export interface InsumoStock {
  id: string
  nombre: string
  unidad: 'kg' | 'lt'
  tipo: string
  stock_actual: number
}

export async function getInsumosStock(tipo: TipoInsumoDeposito): Promise<InsumoStock[]> {
  const { data } = await api.get<Record<string, unknown>[]>('/insumos/', {
    params: { is_active: true, tipo },
  })
  return data
    .map((d) => ({
      id: String(d.id),
      nombre: String(d.nombre),
      unidad: d.unidad as 'kg' | 'lt',
      tipo: String(d.tipo),
      stock_actual: num(d.stock_actual),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

// Column is Numeric(10,2): up to 8 integer digits, 2 decimals, strictly positive.
// Comma is accepted because the iOS decimal-pad of an Argentine locale only offers it;
// it is normalized to a dot before sending (see cantidadInsumoToString).
export function cantidadInsumoValida(texto: string): boolean {
  const t = texto.trim()
  return /^\d{1,8}([.,]\d{1,2})?$/.test(t) && Number(t.replace(',', '.')) > 0
}

export const cantidadInsumoToString = (texto: string): string => texto.trim().replace(',', '.')

export interface MovimientoInsumoPayload {
  tipo: 'ingreso' | 'egreso'
  cantidad: string
  fecha: string
  observacion?: string
  /** Free text (máquina, tractor or parcela); required by the server for egreso. */
  destino?: string
  /** One per attempt: a retry with the same key never applies the movement twice. */
  idempotencyKey: string
}

export async function registrarMovimientoInsumo(insumoId: string, p: MovimientoInsumoPayload): Promise<void> {
  const observacion = p.observacion?.trim()
  const destino = p.destino?.trim()
  await api.post(`/insumos/${insumoId}/movimientos`, {
    tipo: p.tipo,
    cantidad: cantidadInsumoToString(p.cantidad),
    fecha: p.fecha,
    idempotency_key: p.idempotencyKey,
    ...(observacion ? { observacion } : {}),
    ...(p.tipo === 'egreso' && destino ? { destino } : {}),
  })
}

export async function getInsumosPorTipos(tipos: TipoInsumoDeposito[]): Promise<InsumoStock[]> {
  const listas = await Promise.all(tipos.map((t) => getInsumosStock(t)))
  return listas.flat().sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

export interface ResumenBodega {
  kgSaldo: number
  lotes: number
}

// Bodega stock = pasa balance of the lotes that still have saldo (no dedicated endpoint).
export async function getResumenBodega(): Promise<ResumenBodega> {
  const lotes = await getLotesPasa(undefined, true)
  return { kgSaldo: lotes.reduce((acc, l) => acc + l.saldo_kg, 0), lotes: lotes.length }
}

export interface ResumenPasero {
  kgTotal: number
  porVariedad: { variedad: string; kg: number }[]
}

export async function getResumenPaseros(): Promise<ResumenPasero> {
  const items = await getStockPasero()
  const porVariedad = new Map<string, number>()
  for (const it of items) {
    porVariedad.set(it.variedad, (porVariedad.get(it.variedad) ?? 0) + it.uva_disponible_kg)
  }
  return {
    kgTotal: items.reduce((acc, it) => acc + it.uva_disponible_kg, 0),
    porVariedad: [...porVariedad.entries()]
      .map(([variedad, kg]) => ({ variedad, kg }))
      .sort((a, b) => a.variedad.localeCompare(b.variedad, 'es')),
  }
}
