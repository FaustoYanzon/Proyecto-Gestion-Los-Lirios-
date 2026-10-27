// Exact port of the server's per-line quantity (backend/app/api/ordenes_aplicacion.py,
// `_calcular_cantidad_linea`): Decimal(str(dose)) * Decimal(surface), quantized to
// 0.01 with ROUND_HALF_EVEN. Float math + toLocaleString would round 3.525 up to
// 3.53 while the server stores 3.52, so this works on scaled integers (BigInt).
// Pinned against the backend by backend/tests/test_cantidad_valvula_redondeo.py;
// self-check: `node mobile/scripts/check-cantidad.mjs`.

interface ExactDecimal {
  units: bigint // value = units / 10^scale
  scale: number
}

const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/

// Built from a string instead of BigInt `**`, which is the least portable
// BigInt operator across JS engines.
function pow10(n: number): bigint {
  return BigInt(`1${'0'.repeat(n)}`)
}

// Parses "2.3500", "1.5", "1e-7", "1.5E+3"... JS String(number) and Python
// str(float) both give the shortest round-trip digits (only the exponent
// notation differs), so the parsed value equals Python's Decimal(str(x)).
function parseExact(value: number | string): ExactDecimal | null {
  const text = typeof value === 'number' ? String(value) : value.trim()
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  const m = DECIMAL_RE.exec(text)
  if (!m) return null
  const intPart = m[2] ?? ''
  const fracPart = m[3] ?? ''
  if (intPart === '' && fracPart === '') return null
  const exponent = m[4] ? parseInt(m[4], 10) : 0
  let units = BigInt((intPart + fracPart) || '0')
  if (m[1] === '-') units = -units
  let scale = fracPart.length - exponent
  if (scale < 0) {
    units *= pow10(-scale)
    scale = 0
  }
  return { units, scale }
}

// Quantity in hundredths (integer), rounded half-even like Decimal.quantize.
export function calcularCantidadCentesimos(
  dosis: number | string,
  superficieHa: number | string | null | undefined,
): bigint | null {
  if (superficieHa === null || superficieHa === undefined) return null
  const d = parseExact(dosis)
  const s = parseExact(superficieHa)
  if (!d || !s) return null
  const product = d.units * s.units
  const scale = d.scale + s.scale
  if (scale <= 2) return product * pow10(2 - scale)

  const divisor = pow10(scale - 2)
  const negative = product < BigInt(0)
  const abs = negative ? -product : product
  let q = abs / divisor
  const twiceRemainder = (abs % divisor) * BigInt(2)
  if (twiceRemainder > divisor || (twiceRemainder === divisor && q % BigInt(2) === BigInt(1))) {
    q += BigInt(1)
  }
  return negative ? -q : q
}

// Canonical dot-decimal string with 2 decimals ("3.52"), or null when the
// surface is missing or an input is not a number.
export function calcularCantidad(
  dosis: number | string,
  superficieHa: number | string | null | undefined,
): string | null {
  const c = calcularCantidadCentesimos(dosis, superficieHa)
  if (c === null) return null
  const negative = c < BigInt(0)
  const abs = (negative ? -c : c).toString().padStart(3, '0')
  return `${negative ? '-' : ''}${abs.slice(0, -2)}.${abs.slice(-2)}`
}
