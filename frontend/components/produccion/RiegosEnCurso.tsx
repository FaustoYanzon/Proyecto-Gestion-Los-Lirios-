'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Droplets, Timer, ArrowRight } from 'lucide-react'
import { getRiegosEnCurso, terminarRiego, calcEnCurso, type RiegoEnCurso } from '@/lib/api/riego'
import BuzonModal from '@/components/BuzonModal'

function formatTranscurrido(horas: number): string {
  const totalMin = Math.floor(horas * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

interface Props {
  parcelaNombre: (id: string) => string
  showTerminar?: boolean
  // Ruta a "Iniciar riego" — si se pasa, el estado vacío muestra un CTA en
  // vez de desaparecer del todo (antes el panel era invisible si nadie
  // había iniciado un riego nunca, y la función quedaba sin descubrir).
  iniciarHref?: string
  // Igual que Alertas: muestra solo el primero + cuántos hay, y al
  // clickear abre un panel con todos. Pensado para el Inicio, donde varios
  // riegos en curso a la vez ocupaban demasiado lugar. La página de Riego
  // sigue mostrando la lista completa siempre (collapsed=false).
  collapsed?: boolean
}

export default function RiegosEnCurso({
  parcelaNombre, showTerminar = true, iniciarHref, collapsed = false,
}: Props) {
  const queryClient = useQueryClient()
  const [terminandoId, setTerminandoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

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

  if (enCurso.length === 0) {
    if (!iniciarHref) return null
    return (
      <Link
        href={iniciarHref}
        className="flex items-center justify-between gap-3 bg-white rounded-lg border border-gray-200 shadow-sm p-4 hover:border-[#7a1f2c] transition-colors"
      >
        <span className="flex items-center gap-2 text-sm text-[#5a544c]">
          <Timer size={16} className="text-blue-600 flex-shrink-0" />
          Sin riegos en curso — Iniciar uno
        </span>
        <ArrowRight size={15} className="text-[#a09584] flex-shrink-0" />
      </Link>
    )
  }

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

  function Fila({ r, conBoton }: { r: RiegoEnCurso; conBoton: boolean }) {
    const { horas, litros } = calcEnCurso(r.inicio, r.n_valvulas)
    return (
      <div className="flex items-center justify-between gap-4 bg-[#faf6ec] border border-[#fbfaf6] rounded-md px-4 py-3">
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
        {conBoton && (
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
  }

  if (collapsed) {
    const primero = enCurso[0]
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 w-full text-left hover:border-[#7a1f2c] transition-colors"
        >
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Timer size={16} className="text-blue-600" />
            Riegos en curso ({enCurso.length})
          </h2>
          <Fila r={primero} conBoton={false} />
          {enCurso.length > 1 && (
            <p className="text-xs text-[#a09584] pt-2">
              +{enCurso.length - 1} más — ver todos
            </p>
          )}
        </button>

        {open && (
          <BuzonModal title={`Riegos en curso (${enCurso.length})`} onClose={() => setOpen(false)}>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md mb-2">{error}</p>
            )}
            <div className="space-y-2">
              {enCurso.map((r) => <Fila key={r.id} r={r} conBoton={showTerminar} />)}
            </div>
          </BuzonModal>
        )}
      </>
    )
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
        {enCurso.map((r) => <Fila key={r.id} r={r} conBoton={showTerminar} />)}
      </div>
    </div>
  )
}
