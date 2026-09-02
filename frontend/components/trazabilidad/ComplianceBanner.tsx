'use client'

import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import type { ComplianceFitosanitarioItem } from '@/lib/api/trazabilidad'

function fmt(d: string) {
  return d.split('-').reverse().join('/')
}

export default function ComplianceBanner({ compliance }: { compliance: ComplianceFitosanitarioItem[] }) {
  if (compliance.length === 0) return null

  const incumplidos = compliance.filter((c) => c.estado === 'incumplido')
  const pendientes = compliance.filter((c) => c.estado === 'pendiente')

  if (incumplidos.length === 0 && pendientes.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-2 text-green-800 text-sm font-medium">
        <CheckCircle2 size={15} />
        Todas las aplicaciones fitosanitarias del período respetaron su carencia.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {incumplidos.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2 text-red-800 font-medium text-sm">
            <AlertTriangle size={15} />
            {incumplidos.length} aplicación{incumplidos.length !== 1 ? 'es' : ''} cosechada{incumplidos.length !== 1 ? 's' : ''} antes de cumplir la carencia
          </div>
          <div className="flex flex-wrap gap-2">
            {incumplidos.map((c) => (
              <span key={c.fitosanitario_id} className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">
                {c.producto_nombre} ({fmt(c.fecha_aplicacion)}) — cosechado {c.cosecha_conflictiva_fecha ? fmt(c.cosecha_conflictiva_fecha) : '?'}, habilitado recién el {fmt(c.fecha_habilitacion_cosecha)}
              </span>
            ))}
          </div>
        </div>
      )}
      {pendientes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2 text-amber-800 font-medium text-sm">
            <Clock size={15} />
            {pendientes.length} aplicación{pendientes.length !== 1 ? 'es' : ''} todavía sin una cosecha registrada después
          </div>
          <div className="flex flex-wrap gap-2">
            {pendientes.map((c) => (
              <span key={c.fitosanitario_id} className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">
                {c.producto_nombre} — habilitado desde {fmt(c.fecha_habilitacion_cosecha)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
