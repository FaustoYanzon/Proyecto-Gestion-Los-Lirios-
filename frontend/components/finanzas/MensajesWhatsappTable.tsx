'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Image as ImageIcon } from 'lucide-react'
import {
  getPendientesWhatsapp,
  clasificarComoEgreso,
  descartarMensajeWhatsapp,
  restaurarMensajeWhatsapp,
  eliminarMensajeWhatsapp,
  type MensajeWhatsappResponse,
} from '@/lib/api/whatsapp'
import { listUsers, type UserResponse } from '@/lib/api/usuarios'
import { TIPO_EGRESO_VALUES, TIPO_EGRESO_LABELS, CLASIFICACIONES_POR_TIPO, type TipoEgreso } from '@/lib/api/egresos'
import BuzonModal from '@/components/BuzonModal'

const FORMA_PAGO_VALUES = ['efectivo', 'transferencia', 'cheque', 'echeque', 'credito'] as const
const FORMA_PAGO_LABELS: Record<string, string> = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque', echeque: 'E-Cheque', credito: 'Crédito',
}
const FINCA_VALUES = ['los_mimbres', 'media_agua', 'caucete'] as const
const FINCA_LABELS: Record<string, string> = {
  los_mimbres: 'Los Mimbres', media_agua: 'Media Agua', caucete: 'Caucete',
}

const fieldCls = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

function formatMonto(monto: number): string {
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(monto)
}

