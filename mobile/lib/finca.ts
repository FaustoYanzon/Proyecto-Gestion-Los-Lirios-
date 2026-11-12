// Finca scoping helpers shared by the screens that depend on the active finca.
import { colors } from './theme'

// Strict filter: a parcela only shows under its own finca. Every parcela has a
// finca assigned (scripts/migracion/asignar_finca_parcelas.py), so a missing
// finca is a data problem and is hidden rather than leaked into every finca.
export function filtrarPorFinca<T extends { finca?: string | null }>(items: T[], finca: string): T[] {
  return items.filter((i) => i.finca === finca)
}

// Tag colors per finca (machinery list, orders). Not the semaforo colors.
// Caucete is no longer a finca; it stays only for legacy rows.
export const FINCA_TAG_COLORS: Record<string, string> = {
  los_mimbres: colors.tierra,
  media_agua: colors.burdeos[600],
  caucete: colors.ink60,
}
