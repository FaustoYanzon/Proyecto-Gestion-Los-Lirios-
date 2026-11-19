// Date helpers shared by the forms. `hoyISO` already lives in lib/altaProduccion.ts.
const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/

// Rejects impossible dates such as 2026-13-45 or 2026-02-30 (Date would roll them over).
export function fechaValida(s: string): boolean {
  if (!FECHA_REGEX.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}