function formatFecha(dateStr: string): string {
  return new Date(dateStr).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function usuarioLabel(userId: string, usuarios: UserResponse[]): string {
  return usuarios.find((u) => u.id === userId)?.full_name ?? userId
}

// ─── Inline classify form ─────────────────────────────────────────────────────

function ClasificarMensajeInline({ mensaje, onDone }: { mensaje: MensajeWhatsappResponse; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [tipo, setTipo] = useState<TipoEgreso | ''>('')
  const [clasificacion, setClasificacion] = useState('')
  const [finca, setFinca] = useState('')
  const [formaPago, setFormaPago] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clasificaciones = tipo ? CLASIFICACIONES_POR_TIPO[tipo] ?? [] : []

  async function handleSubmit() {
    if (!tipo || !clasificacion || !finca || !formaPago) {
      setError('Completá tipo, clasificación, finca y forma de pago.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await clasificarComoEgreso(mensaje.id, {
        tipo,
        clasificacion,
        finca: finca as 'los_mimbres' | 'media_agua' | 'caucete',
        forma_pago: formaPago as 'efectivo' | 'transferencia' | 'cheque' | 'echeque' | 'credito',
        descripcion: descripcion || undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['whatsapp-pendientes'] })
      queryClient.invalidateQueries({ queryKey: ['egresos'] })
      onDone()
    } catch {
      setError('No se pudo clasificar. Intentá de nuevo.')
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-2 p-3 bg-gray-50 rounded-md border border-gray-200 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <label className={labelCls}>Tipo</label>
          <select value={tipo} onChange={(e) => { setTipo(e.target.value as TipoEgreso); setClasificacion('') }} className={fieldCls}>
            <option value="">Seleccionar...</option>
            {TIPO_EGRESO_VALUES.map((t) => <option key={t} value={t}>{TIPO_EGRESO_LABELS[t]}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Clasificación</label>
          <select value={clasificacion} onChange={(e) => setClasificacion(e.target.value)} className={fieldCls} disabled={!tipo}>
            <option value="">Seleccionar...</option>
            {clasificaciones.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Finca</label>
          <select value={finca} onChange={(e) => setFinca(e.target.value)} className={fieldCls}>
            <option value="">Seleccionar...</option>
            {FINCA_VALUES.map((f) => <option key={f} value={f}>{FINCA_LABELS[f]}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Forma de Pago</label>
          <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className={fieldCls}>
            <option value="">Seleccionar...</option>
            {FORMA_PAGO_VALUES.map((f) => <option key={f} value={f}>{FORMA_PAGO_LABELS[f]}</option>)}
          </select>
        </div>
      </div>
      <input
        type="text"
        placeholder={`Descripción (opcional, por defecto: ${mensaje.descripcion})`}
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        className={fieldCls}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onDone} className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-white">
          Cancelar
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60"
        >
          {submitting && <Loader2 size={12} className="animate-spin" />}
          Confirmar
        </button>
      </div>
    </div>
  )
}

// ─── Descartados modal ─────────────────────────────────────────────────────────

export function DescartadosWhatsappModal({ usuarios, onClose }: { usuarios: UserResponse[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [restaurandoId, setRestaurandoId] = useState<string | null>(null)
  const [eliminandoId, setEliminandoId] = useState<string | null>(null)

  const { data: descartados = [], isLoading } = useQuery({
    queryKey: ['whatsapp-descartados'],
    queryFn: () => getPendientesWhatsapp('descartado'),
  })

  async function handleRestaurar(id: string) {
    setRestaurandoId(id)
    try {
      await restaurarMensajeWhatsapp(id)
      queryClient.invalidateQueries({ queryKey: ['whatsapp-descartados'] })
      queryClient.invalidateQueries({ queryKey: ['whatsapp-pendientes'] })
    } finally {
      setRestaurandoId(null)
    }
  }

  async function handleEliminar(id: string) {
    if (!window.confirm('¿Borrar definitivamente este mensaje?')) return
    setEliminandoId(id)
    try {
      await eliminarMensajeWhatsapp(id)
      queryClient.invalidateQueries({ queryKey: ['whatsapp-descartados'] })
    } finally {
      setEliminandoId(null)
    }
  }

  return (
    <BuzonModal title={`Mensajes de WhatsApp descartados (${descartados.length})`} onClose={onClose}>
      {isLoading ? (
        <p className="text-sm text-gray-400 px-2 py-4">Cargando...</p>
      ) : descartados.length === 0 ? (
        <p className="text-sm text-gray-400 px-2 py-4">No hay mensajes descartados.</p>
      ) : (
        <ul className="space-y-2">
          {descartados.map((m) => (
            <li key={m.id} className="border border-gray-100 rounded-md p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-800">{formatFecha(m.recibido_at)}</span>
                  <span className="text-xs text-gray-500">{usuarioLabel(m.user_id, usuarios)}</span>
                </div>
                <p className="text-sm text-gray-600 truncate">{m.descripcion}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="text-sm font-mono text-gray-800">$ {formatMonto(m.monto)}</div>
                <button
                  onClick={() => handleEliminar(m.id)}
                  disabled={eliminandoId === m.id}
                  title="Borrar definitivamente"
                  className="px-3 py-1 text-xs font-medium text-gray-500 hover:text-red-600 transition-colors disabled:opacity-60"
                >
                  Borrar
                </button>
                <button
                  onClick={() => handleRestaurar(m.id)}
                  disabled={restaurandoId === m.id}
                  className="px-3 py-1 text-xs font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] disabled:opacity-60"
                >
                  Restaurar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </BuzonModal>
  )
}

// ─── Main table ────────────────────────────────────────────────────────────────

export default function MensajesWhatsappTable() {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [descartandoId, setDescartandoId] = useState<string | null>(null)

  const { data: pendientes = [], isLoading } = useQuery({
    queryKey: ['whatsapp-pendientes'],
    queryFn: () => getPendientesWhatsapp('pendiente'),
    staleTime: 30_000,
  })

  const { data: usuarios = [] } = useQuery({
    queryKey: ['usuarios'],
    queryFn: listUsers,
    staleTime: 60_000,
  })

  async function handleDescartar(id: string) {
    if (!window.confirm('¿Descartar este mensaje?')) return
    setDescartandoId(id)
    try {
      await descartarMensajeWhatsapp(id)
      queryClient.invalidateQueries({ queryKey: ['whatsapp-pendientes'] })
    } finally {
      setDescartandoId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
        <p className="text-sm text-gray-400">Cargando...</p>
      </div>
    )
  }

  if (pendientes.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-10 text-center text-gray-400">
        No hay gastos pendientes de clasificar. Los mensajes de WhatsApp que lleguen van a aparecer acá.
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <ul className="divide-y divide-gray-100">
        {pendientes.map((m) => (
          <li key={m.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-800">{formatFecha(m.recibido_at)}</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                    {usuarioLabel(m.user_id, usuarios)}
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${m.pagado ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                    {m.pagado ? 'Pagado' : 'No pagado'}
                  </span>
                  {m.foto_url && (
                    <a
                      href={m.foto_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[#7a1f2c] hover:underline"
                    >
                      <ImageIcon size={12} /> Ver foto
                    </a>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-1">{m.descripcion}</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">&ldquo;{m.texto_original}&rdquo;</p>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm font-mono text-gray-800">$ {formatMonto(m.monto)}</div>
              </div>
            </div>

            {expandedId === m.id ? (
              <ClasificarMensajeInline mensaje={m} onDone={() => setExpandedId(null)} />
            ) : (
              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => handleDescartar(m.id)}
                  disabled={descartandoId === m.id}
                  className="px-3 py-1 text-xs font-medium text-gray-500 hover:text-red-600 transition-colors"
                >
                  Descartar
                </button>
                <button
                  onClick={() => setExpandedId(m.id)}
                  className="px-3 py-1 text-xs font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320]"
                >
                  Clasificar
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
