'use client'

import { useState } from 'react'
import { ICONS, ICON_SIZE, ICON_STROKE, type IconKey } from '@/lib/icons'
import { formatParcelaLabel } from '@/lib/api/produccion'
import type { HistorialParcelaResponse } from '@/lib/api/trazabilidad'

type EventoTipo = 'riego' | 'fitosanitario' | 'tarea' | 'cosecha' | 'campana'

interface EventoItem {
  id: string
  tipo: EventoTipo
  fecha: string
  titulo: string
  detalle: string
}

function fmt(d: string) {
  return d.split('-').reverse().join('/')
}

function construirEventos(h: HistorialParcelaResponse): EventoItem[] {
  const eventos: EventoItem[] = []

  for (const r of h.riegos) {
    eventos.push({
      id: `riego-${r.id}`,
      tipo: 'riego',
      fecha: r.fecha,
      titulo: `Riego — cabezal ${r.cabezal}, válvula ${r.valvula}`,
      detalle: `${r.mm_aplicados ?? 0} mm · ${Math.round(r.litros_aplicados).toLocaleString('es-AR')} L · ${r.responsable}`,
    })
  }
  for (const f of h.fitosanitarios) {
    eventos.push({
      id: `fito-${f.id}`,
      tipo: 'fitosanitario',
      fecha: f.fecha,
      titulo: `Fitosanitario — ${f.producto_nombre}`,
      detalle: `${f.dosis_lt_ha} L/ha · carencia ${f.dias_carencia}d (habilita ${fmt(f.fecha_habilitacion_cosecha)}) · ${f.responsable}`,
    })
  }
  for (const t of h.trabajos) {
    eventos.push({
      id: `trabajo-${t.id}`,
      tipo: 'tarea',
      fecha: t.fecha,
      titulo: `${t.tarea} — ${t.trabajador_nombre}`,
      detalle: `${t.cantidad} ${t.unidad_medida}`,
    })
  }
  for (const c of h.cosechas) {
    eventos.push({
      id: `cosecha-${c.id}`,
      tipo: 'cosecha',
      fecha: c.fecha,
      titulo: `Cosecha — ${c.kg_total.toLocaleString('es-AR')} kg`,
      detalle: `Destino: ${c.destino}${c.comprador ? ` (${c.comprador})` : ''}${c.n_remito ? ` · Remito ${c.n_remito}` : ''}`,
    })
  }
  for (const ci of h.ciclos_campana) {
    eventos.push({
      id: `campana-${ci.id}`,
      tipo: 'campana',
      fecha: ci.fecha_estado,
      titulo: `Ciclo de campaña — ${ci.estado_fenologico}`,
      detalle: ci.rendimiento_kg_ha != null ? `Rendimiento estimado: ${ci.rendimiento_kg_ha} kg/ha` : '',
    })
  }

  return eventos.sort((a, b) => b.fecha.localeCompare(a.fecha))
}

const ICONO_POR_TIPO: Record<EventoTipo, IconKey> = {
  riego: 'riego',
  fitosanitario: 'fitosanitario',
  tarea: 'tarea',
  cosecha: 'cosecha',
  campana: 'campana',
}

export default function Timeline({ historial }: { historial: HistorialParcelaResponse }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const eventos = construirEventos(historial)

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">
        {formatParcelaLabel(historial.parcela_nombre)} — {eventos.length} evento{eventos.length !== 1 ? 's' : ''}
      </h3>
      {eventos.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Sin actividad registrada en el período elegido.</p>
      ) : (
        <ul className="space-y-2 max-h-[32rem] overflow-y-auto">
          {eventos.map((ev) => {
            const Icon = ICONS[ICONO_POR_TIPO[ev.tipo]]
            const expandida = expandedId === ev.id
            return (
              <li key={ev.id} className="border border-gray-100 rounded-md p-3">
                <button
                  type="button"
                  onClick={() => setExpandedId(expandida ? null : ev.id)}
                  className="w-full flex items-start gap-3 text-left"
                >
                  <Icon size={ICON_SIZE.control} strokeWidth={ICON_STROKE} className="mt-0.5 text-[#7a1f2c] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-gray-800 truncate">{ev.titulo}</p>
                      <span className="text-xs text-gray-400 flex-shrink-0">{fmt(ev.fecha)}</span>
                    </div>
                    {expandida && ev.detalle && <p className="text-xs text-gray-500 mt-1">{ev.detalle}</p>}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
