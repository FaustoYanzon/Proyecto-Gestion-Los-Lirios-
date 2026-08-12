'use client'

import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Upload, FileWarning, Loader2 } from 'lucide-react'
import {
  importarArcaCsv,
  getPendientesArca,
  clasificarComoEgreso,
  clasificarComoIngreso,
  descartarComprobanteArca,
  type TipoArchivoArca,
  type ComprobanteArcaResponse,
} from '@/lib/api/arca'
import { TIPO_EGRESO_VALUES, TIPO_EGRESO_LABELS, CLASIFICACIONES_POR_TIPO, type TipoEgreso } from '@/lib/api/egresos'
import { DESTINO_INGRESO_VALUES, DESTINO_INGRESO_LABELS } from '@/lib/api/ingresos'
import BuzonModal from '@/components/BuzonModal'

const FORMA_PAGO_VALUES = ['efectivo', 'transferencia', 'cheque', 'echeque', 'credito'] as const
const FORMA_PAGO_LABELS: Record<string, string> = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque', echeque: 'E-Cheque', credito: 'Crédito',
}
const FINCA_VALUES = ['los_mimbres', 'media_agua', 'caucete'] as const
const FINCA_LABELS: Record<string, string> = {
  los_mimbres: 'Los Mimbres', media_agua: 'Media Agua', caucete: 'Caucete',
}

function formatMonto(monto: number): string {
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(monto)
}

function formatFecha(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}

const fieldCls = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] focus:border-transparent'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

// ─── Inline classify forms ───────────────────────────────────────────────────

