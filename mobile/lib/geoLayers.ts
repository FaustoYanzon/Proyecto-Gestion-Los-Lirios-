/**
 * GeoJSON layer data for the infrastructure map layers.
 *
 * Files live in mobile/assets/layers/ as plain JSON (GeoJSON FeatureCollection).
 * Replace each placeholder with the real GeoJSON exported from your GIS tool.
 * The web app reads the same geometry from frontend/public/layers/*.geojson —
 * keep both in sync when you update the data.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const acequias = require('../assets/layers/acequias.json')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lineaElectrica = require('../assets/layers/linea-electrica.json')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const canerias = require('../assets/layers/canerias.json')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const valvulas = require('../assets/layers/valvulas.json')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cuadrantesRiego = require('../assets/layers/cuadrantes-riego.json')

export interface GeoLayerData {
  acequias: object
  lineaElectrica: object
  canerias: object
  valvulas: object
  cuadrantesRiego: object
}

export const GEO_LAYERS: GeoLayerData = {
  acequias,
  lineaElectrica,
  canerias,
  valvulas,
  cuadrantesRiego,
}
