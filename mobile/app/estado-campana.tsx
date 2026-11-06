import { Redirect } from 'expo-router'

// Legacy route. It used to write the per-parcela CicloCampana store
// (POST /produccion/campana/), which the web and the map do not read, so
// changes made here never showed up elsewhere. The per-variedad override
// store (GET /produccion/estado-campana/actual + POST /produccion/estado-campana/)
// is edited in the "campana" tab; keep this route only so old deep links work.
export default function EstadoCampanaLegacyRedirect() {
  return <Redirect href="/(tabs)/campana" />
}
