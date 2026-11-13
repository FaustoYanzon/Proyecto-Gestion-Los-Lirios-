'use client'

import { ESTADOS_ABIERTOS, esGerencialUp } from '@/lib/maquinariaTransiciones'
import type { OrdenDetalleResponse } from '@/lib/api/maquinaria'
import { useAuthStore } from '@/store/authStore'
import OrdenAcciones from './OrdenAcciones'
import OrdenFotos from './OrdenFotos'
import OrdenTimeline from './OrdenTimeline'
import PagoPanel from './PagoPanel'
import PresupuestoPanel from './PresupuestoPanel'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  )
}

// Actions, budgets, payment, photos and history of an order. Shared by the
// detail page and the inline expansion of the orders list.
export default function OrdenDetalleBody({ orden }: { orden: OrdenDetalleResponse }) {
  const role = useAuthStore((s) => s.user?.role)
  const esGerencial = esGerencialUp(role)
  const abierta = ESTADOS_ABIERTOS.includes(orden.estado)

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Section title="Acciones">
          {/* Remount when the saved taller/fecha/estado change so the inline inputs resync */}
          <OrdenAcciones
            key={`${orden.estado}|${orden.taller ?? ''}|${orden.fecha_estimada_entrega ?? ''}`}
            orden={orden}
          />
        </Section>

        <Section title="Presupuestos">
          <PresupuestoPanel presupuestos={orden.presupuestos} />
        </Section>

        {(esGerencial || orden.pago) && (
          <Section title="Pago">
            <PagoPanel pago={orden.pago} />
          </Section>
        )}

        <Section title="Fotos">
          <OrdenFotos ordenId={orden.id} fotos={orden.fotos} abierta={abierta} />
        </Section>
      </div>

      <div>
        <Section title="Historial">
          <OrdenTimeline eventos={orden.eventos} />
        </Section>
      </div>
    </div>
  )
}