function ClasificarEgresoInline({ comprobante, onDone }: { comprobante: ComprobanteArcaResponse; onDone: () => void }) {
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
      await clasificarComoEgreso(comprobante.id, {
        tipo,
        clasificacion,
        finca: finca as 'los_mimbres' | 'media_agua' | 'caucete',
        forma_pago: formaPago as 'efectivo' | 'transferencia' | 'cheque' | 'echeque' | 'credito',
        descripcion: descripcion || undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['arca-pendientes', 'recibido'] })
      queryClient.invalidateQueries({ queryKey: ['egresos'] })
      queryClient.invalidateQueries({ queryKey: ['arca-lotes'] })
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
        placeholder={`Descripción (opcional, por defecto: ${comprobante.denominacion_contraparte})`}
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

function ClasificarIngresoInline({ comprobante, onDone }: { comprobante: ComprobanteArcaResponse; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [destino, setDestino] = useState('')
  const [comprador, setComprador] = useState(comprobante.denominacion_contraparte)
  const [finca, setFinca] = useState('')
  const [formaPago, setFormaPago] = useState('')
  const [cuentaDestino, setCuentaDestino] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!destino || !finca || !formaPago) {
      setError('Completá destino, finca y forma de pago.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await clasificarComoIngreso(comprobante.id, {
        destino,
        comprador: comprador || undefined,
        finca: finca as 'los_mimbres' | 'media_agua' | 'caucete',
        forma_pago: formaPago as 'efectivo' | 'transferencia' | 'cheque' | 'echeque' | 'credito',
        cuenta_destino: cuentaDestino || undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['arca-pendientes', 'emitido'] })
      queryClient.invalidateQueries({ queryKey: ['ingresos'] })
      queryClient.invalidateQueries({ queryKey: ['arca-lotes'] })
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
          <label className={labelCls}>Destino</label>
          <select value={destino} onChange={(e) => setDestino(e.target.value)} className={fieldCls}>
            <option value="">Seleccionar...</option>
            {DESTINO_INGRESO_VALUES.map((d) => <option key={d} value={d}>{DESTINO_INGRESO_LABELS[d]}</option>)}
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
        <div>
          <label className={labelCls}>Cuenta destino <span className="text-gray-400 font-normal">(opcional)</span></label>
          <input type="text" value={cuentaDestino} onChange={(e) => setCuentaDestino(e.target.value)} className={fieldCls} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Comprador</label>
        <input type="text" value={comprador} onChange={(e) => setComprador(e.target.value)} className={fieldCls} />
      </div>
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

// ─── Pendientes modal ─────────────────────────────────────────────────────────

function PendientesModal({ tipoArchivo, onClose }: { tipoArchivo: TipoArchivoArca; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [descartandoId, setDescartandoId] = useState<string | null>(null)

  const { data: pendientes = [], isLoading } = useQuery({
    queryKey: ['arca-pendientes', tipoArchivo],
    queryFn: () => getPendientesArca(tipoArchivo),
  })

  async function handleDescartar(id: string) {
    if (!window.confirm('¿Descartar este comprobante? No se va a poder reimportar desde el mismo CSV.')) return
    setDescartandoId(id)
    try {
      await descartarComprobanteArca(id)
      queryClient.invalidateQueries({ queryKey: ['arca-pendientes', tipoArchivo] })
    } finally {
      setDescartandoId(null)
    }
  }

  return (
    <BuzonModal title={`Comprobantes ARCA pendientes de clasificar (${pendientes.length})`} onClose={onClose}>
      {isLoading ? (
        <p className="text-sm text-gray-400 px-2 py-4">Cargando...</p>
      ) : pendientes.length === 0 ? (
        <p className="text-sm text-gray-400 px-2 py-4">No hay comprobantes pendientes.</p>
      ) : (
        <ul className="space-y-2">
          {pendientes.map((c) => (
            <li key={c.id} className="border border-gray-100 rounded-md p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-800">{formatFecha(c.fecha_emision)}</span>
                    <span className="text-xs text-gray-500">{c.tipo_comprobante_desc}</span>
                    {c.es_nota_credito && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700">
                        <FileWarning size={11} /> Nota de crédito
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 truncate">{c.denominacion_contraparte}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-mono text-gray-800">
                    {c.moneda.toUpperCase()} {formatMonto(c.imp_total)}
                  </div>
                  <div className="text-[11px] text-gray-400">IVA {formatMonto(c.total_iva)}</div>
                </div>
              </div>

              {expandedId === c.id ? (
                tipoArchivo === 'recibido' ? (
                  <ClasificarEgresoInline comprobante={c} onDone={() => setExpandedId(null)} />
                ) : (
                  <ClasificarIngresoInline comprobante={c} onDone={() => setExpandedId(null)} />
                )
              ) : (
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => handleDescartar(c.id)}
                    disabled={descartandoId === c.id}
                    className="px-3 py-1 text-xs font-medium text-gray-500 hover:text-red-600 transition-colors"
                  >
                    Descartar
                  </button>
                  <button
                    onClick={() => setExpandedId(c.id)}
                    className="px-3 py-1 text-xs font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320]"
                  >
                    Clasificar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </BuzonModal>
  )
}

// ─── Banner (entry point) ─────────────────────────────────────────────────────

export default function ComprobantesArcaPanel({
  tipoArchivo, titulo,
}: {
  tipoArchivo: TipoArchivoArca
  titulo: string
}) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)

  const { data: pendientes = [] } = useQuery({
    queryKey: ['arca-pendientes', tipoArchivo],
    queryFn: () => getPendientesArca(tipoArchivo),
    staleTime: 30_000,
  })

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setResultado(null)
    try {
      const res = await importarArcaCsv(tipoArchivo, file)
      let msg = `${res.nuevos} nuevos, ${res.duplicados} ya importados.`
      if (res.errores.length > 0) msg += ` ${res.errores.length} fila(s) con error (revisar consola).`
      if (res.errores.length > 0) console.warn('Errores al importar ARCA:', res.errores)
      setResultado(msg)
      queryClient.invalidateQueries({ queryKey: ['arca-pendientes', tipoArchivo] })
      queryClient.invalidateQueries({ queryKey: ['arca-lotes'] })
    } catch {
      setResultado('Error al importar el archivo. Verificá el formato del CSV.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium text-gray-800">{titulo}</p>
        <p className="text-xs text-gray-500">
          {pendientes.length > 0
            ? `${pendientes.length} comprobante(s) pendiente(s) de clasificar`
            : 'Sin comprobantes pendientes'}
        </p>
        {resultado && <p className="text-xs text-[#7a1f2c] mt-1">{resultado}</p>}
      </div>
      <div className="flex items-center gap-2">
        {pendientes.length > 0 && (
          <button
            onClick={() => setModalOpen(true)}
            className="px-3 py-2 text-sm font-medium text-[#7a1f2c] border border-[#7a1f2c] rounded-md hover:bg-[#fbfaf6] transition-colors"
          >
            Ver pendientes
          </button>
        )}
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileSelected} className="hidden" />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-60 transition-colors"
        >
          {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          Importar CSV ARCA
        </button>
      </div>

      {modalOpen && <PendientesModal tipoArchivo={tipoArchivo} onClose={() => setModalOpen(false)} />}
    </div>
  )
}
