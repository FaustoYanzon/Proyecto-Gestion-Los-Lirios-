import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FincaKey = 'los_mimbres' | 'media_agua' | 'caucete'

// Primera temporada con datos cargados (migración de históricos, sesión
// 2026-09-15): no hay campañas de finca anteriores a esta.
export const PRIMER_ANIO_CAMPANA = 2023

function getDefaultCampana(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const startYear = month >= 5 ? year : year - 1
  return `${startYear}/${startYear + 1}`
}

// "2026/2027" -> 2026. Usado por las pantallas con filtro de año de campaña
// (mayo→abril) para sincronizarse con el selector global en vez de calcular
// su propio año de forma aislada.
export function campanaToAnio(campana: string): number {
  const [startYear] = campana.split('/')
  return Number(startYear)
}

// 2026 -> "2026/2027". Inversa de campanaToAnio, para escribir de vuelta al
// store global desde un selector que trabaja con el año como number.
export function anioToCampana(anio: number): string {
  return `${anio}/${anio + 1}`
}

// Lista de campañas disponibles en todos los selectores del sistema, de la
// más reciente a la más vieja. `aniosAdelante` deja agregar temporadas
// futuras (planificación: metas, presupuesto, plan fitosanitario) por
// encima de la campaña actual.
export function buildCampanas(aniosAdelante = 0): string[] {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const base = (month >= 5 ? year : year - 1) + aniosAdelante
  const campanas: string[] = []
  for (let start = base; start >= PRIMER_ANIO_CAMPANA; start--) {
    campanas.push(`${start}/${start + 1}`)
  }
  return campanas
}

interface ContextState {
  finca: FincaKey
  setFinca: (finca: FincaKey) => void
  campana: string
  setCampana: (campana: string) => void
}

export const useContextStore = create<ContextState>()(
  persist(
    (set) => ({
      finca: 'los_mimbres',
      setFinca: (finca) => set({ finca }),
      campana: getDefaultCampana(),
      setCampana: (campana) => set({ campana }),
    }),
    { name: 'los-lirios-context' }
  )
)

// Selector de temporada como año (number), leyendo y escribiendo directo
// sobre el store global — así cualquier pantalla que lo use queda
// sincronizada en las dos direcciones con el CampanaSwitcher del header y
// entre sí, sin estado local propio ni lógica de sincronización manual.
export function useCampanaAnio(): [number, (anio: number) => void] {
  const campana = useContextStore((s) => s.campana)
  const setCampana = useContextStore((s) => s.setCampana)
  const setAnio = (anio: number) => setCampana(anioToCampana(anio))
  return [campanaToAnio(campana), setAnio]
}
