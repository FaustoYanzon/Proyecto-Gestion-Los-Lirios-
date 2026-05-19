import api from '@/lib/api'
import type { IngresoResponse } from './ingresos'
import type { EgresoResponse } from './egresos'
import { TIPO_EGRESO_VALUES, TIPO_EGRESO_LABELS } from './egresos'

export const MONTHS_SHORT = [
  'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC', 'ENE', 'FEB', 'MAR', 'ABR',
] as const

function campaignIdx(fecha: string, anioInicio: number): number {
  const [y, m] = fecha.split('-').map(Number)
  if (y === anioInicio && m >= 5) return m - 5      // May=0 ... Dec=7
  if (y === anioInicio + 1 && m <= 4) return m + 7  // Jan=8 ... Apr=11
  return -1
}

function cumulative(arr: number[]): number[] {
  return arr.reduce<number[]>((acc, v) => {
    acc.push((acc.at(-1) ?? 0) + v)
    return acc
  }, [])
}

export interface FlujoRow {
  label: string
  valores: number[]
  total: number
}

export interface FlujoAnualData {
  campana: string
  ingresoPorCliente: FlujoRow[]
  totalIngreso: number[]
  acumuladoIngreso: number[]
  egresoPorTipo: FlujoRow[]
  totalEgreso: number[]
  acumuladoEgreso: number[]
  saldoMensual: number[]
  saldoAcumulado: number[]
}

export async function getFlujoAnual(anioInicio: number): Promise<FlujoAnualData> {
  const fechaDesde = `${anioInicio}-05-01`
  const fechaHasta = `${anioInicio + 1}-04-30`

  const [{ data: ingresos }, { data: egresos }] = await Promise.all([
    api.get<IngresoResponse[]>('/finanzas/ingresos/', {
      params: { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, limit: 1000 },
    }),
    api.get<EgresoResponse[]>('/finanzas/egresos/', {
      params: { fecha_desde: fechaDesde, fecha_hasta: fechaHasta, limit: 1000 },
    }),
  ])

  // Ingresos grouped by cliente (ARS only)
  const clienteMap = new Map<string, number[]>()
  for (const ing of ingresos) {
    if (ing.moneda !== 'ars') continue
    const key = ing.cliente.toUpperCase()
    if (!clienteMap.has(key)) clienteMap.set(key, Array(12).fill(0))
    const idx = campaignIdx(ing.fecha, anioInicio)
    if (idx >= 0) clienteMap.get(key)![idx] += Number(ing.monto)
  }

  const ingresoPorCliente: FlujoRow[] = Array.from(clienteMap.entries())
    .map(([label, valores]) => ({ label, valores, total: valores.reduce((s, v) => s + v, 0) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)

  // Egresos grouped by tipo (ARS only)
  const tipoMap = new Map<string, number[]>()
  for (const eg of egresos) {
    if (eg.moneda !== 'ars') continue
    if (!tipoMap.has(eg.tipo)) tipoMap.set(eg.tipo, Array(12).fill(0))
    const idx = campaignIdx(eg.fecha, anioInicio)
    if (idx >= 0) tipoMap.get(eg.tipo)![idx] += Number(eg.monto)
  }

  const egresoPorTipo: FlujoRow[] = TIPO_EGRESO_VALUES
    .filter((t) => tipoMap.has(t))
    .map((t) => {
      const valores = tipoMap.get(t)!
      return { label: TIPO_EGRESO_LABELS[t], valores, total: valores.reduce((s, v) => s + v, 0) }
    })

  // Totals
  const totalIngreso: number[] = Array(12).fill(0)
  ingresoPorCliente.forEach((r) => r.valores.forEach((v, i) => { totalIngreso[i] += v }))

  const totalEgreso: number[] = Array(12).fill(0)
  egresoPorTipo.forEach((r) => r.valores.forEach((v, i) => { totalEgreso[i] += v }))

  const saldoMensual = totalIngreso.map((v, i) => v - totalEgreso[i])

  return {
    campana: `${anioInicio}/${anioInicio + 1}`,
    ingresoPorCliente,
    totalIngreso,
    acumuladoIngreso: cumulative(totalIngreso),
    egresoPorTipo,
    totalEgreso,
    acumuladoEgreso: cumulative(totalEgreso),
    saldoMensual,
    saldoAcumulado: cumulative(saldoMensual),
  }
}

// ── Backend endpoint for dashboard charts ────────────────────────────────────

export interface FlujoMesBackend {
  mes: string
  ingresos_ars: number
  egresos_ars: number
  saldo_ars: number
  ingresos_usd: number
  egresos_usd: number
  saldo_usd: number
}

export interface FlujoTotalesBackend {
  campana: string
  meses: FlujoMesBackend[]
  total_ingresos_ars: number
  total_egresos_ars: number
  saldo_total_ars: number
  total_ingresos_usd: number
  total_egresos_usd: number
  saldo_total_usd: number
}

export async function getFlujoMensual(anioInicio: number): Promise<FlujoTotalesBackend> {
  const { data } = await api.get<FlujoTotalesBackend>('/finanzas/flujo-anual/', {
    params: { anio_inicio: anioInicio, anio_fin: anioInicio + 1 },
  })
  return data
}
