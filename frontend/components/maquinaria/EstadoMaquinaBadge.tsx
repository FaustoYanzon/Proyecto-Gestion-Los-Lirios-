import {
  ESTADO_MAQUINA_LABELS,
  type EstadoMaquina,
  type Semaforo,
} from '@/lib/api/maquinaria'

// Semaphore colors come from the API's derived `semaforo` field (never recomputed here).
const SEMAFORO_STYLES: Record<Semaforo, { dot: string; chip: string }> = {
  verde: { dot: 'bg-green-500', chip: 'bg-green-50 text-green-700 border-green-200' },
  amarillo: { dot: 'bg-amber-400', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  rojo: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 border-red-200' },
  azul: { dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
}

export default function EstadoMaquinaBadge({
  estado,
  semaforo,
}: {
  estado: EstadoMaquina
  semaforo: Semaforo
}) {
  const styles = SEMAFORO_STYLES[semaforo]
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${styles.chip}`}
    >
      <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${styles.dot}`} />
      {ESTADO_MAQUINA_LABELS[estado]}
    </span>
  )
}
