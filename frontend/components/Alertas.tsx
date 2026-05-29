'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { getRiegos, type RiegoResponse } from '@/lib/api/riego'
import { getEstadoActual, type EstadoActualItem } from '@/lib/api/produccion'

interface Alerta {
  id: string
  nivel: 'warn' | 'info'
  mensaje: string
}

function derivarAlertas(riegos: RiegoResponse[], estadoActual: EstadoActualItem[]): Alerta[] {
  const alertas: Alerta[] = []
  const now = new Date()

  // Cabezales con >7 días sin riego
  const ultimoPorCabezal: Record<string, Date> = {}
  for (const r of riegos) {
    const fecha = new Date(r.fecha)
    if (!ultimoPorCabezal[r.cabezal] || fecha > ultimoPorCabezal[r.cabezal]) {
      ultimoPorCabezal[r.cabezal] = fecha
    }
  }
  for (const [cabezal, ultima] of Object.entries(ultimoPorCabezal)) {
    const dias = Math.floor((now.getTime() - ultima.getTime()) / 86_400_000)
    if (dias >= 7) {
      alertas.push({
        id: `riego-${cabezal}`,
        nivel: 'warn',
        mensaje: `Cabezal ${cabezal} sin riego hace ${dias} días`,
      })
    }
  }

  // Parcelas sin estado fenológico
  const sinEstado = estadoActual.filter((e) => !e.estado_fenologico)
  if (sinEstado.length > 0) {
    alertas.push({
      id: 'sin-fenologia',
      nivel: 'info',
      mensaje: `${sinEstado.length} parral${sinEstado.length !== 1 ? 'es' : ''} sin estado fenológico`,
    })
  }

  return alertas.slice(0, 3)
}

export default function Alertas() {
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const fechaDesde = since.toISOString().split('T')[0]

  const { data: riegos = [] } = useQuery({
    queryKey: ['alertas-riego', fechaDesde],
    queryFn: () => getRiegos({ fecha_desde: fechaDesde, limit: 500 }),
    staleTime: 300_000,
  })

  const { data: estadoActual = [] } = useQuery({
    queryKey: ['alertas-estado'],
    queryFn: getEstadoActual,
    staleTime: 300_000,
  })

  const alertas = derivarAlertas(riegos, estadoActual)

  return (
    <div
      className="bg-white rounded-[10px] border border-[#fbfaf6] p-4 flex-shrink-0"
      style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={16} strokeWidth={1.75} color="#a3293a" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#5a544c]">Alertas</span>
      </div>
      {alertas.length === 0 ? (
        <p className="text-sm text-[#a09584]">Sin alertas activas</p>
      ) : (
        <div className="space-y-2">
          {alertas.map((a) => (
            <div key={a.id} className="flex items-start gap-2 text-sm">
              <span
                className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-[5px]"
                style={{ backgroundColor: a.nivel === 'warn' ? '#a3293a' : '#3d6b86' }}
              />
              <span style={{ color: a.nivel === 'warn' ? '#a3293a' : '#5a544c' }}>
                {a.mensaje}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
