'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts'
import { Plus, Pencil, Trash2, X, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  getCosechas, createCosecha, updateCosecha, deleteCosecha,
  getCosechaTotales, getCosechaResumenPorParcela, getCosechaResumenPorSemana,
  DESTINO_LABELS, CULTIVO_LABELS, ENVASE_LABELS,
  type RegistroCosechaResponse, type RegistroCosechaCreate,
  type CultivoCosecha, type DestinoCosecha, type TipoEnvase,
} from '@/lib/api/cosecha'
import { getParcelas, formatParcelaLabel } from '@/lib/api/produccion'

// ── Constants ─────────────────────────────────────────────────────────────────

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const AVAILABLE_YEARS = [DEFAULT_YEAR - 2, DEFAULT_YEAR - 1, DEFAULT_YEAR]

const KG_FMT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

function fmtKg(n: number): string { return KG_FMT.format(n) }
function fmtTon(n: number): string { return `${(n / 1000).toFixed(1)}t` }
function fmtFecha(iso: string): string { return iso.split('-').reverse().join('/') }

function destinoBadgeCls(destino: DestinoCosecha): string {
  if (destino === 'MI' || destino === 'EXPO') return 'bg-green-100 text-green-700'
  if (destino === 'BODEGA') return 'bg-blue-100 text-blue-700'
  if (destino === 'PASAS' || destino === 'RAMA_PASA') return 'bg-amber-100 text-amber-700'
  return 'bg-gray-100 text-gray-600'
}

// ── Form types ────────────────────────────────────────────────────────────────

interface FormState {
  fecha: string
  parcela_id: string
  cultivo: CultivoCosecha
  variedad: string
  n_remito: string
  n_ciu: string
  destino: DestinoCosecha | ''
  comprador: string
  cuadrilla: string
  acarreo: string
  vehiculo_patente: string
  tipo_envase: TipoEnvase
  cantidad_envases: number | null
  peso_unitario_kg: number | null
  bruto_kg: number | null
  tara_kg: number | null
  kg_total: number | null
  observaciones: string
}

const EMPTY_FORM: FormState = {
  fecha: new Date().toISOString().split('T')[0],
  parcela_id: '',
  cultivo: 'vid',
  variedad: '',
  n_remito: '',
  n_ciu: '',
  destino: '',
  comprador: '',
  cuadrilla: '',
  acarreo: '',
  vehiculo_patente: '',
  tipo_envase: 'caja',
  cantidad_envases: null,
  peso_unitario_kg: null,
  bruto_kg: null,
  tara_kg: null,
  kg_total: null,
  observaciones: '',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, color }: { label: string; value: string; color: 'green' | 'blue' | 'amber' | 'gray' }) {
  const styles = {
    green: { bg: 'bg-green-50', border: 'border-green-100', label: 'text-green-700', value: 'text-green-800' },
    blue:  { bg: 'bg-blue-50',  border: 'border-blue-100',  label: 'text-blue-700',  value: 'text-blue-800'  },
    amber: { bg: 'bg-amber-50', border: 'border-amber-100', label: 'text-amber-700', value: 'text-amber-800' },
    gray:  { bg: 'bg-gray-50',  border: 'border-gray-200',  label: 'text-gray-600',  value: 'text-gray-800'  },
  }[color]
  return (
    <div className={`${styles.bg} rounded-lg border ${styles.border} shadow-sm p-4`}>
      <p className={`text-xs font-medium ${styles.label} uppercase tracking-wide`}>{label}</p>
      <p className={`text-2xl font-bold ${styles.value} mt-1`}>{value}</p>
    </div>
  )
}

// ── CSV Export ────────────────────────────────────────────────────────────────

