'use client'

// Segment-level error boundary for every /dashboard route.
// Catches render/query errors so one broken screen doesn't blank the whole app.

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // No structured logging yet — console keeps the digest visible in Vercel logs.
    console.error('[dashboard error boundary]', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div
        className="rounded-full p-4 mb-4"
        style={{ backgroundColor: '#faf6ec' }}
      >
        <AlertTriangle size={28} strokeWidth={1.75} color="#7a1f2c" />
      </div>
      <h2 className="text-lg font-semibold text-[#1f1a17]">
        Algo salió mal en esta pantalla
      </h2>
      <p className="text-sm text-[#5a544c] mt-2 max-w-md">
        El resto del sistema sigue funcionando. Podés reintentar, o volver al
        inicio desde el menú de la izquierda.
      </p>
      {error.digest && (
        <p className="text-xs text-[#a09584] mt-2 font-mono">
          Código: {error.digest}
        </p>
      )}
      <button
        onClick={reset}
        className="mt-5 flex items-center gap-2 px-4 py-2 text-sm font-medium text-white
                   bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors"
      >
        <RotateCcw size={14} />
        Reintentar
      </button>
    </div>
  )
}
