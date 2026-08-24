import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type FincaKey = 'los_mimbres' | 'media_agua' | 'caucete'

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
