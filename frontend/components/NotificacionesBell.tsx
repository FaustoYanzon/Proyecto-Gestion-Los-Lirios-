'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check } from 'lucide-react'
import { getRiegos, type RiegoResponse } from '@/lib/api/riego'
import { getEstadoActual, type EstadoActualItem } from '@/lib/api/produccion'
import { getAlertasCarencia, type FitosanitarioResponse } from '@/lib/api/fitosanitarios'
import { getAlertasDescartadas, descartarAlerta } from '@/lib/api/alertas'
import { getLotesArca, type LoteImportacionArcaResponse } from '@/lib/api/arca'
import BuzonModal from '@/components/BuzonModal'

const MES_NOMBRE = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

// Quincena vencida hace >=3 días sin un lote importado que la cubra, o null
// si estamos en medio de una quincena (sin apuro todavía).
function quincenaVencidaSinImportar(now: Date): { desde: Date; etiqueta: string } | null {
  const day = now.getDate()
  if (day >= 18) {
    const desde = new Date(now.getFullYear(), now.getMonth(), 1)
    return { desde, etiqueta: `primera quincena de ${MES_NOMBRE[now.getMonth()]}` }
  }
  if (day <= 3) {
    const finMesAnterior = new Date(now.getFullYear(), now.getMonth(), 0)
    const desde = new Date(finMesAnterior.getFullYear(), finMesAnterior.getMonth(), 16)
    return { desde, etiqueta: `segunda quincena de ${MES_NOMBRE[desde.getMonth()]}` }
  }
  return null
}

interface Alerta {
  id: string
  nivel: 'warn' | 'info'
  mensaje: string
}

function derivarAlertas(
  riegos: RiegoResponse[],
  estadoActual: EstadoActualItem[],
  carencias: FitosanitarioResponse[],
  lotesArca: LoteImportacionArcaResponse[],
): Alerta[] {
  const alertas: Alerta[] = []
  const now = new Date()

  // Recordatorio de subir los CSV de ARCA (recibidos/emitidos) — quincena
  // vencida hace >=3 días sin un lote de ese tipo que la cubra. Puro cálculo
  // de fecha + los últimos lotes ya cargados, sin scheduler ni backend nuevo.
  const vencida = quincenaVencidaSinImportar(now)
  if (vencida) {
    for (const tipo of ['recibido', 'emitido'] as const) {
      const yaImportado = lotesArca.some(
        (l) => l.tipo_archivo === tipo && new Date(l.importado_at) >= vencida.desde,
      )
      if (!yaImportado) {
        alertas.push({
          id: `arca-${tipo}-${vencida.desde.toISOString().split('T')[0]}`,
          nivel: 'info',
          mensaje: `Falta importar los comprobantes ${tipo === 'recibido' ? 'recibidos (compras)' : 'emitidos (ventas)'} de ARCA de la ${vencida.etiqueta}`,
        })
      }
    }
  }

  // Carencia fitosanitaria: parcelas que aún no pueden cosecharse.
  // Food-safety rule — always listed first, before any other alert.
  // Backend already filters fecha_habilitacion_cosecha >= today; we keep
  // only the latest habilitación per parcela (multiple applications may overlap).
  const nombrePorParcela: Record<string, string> = {}
  for (const e of estadoActual) nombrePorParcela[e.parcela_id] = e.parcela_nombre

  const carenciaPorParcela: Record<string, FitosanitarioResponse> = {}
  for (const c of carencias) {
    const prev = carenciaPorParcela[c.parcela_id]
    if (!prev || c.fecha_habilitacion_cosecha > prev.fecha_habilitacion_cosecha) {
      carenciaPorParcela[c.parcela_id] = c
    }
  }
  const ordenadas = Object.values(carenciaPorParcela).sort((a, b) =>
    a.fecha_habilitacion_cosecha.localeCompare(b.fecha_habilitacion_cosecha),
  )
  for (const c of ordenadas) {
    // Parse as local date (avoid UTC shift from new Date('YYYY-MM-DD'))
    const [y, m, d] = c.fecha_habilitacion_cosecha.split('-').map(Number)
    const habilitacion = new Date(y, m - 1, d)
    const dias = Math.ceil((habilitacion.getTime() - now.getTime()) / 86_400_000)
    const nombre = nombrePorParcela[c.parcela_id] ?? c.parcela_id
    alertas.push({
      id: `carencia-${c.parcela_id}`,
      nivel: 'warn',
      mensaje: `${nombre} en carencia (${c.producto_nombre}): no cosechar hasta el ${d}/${m} (${dias} día${dias !== 1 ? 's' : ''})`,
    })
  }

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

  return alertas
}

