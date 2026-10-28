export const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

// Decimal fields may arrive as strings; always format through Number().
export function formatNum(value: number | string, maxDecimals = 3): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '–'
  return n.toLocaleString('es-AR', { maximumFractionDigits: maxDecimals })
}
