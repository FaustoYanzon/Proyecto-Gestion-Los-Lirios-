// Genera frontend/lib/content/finca-map.ts a partir del KML real de la finca
// (frontend/public/Los Lirios 2026.kml). Se corre a mano cuando cambia el
// parcelario:  node scripts/build-finca-map.mjs
//
// La variedad y la superficie de cada cuadro NO están en el KML: se mantienen
// en la tabla PARCELA_META de abajo (snapshot de la DB al 2026-09). Si un
// cuadro cambia de variedad, se edita acá y se vuelve a correr.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const KML = resolve(__dirname, '../public/Los Lirios 2026.kml')
const OUT = resolve(__dirname, '../lib/content/finca-map.ts')

// nombre en el KML -> { variedad, ha }
const PARCELA_META = {
  'Parral 2': { variedad: 'flame', ha: 3.0 },
  'Parral 4': { variedad: 'fiesta', ha: 2.85 },
  'Parral 5': { variedad: 'fiesta', ha: 2.85 },
  'Parral 6': { variedad: 'red_globe', ha: 4.0 },
  'Parral 7': { variedad: 'flame', ha: 4.0 },
  'Parral 8': { variedad: 'syrah', ha: 2.8 },
  'Parral 9': { variedad: 'red_globe', ha: 2.2 },
  'Parral 10': { variedad: 'flame', ha: 3.0 },
  'Parral 11': { variedad: 'flame', ha: 4.0 },
  'Parral 12': { variedad: 'flame', ha: 2.94 },
  'Parral 13': { variedad: 'flame', ha: 2.5 },
  'Parral 14': { variedad: 'aspirant', ha: 2.5 },
  'Parral 15': { variedad: 'flame', ha: 2.5 },
  'Parral 16': { variedad: 'flame', ha: 2.5 },
  'Parral 21': { variedad: 'flame', ha: 4.21 },
  'Parral Bond. Nuevo': { variedad: 'bonarda', ha: 2.0 },
  'Parral Bond. Viejo': { variedad: 'bonarda', ha: 2.0 },
  'Parral Sult.': { variedad: 'sultanina', ha: 4.4 },
  'Parral SYR-RG': { variedad: 'syrah', ha: 2.8 },
}

const kml = readFileSync(KML, 'utf-8')
const placemarks = kml.match(/<Placemark[\s\S]*?<\/Placemark>/g) ?? []

/** @type {{name:string, kind:string, ring:[number,number][]}[]} */
const raw = []
for (const pm of placemarks) {
  const name = pm.match(/<name>([^<]+)<\/name>/)?.[1]?.trim()
  const coords = pm.match(/<Polygon[\s\S]*?<coordinates>\s*([\s\S]*?)\s*<\/coordinates>/)?.[1]
  if (!name || !coords) continue
  const ring = coords
    .trim()
    .split(/\s+/)
    .map((c) => c.split(',').map(Number))
    .map(([lon, lat]) => [lon, lat])
  let kind = 'otro'
  if (name.startsWith('Parral')) kind = 'parral'
  else if (name.startsWith('Potrero')) kind = 'potrero'
  else if (name.startsWith('Pasero')) kind = 'pasero'
  else if (name.startsWith('Cabezal')) kind = 'cabezal'
  else if (name === 'Finca') kind = 'finca'
  raw.push({ name, kind, ring })
}

// Proyección equirectangular local. El viewBox se ajusta a los PARRALES
// (más un margen), no a toda la finca: los potreros vacíos abajo sólo
// aportarían aire muerto. Se conserva como contexto lo que cae dentro de
// esa ventana ampliada.
const allPts = raw.flatMap((r) => r.ring)
const lat0 = allPts.reduce((s, p) => s + p[1], 0) / allPts.length
const cosLat = Math.cos((lat0 * Math.PI) / 180)
const proj = ([lon, lat]) => [lon * cosLat, -lat] // y negada: norte arriba

const parralPts = raw.filter((r) => r.kind === 'parral').flatMap((r) => r.ring)
let minX = Infinity
let minY = Infinity
let maxX = -Infinity
let maxY = -Infinity
for (const [lon, lat] of parralPts) {
  const [x, y] = proj([lon, lat])
  if (x < minX) minX = x
  if (x > maxX) maxX = x
  if (y < minY) minY = y
  if (y > maxY) maxY = y
}
// margen del 7% del lado mayor a cada lado
const m = 0.07 * Math.max(maxX - minX, maxY - minY)
minX -= m
maxX += m
minY -= m
maxY += m

const PAD = 8
const W = 1000
const spanX = maxX - minX
const spanY = maxY - minY
const scale = (W - PAD * 2) / spanX
const H = Math.round(spanY * scale + PAD * 2)

const inWindow = (ring) => {
  const cs = ring.map(proj)
  const cx = cs.reduce((s, p) => s + p[0], 0) / cs.length
  const cy = cs.reduce((s, p) => s + p[1], 0) / cs.length
  return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY
}

const toSvg = ([lon, lat]) => {
  const [x, y] = proj([lon, lat])
  return [
    Math.round((x - minX) * scale + PAD),
    Math.round((y - minY) * scale + PAD),
  ]
}

const ringToPath = (ring) => {
  const pts = ring.map(toSvg)
  return (
    'M' +
    pts.map(([x, y], i) => `${i === 0 ? '' : 'L'}${x} ${y}`).join(' ') +
    'Z'
  )
}

const centroid = (ring) => {
  const pts = ring.map(toSvg)
  const n = pts.length - 1 // anillo cerrado
  const cx = pts.slice(0, n).reduce((s, p) => s + p[0], 0) / n
  const cy = pts.slice(0, n).reduce((s, p) => s + p[1], 0) / n
  return [Math.round(cx), Math.round(cy)]
}

const parrales = raw
  .filter((r) => r.kind === 'parral')
  .map((r) => {
    const meta = PARCELA_META[r.name] ?? {}
    if (!meta.variedad) {
      console.warn(`  aviso: ${r.name} sin variedad en PARCELA_META`)
    }
    const shortName = r.name.replace(/^Parral\s+/, '')
    return {
      name: shortName,
      variedad: meta.variedad ?? null,
      ha: meta.ha ?? null,
      d: ringToPath(r.ring),
      c: centroid(r.ring),
    }
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))

const contexto = raw
  .filter((r) => (r.kind === 'potrero' || r.kind === 'pasero') && inWindow(r.ring))
  .map((r) => ({ d: ringToPath(r.ring) }))

const finca = raw.find((r) => r.kind === 'finca')

const banner =
  '// GENERADO por scripts/build-finca-map.mjs — no editar a mano.\n' +
  '// La geometría sale del KML; variedad/ha de PARCELA_META en ese script.\n\n'

const body =
  `export const FINCA_MAP_VIEWBOX = '0 0 ${W} ${H}' as const\n\n` +
  `export interface CuadroParral {\n` +
  `  name: string\n  variedad: string | null\n  ha: number | null\n  d: string\n  c: [number, number]\n}\n\n` +
  `export const PARRALES: CuadroParral[] = ${JSON.stringify(parrales, null, 2)}\n\n` +
  `export const CONTEXTO: { d: string }[] = ${JSON.stringify(contexto, null, 2)}\n\n` +
  `export const FINCA_OUTLINE: string${finca ? '' : ' | null'} = ${
    finca ? JSON.stringify(ringToPath(finca.ring)) : 'null'
  }\n`

writeFileSync(OUT, banner + body + '\n')
console.log(
  `finca-map.ts: ${parrales.length} parrales, ${contexto.length} de contexto, viewBox 0 0 ${W} ${H}`,
)