// Panel tipo buzón, disparado desde la campanita del header. Tildar (✓)
// descarta la alerta 48h — no hay forma de "resolverla" de verdad desde acá
// porque las alertas se calculan en vivo a partir de datos reales, no son
// filas propias; 48h evita que un descarte accidental silencie un problema
// real (ej. riego atrasado) para siempre. Sin botón de cancelar a propósito
// (antes existía "✕ cancelada" con el mismo efecto de descarte — se sacó
// para no duplicar la única acción real que tiene sentido acá).
function AlertasModal({
  alertas, onClose, onDescartar, descartandoId,
}: {
  alertas: Alerta[]
  onClose: () => void
  onDescartar: (id: string) => void
  descartandoId: string | null
}) {
  return (
    <BuzonModal
      title={`Alertas (${alertas.length})`}
      onClose={onClose}
      footer="Al tildar, la alerta se oculta por 48h — si el problema sigue, vuelve a aparecer sola."
    >
      {alertas.length === 0 ? (
        <p className="text-sm text-[#a09584] px-2 py-4 text-center">Sin alertas activas</p>
      ) : (
        <div className="space-y-2">
          {alertas.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-2 rounded-lg border border-[#e2dbcc] px-3 py-2.5"
            >
              <span
                className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-[7px]"
                style={{ backgroundColor: a.nivel === 'warn' ? '#a3293a' : '#3d6b86' }}
              />
              <span className="text-sm flex-1">
                <span
                  className="text-[10px] font-bold uppercase tracking-wide mr-1.5"
                  style={{ color: a.nivel === 'warn' ? '#a3293a' : '#8a6a1f' }}
                >
                  {a.nivel === 'warn' ? 'URGENTE' : 'PENDIENTE'}
                </span>
                <span style={{ color: a.nivel === 'warn' ? '#a3293a' : '#5a544c' }}>
                  {a.mensaje}
                </span>
              </span>
              <button
                onClick={() => onDescartar(a.id)}
                disabled={descartandoId === a.id}
                title="Marcar como completada"
                className="flex-shrink-0 p-1.5 rounded-md text-[#3f5c3a] hover:bg-[#eef3ec] disabled:opacity-50 transition-colors"
              >
                <Check size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </BuzonModal>
  )
}

export default function NotificacionesBell() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [descartandoId, setDescartandoId] = useState<string | null>(null)

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

  // Requires encargado+ role; on 403 the query fails silently and defaults to []
  const { data: carencias = [] } = useQuery({
    queryKey: ['alertas-carencia'],
    queryFn: getAlertasCarencia,
    staleTime: 300_000,
    retry: false,
  })

  const { data: descartadas = [] } = useQuery({
    queryKey: ['alertas-descartadas'],
    queryFn: getAlertasDescartadas,
    staleTime: 60_000,
  })

  const { data: lotesArca = [] } = useQuery({
    queryKey: ['arca-lotes'],
    queryFn: () => getLotesArca({ limit: 10 }),
    staleTime: 300_000,
  })

  const descartadasIds = new Set(descartadas.map((d) => d.alerta_id))
  const todasLasAlertas = derivarAlertas(riegos, estadoActual, carencias, lotesArca)
  const alertasVisibles = todasLasAlertas.filter((a) => !descartadasIds.has(a.id))

  async function handleDescartar(id: string) {
    setDescartandoId(id)
    try {
      await descartarAlerta(id, 'completada')
      queryClient.invalidateQueries({ queryKey: ['alertas-descartadas'] })
    } catch {
      // Si falla, la alerta simplemente sigue apareciendo — no hace falta
      // mensaje de error para una acción de descarte, de bajo riesgo.
    } finally {
      setDescartandoId(null)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Notificaciones"
        className="relative flex items-center justify-center w-8 h-8 rounded-lg
                   text-[#5a544c] hover:bg-[#fbfaf6] transition-colors"
      >
        <Bell size={18} strokeWidth={1.75} />
        {alertasVisibles.length > 0 && (
          <span
            className="absolute top-1 right-1 min-w-[15px] h-[15px] px-[3px] rounded-full text-white
                       text-[9px] font-bold flex items-center justify-center"
            style={{ backgroundColor: '#a3293a' }}
          >
            {alertasVisibles.length > 9 ? '9+' : alertasVisibles.length}
          </span>
        )}
      </button>

      {open && (
        <AlertasModal
          alertas={alertasVisibles}
          onClose={() => setOpen(false)}
          onDescartar={handleDescartar}
          descartandoId={descartandoId}
        />
      )}
    </>
  )
}
