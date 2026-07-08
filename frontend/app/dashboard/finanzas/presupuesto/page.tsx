'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { NotebookPen, Plus, Save, Loader2, Trash2 } from 'lucide-react'
import { TIPO_EGRESO_LABELS } from '@/lib/api/egresos'
import type { TipoEgreso } from '@/lib/api/egresos'
import {
  getPresupuestos, createPresupuestosBulk, updatePresupuesto, deletePresupuesto,
} from '@/lib/api/presupuestos'
import type { Presupuesto, PresupuestoCreate } from '@/lib/api/presupuestos'

// ── Constants ─────────────────────────────────────────────────────────────────

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const AVAILABLE_YEARS = [DEFAULT_YEAR - 1, DEFAULT_YEAR, DEFAULT_YEAR + 1]

// Campaign order: May .. April
const MESES_ORDER = [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4]
const MES_LABELS: Record<number, string> = {
  5: 'May', 6: 'Jun', 7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Oct',
  11: 'Nov', 12: 'Dic', 1: 'Ene', 2: 'Feb', 3: 'Mar', 4: 'Abr',
}

const TIPOS_EGRESO = Object.keys(TIPO_EGRESO_LABELS) as TipoEgreso[]

// Row identity inside the grid: egreso rows keyed by tipo, ingreso rows by cliente
type RowKey = string
const egresoKey = (tipo: string): RowKey => `egreso|${tipo}`
const ingresoKey = (cliente: string): RowKey => `ingreso|${cliente.toUpperCase().trim()}`

// drafts[rowKey][mes] = string typed by the user
type Drafts = Record<RowKey, Record<number, string>>

