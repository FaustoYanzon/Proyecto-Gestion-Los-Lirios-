import { ESTADO_ORDEN_LABELS, type EventoResponse } from '@/lib/api/maquinaria'
import { useAuthStore } from '@/store/authStore'
import { fmtDateTime } from './ordenUi'

// Vertical timeline, oldest first. The API resolves the actor name (the users
// list is super_admin only); "Vos" marks the logged-in user's own movements.
export default function OrdenTimeline({ eventos }: { eventos: EventoResponse[] }) {
  const meId = useAuthStore((s) => s.user?.id)
  const sorted = [...eventos].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  if (sorted.length === 0) {
    return <p className="text-sm text-gray-500">Sin movimientos registrados.</p>
  }

  return (
    <ol className="relative ml-2 border-l border-gray-200 space-y-4">
      {sorted.map((ev) => (
        <li key={ev.id} className="ml-4">
          <span
            aria-hidden="true"
            className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-[#7a1f2c]"
          />
          <p className="text-sm font-medium text-gray-900">
            {ev.estado_desde
              ? `${ESTADO_ORDEN_LABELS[ev.estado_desde]} → ${ESTADO_ORDEN_LABELS[ev.estado_hasta]}`
              : `Orden creada: ${ESTADO_ORDEN_LABELS[ev.estado_hasta]}`}
          </p>
          <p className="text-xs text-gray-500">
            {ev.usuario_id === meId ? 'Vos' : (ev.usuario_nombre ?? 'Usuario eliminado')} · {fmtDateTime(ev.created_at)}
          </p>
          {ev.nota && <p className="mt-1 text-sm text-gray-700 bg-gray-50 rounded px-2 py-1">{ev.nota}</p>}
        </li>
      ))}
    </ol>
  )
}
