import { ESTADO_ORDEN_LABELS, type EstadoOrden } from '@/lib/api/maquinaria'

// Normal flow of an order; "cancelada" is outside it.
export const FLUJO_ORDEN: readonly EstadoOrden[] = [
  'reportada',
  'diagnosticada',
  'presupuesto_pendiente',
  'presupuesto_aprobado',
  'enviada_taller',
  'en_reparacion',
  'lista_retirar',
  'pendiente_validacion',
  'cerrada',
]

// Same look as the "Ciclo de Campaña" bar: one small box per stage.
export default function OrdenProgreso({ estado }: { estado: EstadoOrden }) {
  if (estado === 'cancelada') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-gray-300 bg-gray-100 text-[11px] font-semibold text-gray-600">
        Cancelada
      </span>
    )
  }
  const idx = FLUJO_ORDEN.indexOf(estado)
  const cerrada = estado === 'cerrada'
  return (
    <div className="flex items-center gap-0.5 w-40" role="img" aria-label={`Etapa: ${ESTADO_ORDEN_LABELS[estado]}`}>
      {FLUJO_ORDEN.map((e, i) => (
        <div
          key={e}
          title={ESTADO_ORDEN_LABELS[e]}
          className={`h-2 flex-1 rounded-sm transition-all ${
            cerrada ? 'bg-green-500' : i === idx ? 'bg-[#7a1f2c]' : i < idx ? 'bg-gray-300' : 'bg-gray-100'
          }`}
        />
      ))}
    </div>
  )
}
