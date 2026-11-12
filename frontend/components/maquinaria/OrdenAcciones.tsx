'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import {
  anularPago,
  getMaquinariaErrorMessage,
  resolverPresupuesto,
  transicionarOrden,
  updateOrden,
  type EstadoOrden,
  type OrdenDetalleResponse,
} from '@/lib/api/maquinaria'
import {
  ESTADOS_ABIERTOS,
  esGerencialUp,
  precondicionPendiente,
  transicionesDisponibles,
  viaPresupuesto,
  type TransicionDef,
} from '@/lib/maquinariaTransiciones'
import { formatARS } from '@/lib/theme'
import { useAuthStore } from '@/store/authStore'
import ActionDialog from './ActionDialog'
import Drawer from './Drawer'
import PagoForm from './PagoForm'
import PresupuestoForm from './PresupuestoForm'
import { btnDanger, btnPrimary, btnSecondary, inputCls, labelCls } from './ordenUi'

// Button copy per transition (keyed by "desde>hacia"; falls back to the target state).
const TRANSICION_LABELS: Record<string, string> = {
  'reportada>diagnosticada': 'Diagnosticar',
  'presupuesto_aprobado>enviada_taller': 'Enviar a taller',
  'enviada_taller>en_reparacion': 'Pasar a en reparación',
  'en_reparacion>lista_retirar': 'Marcar lista para retirar',
  'lista_retirar>pendiente_validacion': 'Pasar a validación',
  'pendiente_validacion>cerrada': 'Confirmar recepción y cerrar',
  'pendiente_validacion>en_reparacion': 'Reabrir (quedó mal)',
}

type DialogState =
  | { kind: 'transicion'; t: TransicionDef }
  | { kind: 'aprobar'; presupuestoId: string; monto: number | null }
  | { kind: 'rechazar'; presupuestoId: string }
  | { kind: 'anularPago' }
  | null

