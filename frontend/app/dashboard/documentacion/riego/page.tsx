'use client'

import { useQuery } from '@tanstack/react-query'
import { getValvulasReales, type ValvulaReal } from '@/lib/api/riego'
import { listParcelasAdmin } from '@/lib/api/parcelas'

interface CuadranteProps {
  fid: number
  'Nombre de Cuadrante': string
  'Valvula Correspondiente': string
  Cabezal: number
}

interface CuadrantesGeoJSON {
  features: { properties: CuadranteProps }[]
}

async function getCuadrantesGeoJSON(): Promise<CuadrantesGeoJSON> {
  const res = await fetch('/layers/Cuadrantes%20de%20Riego.geojson')
  return res.json()
}

interface Fila {
  valvula: string
  cabezal: number
  orden: number | null
  cuadrantes: string[]
}

interface Grupo {
  parcelaId: string
  parcelaNombre: string
  filas: Fila[]
}

export default function DocumentacionRiegoPage() {
  const { data: valvulas = [], isLoading: loadingValvulas } = useQuery({
    queryKey: ['valvulas-reales'],
    queryFn: () => getValvulasReales(),
  })
  const { data: parcelas = [], isLoading: loadingParcelas } = useQuery({
    queryKey: ['parcelas-admin'],
    queryFn: listParcelasAdmin,
  })
  const { data: cuadrantes, isLoading: loadingCuadrantes } = useQuery({
    queryKey: ['cuadrantes-geojson'],
    queryFn: getCuadrantesGeoJSON,
  })

  const isLoading = loadingValvulas || loadingParcelas || loadingCuadrantes

  const nombrePorParcela = new Map(parcelas.map((p) => [p.id, p.nombre]))

  const cuadrantesPorValvula = new Map<string, string[]>()
  for (const f of cuadrantes?.features ?? []) {
    const nombreValvula = f.properties['Valvula Correspondiente']
    const nombreCuadrante = f.properties['Nombre de Cuadrante']
    if (!nombreValvula || !nombreCuadrante) continue
    const lista = cuadrantesPorValvula.get(nombreValvula) ?? []
    if (!lista.includes(nombreCuadrante)) lista.push(nombreCuadrante)
    cuadrantesPorValvula.set(nombreValvula, lista)
  }

  const grupos = new Map<string, Grupo>()
  for (const v of valvulas as ValvulaReal[]) {
    let grupo = grupos.get(v.parcela_id)
    if (!grupo) {
      grupo = {
        parcelaId: v.parcela_id,
        parcelaNombre: nombrePorParcela.get(v.parcela_id) ?? v.parcela_id,
        filas: [],
      }
      grupos.set(v.parcela_id, grupo)
    }
    grupo.filas.push({
      valvula: v.nombre,
      cabezal: v.cabezal,
      orden: v.orden,
      cuadrantes: cuadrantesPorValvula.get(v.nombre) ?? [],
    })
  }

  const gruposOrdenados = Array.from(grupos.values()).sort((a, b) =>
    a.parcelaNombre.localeCompare(b.parcelaNombre, 'es')
  )
  for (const g of gruposOrdenados) {
    g.filas.sort((a, b) => a.cabezal - b.cabezal || (a.orden ?? 99) - (b.orden ?? 99))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Riego — Válvulas y Cuadrantes</h1>
        <p className="text-sm text-gray-500 mt-1">
          Catálogo de referencia: qué válvula riega qué cuadrante, agrupado por parral y cabezal.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Parcela</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Cabezal</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Válvula</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Cuadrante(s)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 4 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : gruposOrdenados.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-gray-400">
                    No hay válvulas cargadas
                  </td>
                </tr>
              ) : (
                gruposOrdenados.flatMap((g) =>
                  g.filas.map((f, i) => (
                    <tr key={`${g.parcelaId}-${f.valvula}`} className="hover:bg-gray-50 transition-colors">
                      {i === 0 && (
                        <td
                          rowSpan={g.filas.length}
                          className="px-4 py-3 font-medium text-gray-900 align-top whitespace-nowrap border-r border-gray-100"
                        >
                          {g.parcelaNombre}
                        </td>
                      )}
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">Cabezal {f.cabezal}</td>
                      <td className="px-4 py-3 text-gray-900 font-mono text-xs">{f.valvula}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {f.cuadrantes.length > 0 ? f.cuadrantes.join(', ') : '—'}
                      </td>
                    </tr>
                  ))
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
