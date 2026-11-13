import type { PagoResponse } from '@/lib/api/maquinaria'
import { fmtDate, fmtMonto } from './ordenUi'

// `monto_real` / `factura_url` are null for encargado: only show what arrived.
export default function PagoPanel({ pago }: { pago: PagoResponse | null }) {
  if (!pago) return <p className="text-sm text-gray-500">Sin pago registrado.</p>
  return (
    <div className="space-y-1">
      {pago.monto_real !== null && (
        <p className="font-mono text-sm text-gray-800">{fmtMonto(pago.monto_real)}</p>
      )}
      <p className="text-sm text-gray-600">Pago registrado el {fmtDate(pago.fecha)}</p>
      {pago.factura_url && (
        <a
          href={pago.factura_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[#7a1f2c] hover:underline"
        >
          Ver factura
        </a>
      )}
    </div>
  )
}
