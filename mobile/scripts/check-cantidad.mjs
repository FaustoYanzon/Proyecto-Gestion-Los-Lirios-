// Self-check for lib/cantidad.ts (the mobile app has no test runner).
// Run: `node mobile/scripts/check-cantidad.mjs` (Node >= 22.18 strips TS types).
// Same cases as backend/tests/test_cantidad_valvula_redondeo.py: keep them in sync.
import { calcularCantidad } from '../lib/cantidad.ts'

const cases = [
  [1.5, '2.3500', '3.52'], // 3.525 -> half-even
  [0.15, '2.3500', '0.35'], // 0.3525
  [2.0, '1.0050', '2.01'], // 2.010
  [1.5, '2.4500', '3.68'], // 3.675 -> half-even
  [1.25, '2.0000', '2.50'],
  [1e-7, '1', '0.00'], // exponent form of String(number)
  [3, 2, '6.00'],
  [1.5, null, null],
  [1.5, '', null],
  [1.5, 'abc', null],
]

let failed = 0
for (const [dosis, sup, expected] of cases) {
  const got = calcularCantidad(dosis, sup)
  const ok = got === expected
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${dosis} x ${JSON.stringify(sup)} -> ${got} (expected ${expected})`)
}
console.log(failed ? `${failed} failed` : `all ${cases.length} passed`)
process.exit(failed ? 1 : 0)
