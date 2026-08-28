'use client'

import { X } from 'lucide-react'

// Chrome compartido para los paneles tipo "buzón" que se abren por encima
// del Inicio (Alertas, Riegos en curso) — mismo tamaño y comportamiento en
// los dos para que se sientan parte del mismo patrón.
export default function BuzonModal({
  title, onClose, children, footer,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    // z-[2000]: Leaflet usa z-index internos de hasta 1000 (.leaflet-top/
    // .leaflet-bottom) para sus controles/paneles — con z-50 el mapa del
    // Inicio lo tapaba. Bien por encima de eso para que gane siempre.
    <div className="fixed inset-0 z-[2000] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-[56rem] flex flex-col max-h-[85vh]">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#e2dbcc] flex-shrink-0">
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#a09584] hover:text-[#5a544c] hover:bg-[#fbfaf6] transition-colors"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#5a544c]">{title}</h2>
        </div>

        <div className="overflow-y-auto p-3 flex-1">{children}</div>

        {footer && (
          <div className="text-[11px] text-[#a09584] px-5 py-2.5 border-t border-[#e2dbcc] flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
