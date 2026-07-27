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

interface Props {
  parcelaNombre: (id: string) => string
  showTerminar?: boolean
}

export default function RiegosEnCurso({ parcelaNombre, showTerminar = true }: Props) {
  const queryClient = useQueryClient()
  const [terminandoId, setTerminandoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    setError(null)
    try {
      await terminarRiego(id)
      queryClient.invalidateQueries({ queryKey: ['riegos-en-curso'] })
      queryClient.invalidateQueries({ queryKey: ['riegos'] })
    } catch {
      // La escritura puede haber llegado al servidor igual aunque la
      // respuesta no vuelva (hipo de red) — antes de mostrar error,
      // confirmamos contra el servidor si el riego ya no figura como en
      // curso (= sí se terminó) para no generar falsas alarmas.
      const sigueEnCurso = await getRiegosEnCurso()
        .then((lista) => lista.some((x) => x.id === id))
        .catch(() => true)
      if (!sigueEnCurso) {
        queryClient.invalidateQueries({ queryKey: ['riegos-en-curso'] })
        queryClient.invalidateQueries({ queryKey: ['riegos'] })
      } else {
        setError('No se pudo terminar el riego. Intentá de nuevo.')
      }
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
      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md mb-2">{error}</p>
      )}
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
                    Cabezal {r.cabezal} - {parcelaNombre(r.parcela_id)} - V{r.valvula.split(',').join('+')}
                  </p>
                  <p className="text-blue-700 font-mono">
                    {formatTranscurrido(horas)}
                    <span className="text-gray-400 font-sans ml-2">{r.responsable}</span>
                  </p>
                </div>
              </div>
              {showTerminar && (
                <button
                  onClick={() => handleTerminar(r.id, horas, litros)}
                  disabled={terminandoId === r.id}
                  className="flex-shrink-0 px-3 py-1.5 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60 transition-colors"
                >
                  Terminar
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