export default function OrdenAcciones({ orden }: { orden: OrdenDetalleResponse }) {
  const queryClient = useQueryClient()
  const role = useAuthStore((s) => s.user?.role)
  const esGerencial = esGerencialUp(role)
  const abierta = ESTADOS_ABIERTOS.includes(orden.estado)

  const [dialog, setDialog] = useState<DialogState>(null)
  const [drawer, setDrawer] = useState<'presupuesto' | 'pago' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [taller, setTaller] = useState(orden.taller ?? '')
  const [fecha, setFecha] = useState(orden.fecha_estimada_entrega ?? '')

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['maquinaria'] })

  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setDialog(null)
      setError(null)
      refresh()
    },
    onError: (e) => setError(getMaquinariaErrorMessage(e, 'No se pudo completar la acción.')),
  })

  const run = (fn: () => Promise<unknown>) => {
    setError(null)
    action.mutate(fn)
  }

  const transicionar = (to: EstadoOrden, nota?: string) =>
    run(() => transicionarOrden(orden.id, { a_estado: to, nota: nota || undefined }))

  const directas = transicionesDisponibles(orden.estado, role).filter(
    (t) => !viaPresupuesto(t) && t.hacia !== 'cancelada'
  )
  const cancelar = transicionesDisponibles(orden.estado, role).find((t) => t.hacia === 'cancelada')
  const pendiente = orden.presupuestos.find((p) => p.estado === 'pendiente')

  const tallerCambiado = taller.trim() !== (orden.taller ?? '')
  const fechaCambiada = fecha !== (orden.fecha_estimada_entrega ?? '')

  function onTransicionClick(t: TransicionDef) {
    // Closing and reopening are confirmed in a dialog; reopening also asks for the reason.
    if (t.requiereNota || t.hacia === 'cerrada') setDialog({ kind: 'transicion', t })
    else transicionar(t.hacia)
  }

  const dialogProps = {
    pending: action.isPending,
    error,
    onClose: () => {
      setDialog(null)
      setError(null)
    },
  }

  const hayAcciones =
    directas.length > 0 ||
    !!cancelar ||
    (esGerencial && abierta) ||
    (esGerencial && orden.estado === 'diagnosticada') ||
    (esGerencial && !!pendiente)

  return (
    <div className="space-y-4">
      {/* Taller / fecha estimada (gerencial+, open orders) */}
      {esGerencial && abierta && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Taller</label>
            <input
              type="text"
              maxLength={200}
              value={taller}
              onChange={(e) => setTaller(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Fecha estimada de entrega</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} />
          </div>
          {(tallerCambiado || fechaCambiada) && (
            <div className="sm:col-span-2">
              <button
                type="button"
                disabled={action.isPending}
                className={btnSecondary}
                onClick={() =>
                  run(() =>
                    updateOrden(orden.id, {
                      // PATCH is exclude_unset: only send what changed; empty clears.
                      ...(tallerCambiado ? { taller: taller.trim() || null } : {}),
                      ...(fechaCambiada ? { fecha_estimada_entrega: fecha || null } : {}),
                    })
                  )
                }
              >
                Guardar taller / fecha
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {esGerencial && orden.estado === 'diagnosticada' && (
          <button type="button" className={btnPrimary} onClick={() => setDrawer('presupuesto')}>
            Cargar presupuesto
          </button>
        )}

        {esGerencial && pendiente && orden.estado === 'presupuesto_pendiente' && (
          <>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => setDialog({ kind: 'aprobar', presupuestoId: pendiente.id, monto: pendiente.monto })}
            >
              Aprobar presupuesto
            </button>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => setDialog({ kind: 'rechazar', presupuestoId: pendiente.id })}
            >
              Rechazar presupuesto
            </button>
          </>
        )}

        {directas.map((t) => {
          const hint = precondicionPendiente(t, orden)
          const label = TRANSICION_LABELS[`${t.desde}>${t.hacia}`] ?? t.hacia
          return (
            <button
              key={`${t.desde}>${t.hacia}`}
              type="button"
              disabled={action.isPending || hint !== null}
              title={hint ?? undefined}
              className={t.requiereNota ? btnSecondary : btnPrimary}
              onClick={() => onTransicionClick(t)}
            >
              {action.isPending && <Loader2 size={14} className="animate-spin" />}
              {label}
            </button>
          )
        })}

        {esGerencial && orden.estado === 'lista_retirar' &&
          (orden.pago ? (
            <button type="button" className={btnSecondary} onClick={() => setDialog({ kind: 'anularPago' })}>
              Anular pago
            </button>
          ) : (
            <button type="button" className={btnPrimary} onClick={() => setDrawer('pago')}>
              Registrar pago
            </button>
          ))}

        {cancelar && (
          <button type="button" className={btnDanger} onClick={() => setDialog({ kind: 'transicion', t: cancelar })}>
            Cancelar orden
          </button>
        )}
      </div>

      {/* Hints for disabled actions (title tooltips do not exist on touch) */}
      {directas.map((t) => {
        const hint = precondicionPendiente(t, orden)
        return hint ? (
          <p key={`h-${t.desde}>${t.hacia}`} className="text-xs text-amber-700">{hint}</p>
        ) : null
      })}

      {!hayAcciones && (
        <p className="text-sm text-gray-500">No hay acciones disponibles para tu rol en este estado.</p>
      )}

      {error && !dialog && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>}

      {dialog?.kind === 'transicion' && (
        <ActionDialog
          {...dialogProps}
          title={
            dialog.t.hacia === 'cancelada'
              ? 'Cancelar orden'
              : dialog.t.hacia === 'cerrada'
                ? 'Confirmar recepción'
                : 'Reabrir orden'
          }
          description={
            dialog.t.hacia === 'cancelada'
              ? 'La orden queda cancelada y un presupuesto pendiente se rechaza. No se puede deshacer.'
              : dialog.t.hacia === 'cerrada'
                ? 'Confirmás que la máquina volvió y funciona. La orden se cierra.'
                : 'La orden vuelve a "En reparación". Contá qué quedó mal.'
          }
          confirmLabel={
            dialog.t.hacia === 'cancelada' ? 'Cancelar orden' : dialog.t.hacia === 'cerrada' ? 'Cerrar orden' : 'Reabrir'
          }
          danger={dialog.t.hacia === 'cancelada'}
          noteLabel={dialog.t.requiereNota ? 'Motivo' : undefined}
          noteRequired={dialog.t.requiereNota}
          onConfirm={(nota) => transicionar(dialog.t.hacia, nota)}
        />
      )}

      {dialog?.kind === 'aprobar' && (
        <ActionDialog
          {...dialogProps}
          title="Aprobar presupuesto"
          description={
            dialog.monto !== null
              ? `Se aprueba el presupuesto por ${formatARS(dialog.monto)}.`
              : 'Se aprueba el presupuesto.'
          }
          confirmLabel="Aprobar"
          noteLabel="Nota"
          onConfirm={(nota) =>
            run(() => resolverPresupuesto(dialog.presupuestoId, { aprobar: true, motivo: nota || undefined }))
          }
        />
      )}

      {dialog?.kind === 'rechazar' && (
        <ActionDialog
          {...dialogProps}
          title="Rechazar presupuesto"
          description="La orden vuelve a Diagnosticada para cargar un nuevo presupuesto."
          confirmLabel="Rechazar"
          danger
          noteLabel="Motivo del rechazo"
          noteRequired
          onConfirm={(nota) =>
            run(() => resolverPresupuesto(dialog.presupuestoId, { aprobar: false, motivo: nota }))
          }
        />
      )}

      {dialog?.kind === 'anularPago' && (
        <ActionDialog
          {...dialogProps}
          title="Anular pago"
          description="Se elimina el pago y también el egreso que generó. Después podés registrarlo de nuevo."
          confirmLabel="Anular pago"
          danger
          onConfirm={() => run(() => anularPago(orden.id))}
        />
      )}

      <Drawer open={drawer === 'presupuesto'} onClose={() => setDrawer(null)} title="Cargar presupuesto">
        {drawer === 'presupuesto' && (
          <PresupuestoForm
            ordenId={orden.id}
            tallerInicial={orden.taller}
            onSuccess={() => setDrawer(null)}
            onCancel={() => setDrawer(null)}
          />
        )}
      </Drawer>

      <Drawer open={drawer === 'pago'} onClose={() => setDrawer(null)} title="Registrar pago">
        {drawer === 'pago' && (
          <PagoForm ordenId={orden.id} onSuccess={() => setDrawer(null)} onCancel={() => setDrawer(null)} />
        )}
      </Drawer>
    </div>
  )
}