const fmtM = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M` : n.toLocaleString('es-AR')

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PresupuestoPage() {
  const [anio, setAnio] = useState(DEFAULT_YEAR)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [clientes, setClientes] = useState<string[]>([])
  const [nuevoCliente, setNuevoCliente] = useState('')
  const [saving, setSaving] = useState(false)
  const qc = useQueryClient()

  const { data: presupuestos = [], isLoading } = useQuery({
    queryKey: ['presupuestos', anio],
    queryFn: () => getPresupuestos({ temporada: anio, moneda: 'ars' }),
    staleTime: 60_000,
  })

  // Rebuild drafts + client rows from saved data when season changes
  useEffect(() => {
    const next: Drafts = {}
    const cli = new Set<string>()
    for (const p of presupuestos) {
      const key = p.concepto === 'egreso' ? egresoKey(p.tipo ?? '') : ingresoKey(p.cliente ?? '')
      if (p.concepto === 'ingreso' && p.cliente) cli.add(p.cliente.toUpperCase().trim())
      next[key] = { ...(next[key] ?? {}), [p.mes]: String(Number(p.monto)) }
    }
    setDrafts(next)
    setClientes(Array.from(cli).sort())
  }, [presupuestos])

  // Saved lines indexed for diffing on save
  const savedByCell = useMemo(() => {
    const map = new Map<string, Presupuesto>()
    for (const p of presupuestos) {
      const key = p.concepto === 'egreso' ? egresoKey(p.tipo ?? '') : ingresoKey(p.cliente ?? '')
      map.set(`${key}|${p.mes}`, p)
    }
    return map
  }, [presupuestos])

  const setCell = (row: RowKey, mes: number, value: string) =>
    setDrafts((d) => ({ ...d, [row]: { ...(d[row] ?? {}), [mes]: value } }))

  const cellNum = (row: RowKey, mes: number): number => {
    const v = Number(drafts[row]?.[mes])
    return Number.isFinite(v) && v > 0 ? v : 0
  }

  const rowTotal = (row: RowKey) => MESES_ORDER.reduce((s, m) => s + cellNum(row, m), 0)
  const colTotal = (rows: RowKey[], mes: number) => rows.reduce((s, r) => s + cellNum(r, mes), 0)

  const egresoRows = TIPOS_EGRESO.map(egresoKey)
  const ingresoRows = clientes.map(ingresoKey)

  // ── Save: diff drafts vs saved lines (create / update / delete) ────────────

  const saveAll = useMutation({
    mutationFn: async () => {
      setSaving(true)
      const creates: PresupuestoCreate[] = []
      const updates: { id: string; monto: number }[] = []
      const deletes: string[] = []
      const seen = new Set<string>()

      const processRow = (row: RowKey, concepto: 'ingreso' | 'egreso', tipo: string | null, cliente: string | null) => {
        for (const mes of MESES_ORDER) {
          const cellKey = `${row}|${mes}`
          const monto = cellNum(row, mes)
          const saved = savedByCell.get(cellKey)
          seen.add(cellKey)
          if (monto > 0 && !saved) {
            creates.push({
              temporada: anio, mes, concepto, moneda: 'ars', monto,
              tipo: (tipo as PresupuestoCreate['tipo']) ?? undefined,
              cliente: cliente ?? undefined,
            })
          } else if (monto > 0 && saved && Number(saved.monto) !== monto) {
            updates.push({ id: saved.id, monto })
          } else if (monto === 0 && saved) {
            deletes.push(saved.id)
          }
        }
      }

      for (const tipo of TIPOS_EGRESO) processRow(egresoKey(tipo), 'egreso', tipo, null)
      for (const cliente of clientes) processRow(ingresoKey(cliente), 'ingreso', null, cliente)

      // Saved rows whose entire row disappeared from the grid (removed client)
      for (const [cellKey, p] of savedByCell) {
        if (!seen.has(cellKey)) deletes.push(p.id)
      }

      if (creates.length > 0) await createPresupuestosBulk(creates)
      for (const u of updates) await updatePresupuesto(u.id, { monto: u.monto })
      for (const id of deletes) await deletePresupuesto(id)
      return { creates: creates.length, updates: updates.length, deletes: deletes.length }
    },
    onSettled: () => {
      setSaving(false)
      qc.invalidateQueries({ queryKey: ['presupuestos', anio] })
      qc.invalidateQueries({ queryKey: ['kpi-presup-real'] })
    },
  })

  const addCliente = () => {
    const name = nuevoCliente.toUpperCase().trim()
    if (!name || clientes.includes(name)) return
    setClientes((c) => [...c, name].sort())
    setNuevoCliente('')
  }

  const removeCliente = (cliente: string) => {
    setClientes((c) => c.filter((x) => x !== cliente))
    setDrafts((d) => {
      const next = { ...d }
      delete next[ingresoKey(cliente)]
      return next
    })
  }

  // ── Grid section renderer ───────────────────────────────────────────────────

  const renderSection = (
    title: string,
    rows: { key: RowKey; label: string; removable?: string }[],
    accent: string,
  ) => (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wide" style={{ color: accent }}>
              {title}
            </th>
            {MESES_ORDER.map((m) => (
              <th key={m} className="px-1 py-2.5 text-right text-gray-500 font-medium w-[72px]">{MES_LABELS[m]}</th>
            ))}
            <th className="px-3 py-2.5 text-right text-gray-700 font-semibold w-24">Total</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, removable }) => (
            <tr key={key} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-1.5 font-medium text-gray-700 whitespace-nowrap">{label}</td>
              {MESES_ORDER.map((m) => (
                <td key={m} className="px-0.5 py-1">
                  <input
                    type="number"
                    min={0}
                    value={drafts[key]?.[m] ?? ''}
                    placeholder="—"
                    onChange={(e) => setCell(key, m, e.target.value)}
                    className="w-full text-right rounded border border-gray-200 px-1 py-1 text-xs
                               focus:outline-none focus:ring-1 focus:ring-blue-500
                               [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </td>
              ))}
              <td className="px-3 py-1.5 text-right font-semibold text-gray-800">{fmtM(rowTotal(key))}</td>
              <td className="px-1">
                {removable && (
                  <button onClick={() => removeCliente(removable)} title="Quitar fila"
                    className="p-1 text-gray-300 hover:text-red-600">
                    <Trash2 size={13} />
                  </button>
                )}
              </td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-semibold">
            <td className="px-3 py-2 text-gray-800">TOTAL</td>
            {MESES_ORDER.map((m) => (
              <td key={m} className="px-1 py-2 text-right text-gray-800">
                {fmtM(colTotal(rows.map((r) => r.key), m))}
              </td>
            ))}
            <td className="px-3 py-2 text-right text-gray-900">
              {fmtM(rows.reduce((s, r) => s + rowTotal(r.key), 0))}
            </td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <NotebookPen size={20} className="text-gray-700" />
            <h1 className="text-2xl font-semibold text-gray-900">Presupuesto Anual</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Montos mensuales en ARS · mayo → abril · alimenta “Presupuesto vs Real” del Dashboard Finanzas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>Campaña {y}/{y + 1}</option>)}
          </select>
          <button
            onClick={() => saveAll.mutate()}
            disabled={saving || isLoading}
            className="flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white
                       disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#7a1f2c' }}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            Guardar todo
          </button>
        </div>
      </div>

      {saveAll.isSuccess && !saving && (
        <p className="text-xs font-medium text-green-700">
          Guardado: {saveAll.data.creates} nuevas, {saveAll.data.updates} actualizadas, {saveAll.data.deletes} eliminadas.
        </p>
      )}
      {saveAll.isError && (
        <p className="text-xs font-medium text-red-700">Error al guardar — revisá la consola y reintentá.</p>
      )}

      {/* Ingresos */}
      {renderSection(
        'Ingresos (por cliente)',
        clientes.map((c) => ({ key: ingresoKey(c), label: c, removable: c })),
        '#3f5c3a',
      )}
      <div className="flex items-center gap-2">
        <input
          value={nuevoCliente}
          onChange={(e) => setNuevoCliente(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addCliente() }}
          placeholder="Agregar cliente (ej: CAMPERO)"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={addCliente}
          className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          <Plus size={14} /> Agregar fila
        </button>
      </div>

      {/* Egresos */}
      {renderSection(
        'Egresos (por tipo)',
        TIPOS_EGRESO.map((t) => ({ key: egresoKey(t), label: TIPO_EGRESO_LABELS[t] })),
        '#a3293a',
      )}

      {/* Saldo mensual */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-xs">
          <tbody>
            <tr className="font-semibold">
              <td className="px-3 py-2.5 text-gray-800 uppercase tracking-wide">Saldo mensual</td>
              {MESES_ORDER.map((m) => {
                const saldo = colTotal(ingresoRows, m) - colTotal(egresoRows, m)
                return (
                  <td key={m} className="px-1 py-2.5 text-right w-[72px]"
                    style={{ color: saldo < 0 ? '#a3293a' : '#3f5c3a' }}>
                    {fmtM(saldo)}
                  </td>
                )
              })}
              <td className="px-3 py-2.5 text-right w-24" style={{
                color: ingresoRows.reduce((s, r) => s + rowTotal(r), 0) -
                       egresoRows.reduce((s, r) => s + rowTotal(r), 0) < 0 ? '#a3293a' : '#3f5c3a',
              }}>
                {fmtM(ingresoRows.reduce((s, r) => s + rowTotal(r), 0) -
                      egresoRows.reduce((s, r) => s + rowTotal(r), 0))}
              </td>
              <td className="w-8" />
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Los montos se cargan en ARS del momento de presupuestar. Para comparar campañas entre sí usá el
        dashboard en USD. Filas de ingreso = mismos nombres de cliente que usás al registrar cobros
        (el cruce es por nombre). Solo roles gerenciales pueden editar.
      </p>
    </div>
  )
}
