'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Droplets, Timer } from 'lucide-react'
import { getRiegosEnCurso, terminarRiego, calcEnCurso } from '@/lib/api/riego'

function formatTranscurrido(horas: number): string {
  const totalMin = Math.floor(horas * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

export default function RiegosEnCurso({ parcelaNombre }: { parcelaNombre: (id: string) => string }) {
  const queryClient = useQueryClient()
  const [terminandoId, setTerminandoId] = useState<string | null>(null)

  // Refetch cada 30s para detectar riegos iniciados/cerrados por otros
  // usuarios — el cronómetro en pantalla es puramente client-side (no hace
  // falta pegarle al servidor cada segundo para eso).
  const { data: enCurso = [] } = useQuery({
    queryKey: ['riegos-en-curso'],
    queryFn: getRiegosEnCurso,
    refetchInterval: 30_000,
  })

  const [, setTick] = useState(0)
  useEffect(() => {
    if (enCurso.length === 0) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [enCurso.length])

  if (enCurso.length === 0) return null

  async function handleTerminar(id: string, horas: number, litros: number) {
    if (!window.confirm(
      `¿Terminar este riego? Se va a registrar ${formatTranscurrido(horas)} y ${litros.toLocaleString('es-AR')} L aplicados.`
    )) return
    setTerminandoId(id)
    try {
      await terminarRiego(id)
      queryClient.invalidateQueries({ queryKey: ['riegos-en-curso'] })
      queryClient.invalidateQueries({ queryKey: ['riegos'] })
    } finally {
      setTerminandoId(null)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
        <Timer size={16} className="text-blue-600" />
        Riegos en curso
      </h2>
      <div className="space-y-2">
        {enCurso.map((r) => {
          const { horas, litros } = calcEnCurso(r.inicio, r.n_valvulas)
          return (
            <div
              key={r.id}
              className="flex items-center justify-between gap-4 bg-[#faf6ec] border border-[#fbfaf6] rounded-md px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Droplets size={18} className="text-blue-500 flex-shrink-0" />
                <div className="text-sm min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {parcelaNombre(r.parcela_id)} · Cabezal {r.cabezal} · V{r.valvula.split(',').join('+')}
                  </p>
                  <p className="text-blue-700 font-mono">
                    {formatTranscurrido(horas)} · {litros.toLocaleString('es-AR')} L
                    <span className="text-gray-400 font-sans ml-2">{r.responsable}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleTerminar(r.id, horas, litros)}
                disabled={terminandoId === r.id}
                className="flex-shrink-0 px-3 py-1.5 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 transition-colors"
              >
                Terminar
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
