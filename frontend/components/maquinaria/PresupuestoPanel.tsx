import type { PresupuestoResponse, EstadoPresupuesto } from '@/lib/api/maquinaria'
import { formatARS } from '@/lib/theme'
import { fmtDateTime } from './ordenUi'

const ESTADO_STYLES: Record<EstadoPresupuesto, { label: string; cls: string }> = {
  pendiente: { label: 'Pendiente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  aprobado: { label: 'Aprobado', cls: 'bg-green-50 text-green-700 border-green-200' },
  rechazado: { label: 'Rechazado', cls: 'bg-red-50 text-red-700 border-red-200' },
}

// Read-only list. `monto` / `adjunto_url` are null for encargado: render nothing
// for them instead of a placeholder.
export default function PresupuestoPanel({ presupuestos }: { presupuestos: PresupuestoResponse[] }) {
  if (presupuestos.length === 0) {
    return <p className="text-sm text-gray-500">Sin presupuestos cargados.</p>
  }
  const sorted = [...presupuestos].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  return (
    <ul className="space-y-3">
      {sorted.map((p) => {
        const st = ESTADO_STYLES[p.estado]
        return (
          <li key={p.id} className="rounded-md border border-gray-200 p-3 space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-900">{p.taller}</p>
              <span className={`px-2 py-0.5 rounded-full border text-[11px] font-medium ${st.cls}`}>
                {st.label}
              </span>
            </div>
            {p.monto !== null && (
              <p className="font-mono text-sm text-gray-800">{formatARS(p.monto)}</p>
            )}
            {p.detalle && <p className="text-sm text-gray-600">{p.detalle}</p>}
            {p.adjunto_url && (
              <a
                href={p.adjunto_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#7a1f2c] hover:underline"
              >
                Ver adjunto
              </a>
            )}
            {p.estado === 'rechazado' && p.motivo_rechazo && (
              <p className="text-xs text-red-700">Motivo del rechazo: {p.motivo_rechazo}</p>
            )}
            <p className="text-[11px] text-gray-400">Cargado el {fmtDateTime(p.created_at)}</p>
          </li>
        )
      })}
    </ul>
  )
}
