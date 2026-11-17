import type { ProductoAlfalfa } from '@/lib/api/alfalfa'

export const PRODUCTOS: ProductoAlfalfa[] = ['fardo', 'rollo', 'semilla']

export const NUM_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
export const fmtNum = (n: number) => NUM_FMT.format(n)
export const fmtFecha = (iso: string) => iso.split('-').reverse().join('/')

export const inputCls =
  'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
export const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'
export const btnPrimary =
  'px-4 py-2 bg-[#7a1f2c] text-white rounded-lg text-sm font-semibold hover:bg-[#5a1320] disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
export const btnSecondary =
  'px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors'

export type LineasInput = Record<ProductoAlfalfa, string>
export const LINEAS_VACIAS: LineasInput = { fardo: '', rollo: '', semilla: '' }

/** Fardo/rollo: whole units. Semilla: kg with up to 2 decimals. Returns null when invalid or zero. */
export function parseCantidad(producto: ProductoAlfalfa, raw: string): number | null {
  const v = raw.trim().replace(',', '.')
  if (v === '') return null
  const re = producto === 'semilla' ? /^\d+(\.\d{1,2})?$/ : /^\d+$/
  if (!re.test(v)) return null
  const n = Number(v)
  return n > 0 ? n : null
}

/** True when the field has text but it is not a valid positive quantity. */
export const cantidadInvalida = (producto: ProductoAlfalfa, raw: string) =>
  raw.trim() !== '' && parseCantidad(producto, raw) === null

/** Whether an axios error carries an HTTP response (definite server answer) vs. a network failure. */
export const huboRespuesta = (e: unknown): boolean =>
  !!(e as { response?: unknown })?.response