function exportCSV(data: RegistroCosechaResponse[], temporada: number) {
  const headers = ['Fecha', 'Parral', 'Variedad', 'Destino', 'Cuadrilla', 'Envase', 'Cant. Envases', 'Kg Total', 'N° Remito', 'N° CIU', 'Comprador']
  const rows = data.map((r) => [
    r.fecha,
    r.parcela_nombre ?? '',
    r.variedad ?? '',
    DESTINO_LABELS[r.destino] ?? r.destino,
    r.cuadrilla ?? '',
    ENVASE_LABELS[r.tipo_envase] ?? r.tipo_envase,
    r.cantidad_envases ?? '',
    r.kg_total,
    r.n_remito ?? '',
    r.n_ciu ?? '',
    r.comprador ?? '',
  ])
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cosecha-${temporada}-${new Date().toISOString().split('T')[0]}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const COSECHA_PAGE_SIZE = 10

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CosechaPage() {
  const qc = useQueryClient()
  const [temporada, setTemporada] = useState(DEFAULT_YEAR)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [cosechaPage, setCosechaPage] = useState(1)

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: totales } = useQuery({
    queryKey: ['cosecha-totales', temporada],
    queryFn: () => getCosechaTotales(temporada),
    staleTime: 60_000,
  })

  const { data: porParcela = [] } = useQuery({
    queryKey: ['cosecha-parcelas', temporada],
    queryFn: () => getCosechaResumenPorParcela(temporada),
    staleTime: 60_000,
  })

  const { data: porSemana = [] } = useQuery({
    queryKey: ['cosecha-semanas', temporada],
    queryFn: () => getCosechaResumenPorSemana(temporada),
    staleTime: 60_000,
  })

  const { data: cosechas = [], isLoading } = useQuery({
    queryKey: ['cosecha-list', temporada],
    queryFn: () => getCosechas({ temporada, limit: 500 }),
    staleTime: 60_000,
  })

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas'],
    queryFn: getParcelas,
    staleTime: 300_000,
  })

  // ── Auto-compute kg_total ─────────────────────────────────────────────────

  useEffect(() => {
    if (form.cantidad_envases != null && form.peso_unitario_kg != null &&
        form.cantidad_envases > 0 && form.peso_unitario_kg > 0) {
      const computed = Math.round(form.cantidad_envases * form.peso_unitario_kg * 100) / 100
      setForm(f => ({ ...f, kg_total: computed }))
    }
  }, [form.cantidad_envases, form.peso_unitario_kg])

  useEffect(() => {
    if (form.bruto_kg != null && form.tara_kg != null && form.bruto_kg > form.tara_kg) {
      const computed = Math.round((form.bruto_kg - form.tara_kg) * 100) / 100
      setForm(f => ({ ...f, kg_total: computed }))
    }
  }, [form.bruto_kg, form.tara_kg])

  useEffect(() => { setCosechaPage(1) }, [cosechas])

  const totalCosechaPages = Math.max(1, Math.ceil(cosechas.length / COSECHA_PAGE_SIZE))
  const pagedCosechas = cosechas.slice((cosechaPage - 1) * COSECHA_PAGE_SIZE, cosechaPage * COSECHA_PAGE_SIZE)

  // ── Derived ───────────────────────────────────────────────────────────────

  const parcelaSorted = useMemo(
    () => [...porParcela].sort((a, b) => b.kg_total - a.kg_total),
    [porParcela]
  )
  const barHeight = Math.max(200, parcelaSorted.length * 32 + 40)
  const semanasActivas = porSemana.length

  // ── Handlers ──────────────────────────────────────────────────────────────

  function openCreate() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setShowModal(true)
  }

  function openEdit(r: RegistroCosechaResponse) {
    setForm({
      fecha: r.fecha,
      parcela_id: r.parcela_id ?? '',
      cultivo: r.cultivo,
      variedad: r.variedad ?? '',
      n_remito: r.n_remito ?? '',
      n_ciu: r.n_ciu ?? '',
      destino: r.destino,
      comprador: r.comprador ?? '',
      cuadrilla: r.cuadrilla ?? '',
      acarreo: r.acarreo ?? '',
      vehiculo_patente: r.vehiculo_patente ?? '',
      tipo_envase: r.tipo_envase,
      cantidad_envases: r.cantidad_envases,
      peso_unitario_kg: r.peso_unitario_kg,
      bruto_kg: r.bruto_kg,
      tara_kg: r.tara_kg,
      kg_total: r.kg_total,
      observaciones: r.observaciones ?? '',
    })
    setEditId(r.id)
    setShowModal(true)
  }

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['cosecha-list'] })
    qc.invalidateQueries({ queryKey: ['cosecha-totales'] })
    qc.invalidateQueries({ queryKey: ['cosecha-parcelas'] })
    qc.invalidateQueries({ queryKey: ['cosecha-semanas'] })
    qc.invalidateQueries({ queryKey: ['cosecha-mapa'] })
  }

  async function handleSubmit() {
    if (!form.destino || form.kg_total == null || form.kg_total <= 0) return
    setSaving(true)
    try {
      const payload: RegistroCosechaCreate = {
        fecha: form.fecha,
        parcela_id: form.parcela_id || null,
        cultivo: form.cultivo,
        variedad: form.variedad || null,
        n_remito: form.n_remito || null,
        n_ciu: form.n_ciu || null,
        destino: form.destino,
        comprador: form.comprador || null,
        cuadrilla: form.cuadrilla || null,
        acarreo: form.acarreo || null,
        vehiculo_patente: form.vehiculo_patente || null,
        tipo_envase: form.tipo_envase,
        cantidad_envases: form.cantidad_envases,
        peso_unitario_kg: form.peso_unitario_kg,
        bruto_kg: form.bruto_kg,
        tara_kg: form.tara_kg,
        kg_total: form.kg_total,
        observaciones: form.observaciones || null,
      }
      if (editId) {
        await updateCosecha(editId, payload)
      } else {
        await createCosecha(payload)
      }
      invalidateAll()
      setShowModal(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    await deleteCosecha(id)
    invalidateAll()
    setDeleteConfirmId(null)
  }

  const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'
  const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Registro de Cosecha</h1>
          <p className="text-sm text-gray-500 mt-0.5">Campaña {temporada}/{temporada + 1}</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={temporada}
            onChange={e => setTemporada(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]"
          >
            {AVAILABLE_YEARS.map(y => <option key={y} value={y}>{y}/{y + 1}</option>)}
          </select>
          {cosechas.length > 0 && (
            <button
              onClick={() => exportCSV(cosechas, temporada)}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              title="Exportar registros actuales a CSV"
            >
              <Download size={15} />
              CSV
            </button>
          )}
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-[#7a1f2c] text-white text-sm font-semibold rounded-lg hover:bg-[#5a1320] transition-colors"
          >
            <Plus size={16} /> Nuevo Remito
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total kg cosechados"
          value={totales ? fmtKg(totales.kg_total) : '—'}
          color="green"
        />
        <KpiCard
          label="Remitos cargados"
          value={totales ? String(totales.n_registros) : '—'}
          color="blue"
        />
        <KpiCard
          label="Parrales cosechados"
          value={totales ? String(totales.n_parcelas) : '—'}
          color="amber"
        />
        <KpiCard
          label="Semanas activas"
          value={String(semanasActivas)}
          color="gray"
        />
      </div>

      {/* Charts */}
      <div className="flex gap-5 items-start">

        {/* Kg por parcela */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5" style={{ flex: '0 0 55%' }}>
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Kg por Parral</h3>
          {parcelaSorted.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Sin datos para la campaña</div>
          ) : (
            <ResponsiveContainer width="100%" height={barHeight}>
              <BarChart
                data={parcelaSorted}
                layout="vertical"
                margin={{ top: 0, right: 60, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10 }}
                  tickFormatter={fmtTon}
                />
                <YAxis
                  type="category"
                  dataKey="parcela_nombre"
                  tick={{ fontSize: 11, fill: '#374151' }}
                  width={120}
                />
                <Tooltip
                  formatter={(v, _n, props) => [
                    `${fmtKg(Number(v))} kg (${props.payload?.n_registros ?? 0} remitos)`,
                    props.payload?.parcela_nombre ?? '',
                  ]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="kg_total" fill="#16a34a" radius={[0, 4, 4, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Kg por semana */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5" style={{ flex: '0 0 45%' }}>
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Progresión Semanal</h3>
          {porSemana.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Sin datos para la campaña</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, barHeight)}>
              <AreaChart data={porSemana} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="semana" tickFormatter={v => `S${v}`} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={fmtTon} tick={{ fontSize: 11 }} width={55} />
                <Tooltip
                  formatter={(v) => [`${fmtKg(Number(v))} kg`, 'Cosechado']}
                  labelFormatter={l => `Semana ${l}`}
                  contentStyle={{ fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="kg_total"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fill="#dbeafe"
                  fillOpacity={0.4}
                  dot={{ r: 3, fill: '#2563eb' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Registros de Remitos</h3>
          <span className="text-xs text-gray-400">{cosechas.length} registros</span>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : cosechas.length === 0 ? (
          <p className="px-5 py-10 text-center text-gray-400 text-sm">
            No hay registros para la campaña {temporada}/{temporada + 1}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Fecha</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Parral</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Variedad</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Destino</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cuadrilla</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Envase</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cant.</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Kg Total</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">N° Remito</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pagedCosechas.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtFecha(r.fecha)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.parcela_nombre ?? '–'}</td>
                    <td className="px-4 py-2.5 text-gray-500">{r.variedad ?? '–'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${destinoBadgeCls(r.destino)}`}>
                        {DESTINO_LABELS[r.destino] ?? r.destino}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{r.cuadrilla ?? '–'}</td>
                    <td className="px-4 py-2.5 text-gray-500">{ENVASE_LABELS[r.tipo_envase]}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{r.cantidad_envases ?? '–'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold font-mono text-gray-900">
                      {fmtKg(r.kg_total)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{r.n_remito ?? '–'}</td>
                    <td className="px-4 py-2.5 text-right">
                      {deleteConfirmId === r.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-red-700 font-medium">¿Eliminar?</span>
                          <button
                            onClick={() => handleDelete(r.id)}
                            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                          >Sí</button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                          >No</button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(r)}
                            className="p-1.5 rounded text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(r.id)}
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={7} className="px-4 py-2.5 text-xs font-semibold text-gray-500 text-right">TOTAL</td>
                  <td className="px-4 py-2.5 text-right font-bold font-mono text-green-700">
                    {fmtKg(cosechas.reduce((s, r) => s + r.kg_total, 0))} kg
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!isLoading && totalCosechaPages > 1 && (
          <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-sm">
            <button
              onClick={() => setCosechaPage(p => Math.max(1, p - 1))}
              disabled={cosechaPage === 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="text-xs text-gray-500">
              {(cosechaPage - 1) * COSECHA_PAGE_SIZE + 1}–{Math.min(cosechaPage * COSECHA_PAGE_SIZE, cosechas.length)} de {cosechas.length}
            </span>
            <button
              onClick={() => setCosechaPage(p => Math.min(totalCosechaPages, p + 1))}
              disabled={cosechaPage === totalCosechaPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Siguiente <ChevronRight size={14} />
            </button>
          </div>
        )}

      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900">
                {editId ? 'Editar Remito' : 'Nuevo Remito'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                <div>
                  <label className={labelCls}>Fecha <span className="text-red-500">*</span></label>
                  <input
                    type="date"
                    value={form.fecha}
                    onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Parcela</label>
                  <select
                    value={form.parcela_id}
                    onChange={e => setForm(f => ({ ...f, parcela_id: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">Sin parcela</option>
                    {parcelas.filter(p => p.is_active).map(p => (
                      <option key={p.id} value={p.id}>{formatParcelaLabel(p.nombre)}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Cultivo</label>
                  <select
                    value={form.cultivo}
                    onChange={e => setForm(f => ({ ...f, cultivo: e.target.value as CultivoCosecha }))}
                    className={inputCls}
                  >
                    {(Object.entries(CULTIVO_LABELS) as [CultivoCosecha, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Variedad</label>
                  <input
                    type="text"
                    value={form.variedad}
                    onChange={e => setForm(f => ({ ...f, variedad: e.target.value }))}
                    placeholder="Ej: Flame, Red Globe..."
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Destino <span className="text-red-500">*</span></label>
                  <select
                    value={form.destino}
                    onChange={e => setForm(f => ({ ...f, destino: e.target.value as DestinoCosecha | '' }))}
                    className={inputCls}
                  >
                    <option value="">— Seleccionar —</option>
                    {(Object.entries(DESTINO_LABELS) as [DestinoCosecha, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Tipo Envase</label>
                  <select
                    value={form.tipo_envase}
                    onChange={e => setForm(f => ({ ...f, tipo_envase: e.target.value as TipoEnvase }))}
                    className={inputCls}
                  >
                    {(Object.entries(ENVASE_LABELS) as [TipoEnvase, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>N° Remito</label>
                  <input
                    type="text"
                    value={form.n_remito}
                    onChange={e => setForm(f => ({ ...f, n_remito: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>N° CIU / Guía Única</label>
                  <input
                    type="text"
                    value={form.n_ciu}
                    onChange={e => setForm(f => ({ ...f, n_ciu: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Cantidad Envases</label>
                  <input
                    type="number"
                    step="0.5"
                    value={form.cantidad_envases ?? ''}
                    onChange={e => setForm(f => ({ ...f, cantidad_envases: e.target.value ? Number(e.target.value) : null }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Peso Unitario kg</label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.peso_unitario_kg ?? ''}
                    onChange={e => setForm(f => ({ ...f, peso_unitario_kg: e.target.value ? Number(e.target.value) : null }))}
                    placeholder="auto-calcula kg total"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Bruto kg</label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.bruto_kg ?? ''}
                    onChange={e => setForm(f => ({ ...f, bruto_kg: e.target.value ? Number(e.target.value) : null }))}
                    placeholder="para camiones/bins"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Tara kg</label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.tara_kg ?? ''}
                    onChange={e => setForm(f => ({ ...f, tara_kg: e.target.value ? Number(e.target.value) : null }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Kg Total <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.kg_total ?? ''}
                    onChange={e => setForm(f => ({ ...f, kg_total: e.target.value ? Number(e.target.value) : null }))}
                    className={inputCls}
                  />
                  <p className="text-xs text-gray-400 mt-1">Se calcula de cantidad × peso o bruto − tara</p>
                </div>

                <div>
                  <label className={labelCls}>Comprador</label>
                  <input
                    type="text"
                    value={form.comprador}
                    onChange={e => setForm(f => ({ ...f, comprador: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Cuadrilla</label>
                  <input
                    type="text"
                    value={form.cuadrilla}
                    onChange={e => setForm(f => ({ ...f, cuadrilla: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className={labelCls}>Patente Vehículo</label>
                  <input
                    type="text"
                    value={form.vehiculo_patente}
                    onChange={e => setForm(f => ({ ...f, vehiculo_patente: e.target.value }))}
                    className={inputCls}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className={labelCls}>Observaciones</label>
                  <textarea
                    rows={3}
                    value={form.observaciones}
                    onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))}
                    className={inputCls}
                  />
                </div>

              </div>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving || !form.destino || form.kg_total == null || form.kg_total <= 0}
                className="px-4 py-2 bg-[#7a1f2c] text-white rounded-lg text-sm font-semibold hover:bg-[#5a1320] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}
