// Verifies that the mobile grouper (mobile/lib/fitosanitariosAgrupar.ts) is a
// faithful port of the web one (frontend/lib/fitosanitariosAgrupar.ts): both
// must return identical trees for the same input, plus a few fixed cases.
//
// Usage (read-only, no network, no .env):
//   node scripts/verificar_agrupador_mobile.mjs [datos.json]
//
// datos.json = { "registros": [...], "ordenes": [...] } as returned by
// GET /produccion/fitosanitarios/ and GET /ordenes-aplicacion/. Without a file
// the built-in synthetic fixtures are used.
//
// The two modules are TypeScript, so the script re-launches itself through
// `npx --yes tsx@4` (fetched on demand; nothing is added to any package.json).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const self = fileURLToPath(import.meta.url)

if (!process.env.VERIFICAR_AGRUPADOR_TSX) {
  const r = spawnSync('npx', ['--yes', 'tsx@4', self, ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, VERIFICAR_AGRUPADOR_TSX: '1' },
  })
  process.exit(r.status ?? 1)
}

const raiz = new URL('../', import.meta.url)
const web = await import(pathToFileURL(fileURLToPath(new URL('frontend/lib/fitosanitariosAgrupar.ts', raiz))).href)
const mobile = await import(pathToFileURL(fileURLToPath(new URL('mobile/lib/fitosanitariosAgrupar.ts', raiz))).href)

// ─── Fixtures ────────────────────────────────────────────────────────────────

function reg(id, o = {}) {
  return {
    id,
    fecha: '2026-10-01',
    parcela_id: 'p1',
    producto_nombre: 'Azufre',
    responsable: 'Juan',
    orden_id: null,
    orden_valvula_id: null,
    fecha_habilitacion_cosecha: '2026-10-10',
    created_at: '2026-10-01T12:00:00Z',
    ...o,
  }
}

function orden(id, valvulas) {
  return {
    id,
    parcelas: [{ id: `op-${id}`, parcela_id: 'p1', valvulas }],
  }
}

const sinteticos = {
  registros: [
    reg('r1', { orden_id: 'o1', orden_valvula_id: 'v1', producto_nombre: 'Zinc', created_at: '2026-10-02T10:00:00Z' }),
    reg('r2', { orden_id: 'o1', orden_valvula_id: 'v1', producto_nombre: 'Azufre', created_at: '2026-10-02T10:00:01Z' }),
    reg('r3', { orden_id: 'o1', orden_valvula_id: 'v2', parcela_id: 'p1', fecha: '2026-10-03', created_at: '2026-10-03T09:00:00Z' }),
    reg('r4', { orden_id: 'o2', parcela_id: 'p2', created_at: '2026-10-05T09:00:00Z' }), // whole parcel
    reg('r5', { orden_id: 'o9', orden_valvula_id: 'v9', parcela_id: 'p3' }), // order outside campaign
    reg('r6', { fecha: '2026-10-20', created_at: '2026-10-20T09:00:00Z' }), // manual, newest
    reg('r7', { fecha: '2026-10-20', producto_nombre: 'Cobre', created_at: '2026-10-20T09:00:01Z' }),
    reg('r8', { fecha: '2026-09-01', fecha_habilitacion_cosecha: '2026-09-15' }),
  ],
  ordenes: [
    orden('o1', [
      { id: 'v1', valvula_nombre: '1', confirmada_at: '2026-10-02T11:00:00Z' },
      { id: 'v2', valvula_nombre: '2', confirmada_at: '2026-10-03T11:00:00Z' },
    ]),
    { id: 'o2', parcelas: [{ id: 'op-o2', parcela_id: 'p2' }] }, // valvulas undefined
  ],
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Maps -> plain objects so deepEqual compares structure, not identity.
const plano = (x) => JSON.parse(JSON.stringify(x, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v)))

let casos = 0
function check(nombre, fn) {
  fn()
  casos++
  console.log(`ok  ${nombre}`)
}

function compara(nombre, registros, ordenes, hoy) {
  check(`${nombre}: agruparRegistros identico`, () => {
    assert.deepEqual(plano(mobile.agruparRegistros(registros, ordenes)), plano(web.agruparRegistros(registros, ordenes)))
  })
  check(`${nombre}: carenciaPorParcela identico`, () => {
    assert.deepEqual(plano(mobile.carenciaPorParcela(registros, hoy)), plano(web.carenciaPorParcela(registros, hoy)))
  })
}

// ─── Parity on input data ────────────────────────────────────────────────────

