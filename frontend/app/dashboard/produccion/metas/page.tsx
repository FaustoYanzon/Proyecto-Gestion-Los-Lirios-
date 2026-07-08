'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Target, Trash2, Check, Loader2 } from 'lucide-react'
import { getParcelas, VARIEDAD_LABELS } from '@/lib/api/produccion'
import {
  getMetas, createMeta, updateMeta, deleteMeta,
} from '@/lib/api/metas'
import type { MetaProduccion } from '@/lib/api/metas'

const now = new Date()
const DEFAULT_YEAR = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1
const AVAILABLE_YEARS = [DEFAULT_YEAR - 1, DEFAULT_YEAR, DEFAULT_YEAR + 1]

export default function MetasProduccionPage() {
  const [anio, setAnio] = useState(DEFAULT_YEAR)
  // Local draft of kg_plan inputs, keyed by parcela_id
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const qc = useQueryClient()

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas'],
    queryFn: getParcelas,
    staleTime: 300_000,
  })

  const { data: metas = [], isLoading } = useQuery({
    queryKey: ['metas', anio],
    queryFn: () => getMetas(anio),
    staleTime: 60_000,
  })

  // Only productive parcelas make sense here (parral/potrero, active)
  const parcelasProductivas = useMemo(
    () =>
      parcelas
        .filter((p) => p.is_active && (p.tipo === 'parral' || p.tipo === 'potrero'))
        .sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [parcelas],
  )

  const metaPorParcela = useMemo(() => {
    const map: Record<string, MetaProduccion> = {}
    for (const m of metas) map[m.parcela_id] = m
    return map
  }, [metas])

  // Reset drafts when season or saved data changes
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const m of metas) next[m.parcela_id] = String(Number(m.kg_plan))
    setDrafts(next)
  }, [metas])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['metas', anio] })
    qc.invalidateQueries({ queryKey: ['kpi-prod-parcelas'] })
  }

  const saveMutation = useMutation({
    mutationFn: async ({ parcelaId, kg }: { parcelaId: string; kg: number }) => {
      const existing = metaPorParcela[parcelaId]
      if (existing) return updateMeta(existing.id, { kg_plan: kg })
      return createMeta({ temporada: anio, parcela_id: parcelaId, kg_plan: kg })
    },
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMeta(id),
    onSuccess: invalidate,
  })

  const totalPlan = useMemo(
    () =>
      parcelasProductivas.reduce((s, p) => {
        const v = Number(drafts[p.id])
        return s + (Number.isFinite(v) ? v : 0)
      }, 0),
    [drafts, parcelasProductivas],
  )

  const handleSave = (parcelaId: string) => {
    const kg = Number(drafts[parcelaId])
    if (!Number.isFinite(kg) || kg <= 0) return
    saveMutation.mutate({ parcelaId, kg })
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Target size={20} className="text-gray-700" />
            <h1 className="text-2xl font-semibold text-gray-900">Metas de Producción</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Kg planificados por parral para la campaña — alimenta “Avance vs plan” y
            “Desvío de rinde” del Dashboard Producción
          </p>
        </div>
        <select
          value={anio}
          onChange={(e) => setAnio(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {AVAILABLE_YEARS.map((y) => <option key={y} value={y}>Campaña {y}/{y + 1}</option>)}
        </select>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total plan campaña</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{(totalPlan / 1000).toFixed(1)} t</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Parcelas con meta</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {metas.length} / {parcelasProductivas.length}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-3">Parcela</th>
              <th className="px-4 py-3">Variedad</th>
              <th className="px-4 py-3 text-right">Superficie (ha)</th>
              <th className="px-4 py-3 text-right">Kg plan</th>
              <th className="px-4 py-3 text-right">Kg/ha plan</th>
              <th className="px-4 py-3 text-center w-28">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando…</td></tr>
            ) : parcelasProductivas.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin parcelas productivas activas</td></tr>
            ) : (
              parcelasProductivas.map((p) => {
                const meta = metaPorParcela[p.id]
                const draft = drafts[p.id] ?? ''
                const kg = Number(draft)
                const kgHaPlan = Number.isFinite(kg) && kg > 0 && p.superficie_ha
                  ? Math.round(kg / p.superficie_ha)
                  : null
                const dirty = draft !== '' && (!meta || Number(meta.kg_plan) !== kg)
                return (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{p.nombre}</td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {p.variedad ? (VARIEDAD_LABELS[p.variedad] ?? p.variedad) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {p.superficie_ha != null ? p.superficie_ha.toFixed(1) : (
                        <span className="text-amber-600 text-xs font-medium">sin superficie</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        min={0}
                        step={500}
                        value={draft}
                        placeholder="—"
                        onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(p.id) }}
                        className="w-32 text-right rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {kgHaPlan != null ? kgHaPlan.toLocaleString('es-AR') : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleSave(p.id)}
                          disabled={!dirty || !Number.isFinite(kg) || kg <= 0 || saveMutation.isPending}
                          title={meta ? 'Actualizar meta' : 'Guardar meta'}
                          className="p-1.5 rounded-md border border-gray-200 text-green-700 hover:bg-green-50 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          {saveMutation.isPending
                            ? <Loader2 size={15} className="animate-spin" />
                            : <Check size={15} />}
                        </button>
                        {meta && (
                          <button
                            onClick={() => deleteMutation.mutate(meta.id)}
                            disabled={deleteMutation.isPending}
                            title="Eliminar meta"
                            className="p-1.5 rounded-md border border-gray-200 text-red-700 hover:bg-red-50 disabled:opacity-30"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                        {meta && !dirty && (
                          <span className="text-[10px] text-green-700 font-semibold uppercase">ok</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Tip: la meta razonable sale del promedio histórico del parral (Dashboard Producción →
        kg/ha por parral de campañas anteriores) ajustado por poda, edad del parral y agua disponible.
        Solo roles gerenciales pueden editar.
      </p>
    </div>
  )
}
