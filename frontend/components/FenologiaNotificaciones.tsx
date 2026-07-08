'use client'

import { useQuery } from '@tanstack/react-query'
import { Sprout, PenLine, Sparkles } from 'lucide-react'
import { getFenologiaEstadoActual, VARIEDAD_LABELS } from '@/lib/api/produccion'
import { useRotatingIndex } from '@/lib/useRotatingIndex'

// Franja horizontal debajo del mapa en el dashboard. Muestra UNA variedad
// por vez (no todas juntas) para que se lea como una notificación real y no
// como una lista larga. La rotación avanza al montar (login o volver a la
// pestaña de inicio) y automáticamente cada 15 min mientras la pestaña queda
// abierta — ver useRotatingIndex. El estado mostrado puede venir del cálculo
// automático (app.core.fenologia) o de una confirmación manual de
// CicloCampana vigente (ventana de 45 días) — el tag de fuente aclara cuál.
export default function FenologiaNotificaciones() {
  const { data: fases = [], isLoading } = useQuery({
    queryKey: ['fenologia-notificaciones'],
    queryFn: getFenologiaEstadoActual,
    staleTime: 3_600_000,
  })

  const idx = useRotatingIndex(fases.length, 'll_fenologia_notif_rotation')
  const f = fases[idx]

  if (isLoading) {
    return (
      <div
        className="bg-white rounded-[10px] border border-[#fbfaf6] p-4 h-[76px] animate-pulse"
        style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}
      />
    )
  }

  if (!f) return null

  return (
    <div
      className="bg-white rounded-[10px] border border-[#fbfaf6] p-4 flex items-center gap-4"
      style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}
    >
      <Sprout size={18} strokeWidth={1.75} color="#7c3aed" className="flex-shrink-0" />

      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-semibold text-[#1f1a17]">
          {VARIEDAD_LABELS[f.variedad] ?? f.variedad}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-[#7c3aed] bg-purple-50 rounded px-1.5 py-0.5">
          {f.fase_label}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-[#a09584]">
          {f.fuente === 'manual' ? <PenLine size={11} /> : <Sparkles size={11} />}
          {f.fuente === 'manual'
            ? `Confirmado a mano${f.fecha_confirmacion ? ` · ${f.fecha_confirmacion.split('-').reverse().join('/')}` : ''}`
            : 'Estimado automático'}
        </span>
      </div>

      <div className="h-8 w-px bg-[#fbfaf6] flex-shrink-0" />

      <div className="flex flex-wrap gap-x-4 gap-y-0.5 min-w-0">
        {f.tareas_recomendadas.slice(0, 2).map((t, i) => (
          <p key={i} className="text-xs text-[#5a544c] leading-snug truncate">• {t}</p>
        ))}
      </div>

      {fases.length > 1 && (
        <span className="ml-auto text-[10px] text-[#a09584] flex-shrink-0">
          {idx + 1}/{fases.length}
        </span>
      )}
    </div>
  )
}