const archivo = process.argv[2]
let datos = sinteticos
if (archivo) {
  datos = JSON.parse(readFileSync(archivo, 'utf8'))
  assert.ok(Array.isArray(datos.registros) && Array.isArray(datos.ordenes), 'JSON needs { registros: [], ordenes: [] }')
  console.log(`datos: ${archivo} (${datos.registros.length} registros, ${datos.ordenes.length} ordenes)`)
}
// Synthetic fixtures use a fixed date so the carencia comparison is not vacuous
// (their habilitacion dates are 2026-09/10); real data uses the real clock.
const hoy = archivo ? web.hoyLocalISO() : '2026-10-05'
compara(archivo ? 'datos reales' : 'sinteticos', datos.registros, datos.ordenes, hoy)

if (!archivo) {
  check('sinteticos: la comparacion de carencia no es vacia', () => {
    assert.ok(web.carenciaPorParcela(datos.registros, hoy).size > 0)
    assert.ok(mobile.carenciaPorParcela(datos.registros, hoy).size > 0)
  })
}

check('helpers de fecha identicos', () => {
  assert.equal(mobile.hoyLocalISO(new Date(2026, 0, 5)), web.hoyLocalISO(new Date(2026, 0, 5)))
  assert.equal(mobile.diasEntre('2026-10-01', '2026-10-11'), web.diasEntre('2026-10-01', '2026-10-11'))
  assert.equal(mobile.formatFecha('2026-10-01'), web.formatFecha('2026-10-01'))
})

// ─── Fixed cases (run against both implementations) ──────────────────────────

for (const [nombre, m] of [['web', web], ['mobile', mobile]]) {
  const { registros, ordenes } = sinteticos

  check(`${nombre}: registro sin orden va a un grupo final con ordenId null`, () => {
    const g = m.agruparRegistros(registros, ordenes)
    const ultimo = g[g.length - 1]
    assert.equal(ultimo.ordenId, null)
    assert.equal(ultimo.clave, 'sin-orden')
    // Newer than every order, yet still last.
    assert.ok(ultimo.ultimaMs > Math.max(...g.slice(0, -1).map((x) => x.ultimaMs)))
    const nombres = ultimo.parcelas[0].valvulas.map((v) => v.nombre)
    // Manual records collapse per day: 2026-10-20 and 2026-09-01 (p1).
    assert.deepEqual(nombres, ['Carga manual', 'Carga manual'])
  })

  check(`${nombre}: valvula sin orden_valvula_id`, () => {
    const g = m.agruparRegistros(registros, ordenes)
    const o2 = g.find((x) => x.ordenId === 'o2')
    assert.equal(o2.parcelas[0].valvulas[0].nombre, 'Parcela completa')
    assert.equal(o2.parcelas[0].valvulas[0].ordenValvulaId, null)
    const o9 = g.find((x) => x.ordenId === 'o9')
    assert.equal(o9.orden, undefined)
    assert.equal(o9.parcelas[0].valvulas[0].nombre, 'Válvula')
    const o1 = g.find((x) => x.ordenId === 'o1')
    assert.deepEqual(o1.parcelas[0].valvulas.map((v) => v.nombre), ['Válvula 2', 'Válvula 1'])
    assert.deepEqual(o1.parcelas[0].valvulas[1].registros.map((r) => r.producto_nombre), ['Azufre', 'Zinc'])
    // Orders newest first: o2 (10-05) before o1 (10-03) before o9 (no confirmation, created 10-01).
    assert.deepEqual(g.map((x) => x.ordenId), ['o2', 'o1', 'o9', null])
  })

  check(`${nombre}: campania vacia`, () => {
    assert.deepEqual(m.agruparRegistros([], []), [])
    assert.equal(m.carenciaPorParcela([], '2026-10-10').size, 0)
  })

  check(`${nombre}: carencia vigente vs vencida`, () => {
    const hoyFijo = '2026-10-10'
    const c = m.carenciaPorParcela(
      [
        reg('a', { parcela_id: 'pv', fecha_habilitacion_cosecha: '2026-10-15' }),
        reg('b', { parcela_id: 'pv', fecha_habilitacion_cosecha: '2026-10-12' }),
        reg('c', { parcela_id: 'pe', fecha_habilitacion_cosecha: '2026-10-09' }), // expired
        reg('d', { parcela_id: 'ph', fecha_habilitacion_cosecha: hoyFijo }), // enabled today
      ],
      hoyFijo,
    )
    assert.deepEqual([...c.keys()], ['pv'])
    assert.equal(c.get('pv').hasta, '2026-10-15')
    assert.equal(c.get('pv').dias, 5)
    assert.deepEqual(c.get('pv').limitantes.map((r) => r.id), ['a'])
    assert.deepEqual(c.get('pv').vigentes.map((r) => r.id), ['a', 'b'])
  })
}

console.log(`\nPASS (${casos} checks)`)
