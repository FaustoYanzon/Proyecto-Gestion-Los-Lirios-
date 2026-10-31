'use client'

import { useState } from 'react'
import {
  Pencil, Trash2, RotateCcw, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ChevronLeft,
} from 'lucide-react'
import type { FitosanitarioResponse } from '@/lib/api/fitosanitarios'
import { usePaginatedList } from '@/lib/usePaginatedList'
import {
  formatFecha, type CarenciaParcela, type GrupoOrden, type GrupoParcela, type GrupoValvula,
} from '@/lib/fitosanitariosAgrupar'
import { claseCarencia, textoDias } from '@/components/produccion/CarenciaParrales'
import { formatNum } from '@/components/produccion/formato'

const PAGE_SIZE = 10

interface Props {
  grupos: GrupoOrden[]
  isLoading: boolean
  parcelaNombre: (id: string) => string
  carencia: Map<string, CarenciaParcela>
  // Without handlers the tree is read-only (roles without correction rights).
  onEdit?: (r: FitosanitarioResponse) => void
  onDelete?: (id: string) => void | Promise<void>
  // Only offered for valves/parcels that came from an order.
  onReactivar?: (id: string) => void | Promise<void>
  // Describes the whole valve/parcel application that Eliminar/Reactivar revert,
  // shown in the confirmation.
  alcanceAplicacion?: (r: FitosanitarioResponse) => Promise<string>
}

function ultimaFecha(fechas: string[]): string {
  return fechas.reduce((a, b) => (b > a ? b : a), '')
}

function fechasDe(valvulas: GrupoValvula[]): string[] {
  return valvulas.map((v) => v.fecha)
}

function tituloOrden(g: GrupoOrden): string {
  if (g.ordenId === null) return 'Cargas manuales (sin orden)'
  return g.orden ? g.orden.objetivo : 'Orden de otra campaña'
}

function Chevron({ abierto }: { abierto: boolean }) {
  return abierto
    ? <ChevronDown size={16} className="text-gray-400 shrink-0" />
    : <ChevronRight size={16} className="text-gray-400 shrink-0" />
}

export default function AplicacionesAgrupadas({
  grupos, isLoading, parcelaNombre, carencia, onEdit, onDelete, onReactivar, alcanceAplicacion,
}: Props) {
  const { page, setPage, totalPages, paged } = usePaginatedList(grupos, PAGE_SIZE)
  // Explicit user toggles only; anything untouched falls back to its default.
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  // Registro whose confirmation text is being prepared (order lookup in flight).
  const [preparando, setPreparando] = useState<string | null>(null)

  const abierto = (clave: string, porDefecto: boolean) => toggles[clave] ?? porDefecto
  const alternar = (clave: string, actual: boolean) => setToggles((t) => ({ ...t, [clave]: !actual }))

  async function alcanceDe(r: FitosanitarioResponse): Promise<string> {
    if (!r.orden_id || !alcanceAplicacion) return ''
    setPreparando(r.id)
    try {
      return await alcanceAplicacion(r)
    } finally {
      setPreparando(null)
    }
  }

  // `registros` are all products of the valve (or a single manual record);
  // the backend reverts the whole valve from any one of them.
  async function eliminar(registros: FitosanitarioResponse[]) {
    const r = registros[0]
    if (!onDelete || preparando) return
    const alcance = await alcanceDe(r)
    const productos = registros.map((x) => x.producto_nombre).join(', ')
    const cabecera = `Vas a eliminar la aplicación de ${productos} en ${parcelaNombre(r.parcela_id)} (${formatFecha(r.fecha)}).\n\n`
    // Typed confirmation: a stray click on the trash icon once reopened two
    // completed orders. Parent handles errors.
    const respuesta = window.prompt(
      alcance
        ? cabecera + `${alcance}\n\n` +
          'Se quitan del sistema y se devuelve el stock de cada producto. La válvula (o parcela) sale de la orden, y si era la última la orden se elimina.\n' +
          'Si lo que querés es dejarla pendiente, usá "Reactivar".\n\n' +
          'Para confirmar escribí ELIMINAR.'
        : cabecera +
          'Se quita del sistema y se devuelve el stock. Si vino de una orden, la parcela (o válvula) también sale de la orden, y si era la última la orden se elimina.\n' +
          'Si lo que querés es dejarla pendiente, usá "Reactivar".\n\n' +
          'Para confirmar escribí ELIMINAR.',
    )
    if (respuesta?.trim().toUpperCase() === 'ELIMINAR') void onDelete(r.id)
  }

  async function reactivar(registros: FitosanitarioResponse[]) {
    const r = registros[0]
    if (!onReactivar || preparando) return
    const alcance = await alcanceDe(r)
    const productos = registros.map((x) => x.producto_nombre).join(', ')
    const ok = window.confirm(
      `Vas a reactivar la aplicación de ${productos} en ${parcelaNombre(r.parcela_id)} (${formatFecha(r.fecha)}).\n\n` +
      (alcance
        ? `${alcance}\n\nSe devuelve el stock de cada producto y la aplicación vuelve a quedar pendiente en la orden.`
        : 'Se devuelve el stock y la aplicación vuelve a quedar pendiente en la orden.'),
    )
    if (ok) void onReactivar(r.id)
  }

  // Plain render helpers (not components): defining components inside a render
  // would remount the subtree on every update and lose the toggle state.
  function filaValvula(v: GrupoValvula) {
    const r0 = v.registros[0]
    const deOrden = r0.orden_id !== null
    const ocupado = v.registros.some((r) => r.id === preparando)
    return (
      <li key={v.clave} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5 border-t border-gray-100" data-testid="fila-valvula">
        <div className="w-44 shrink-0">
          <div className="text-sm font-medium text-gray-900">{v.nombre}</div>
          <div className="text-xs text-gray-500">{formatFecha(v.fecha)} · {v.responsable}</div>
        </div>
        <ul className="flex-1 min-w-[220px] flex flex-wrap gap-x-4 gap-y-1">
          {v.registros.map((r) => (
            <li key={r.id} className="flex items-center gap-1 text-sm text-gray-700">
              <span className="font-medium text-gray-800">{r.producto_nombre}</span>
              <span className="font-mono text-xs text-gray-500">{formatNum(r.dosis_por_ha)} {r.unidad ?? ''}/ha</span>
              {onEdit && (
                <button
                  onClick={() => onEdit(r)}
                  title={`Corregir ${r.producto_nombre}`}
                  aria-label={`Corregir ${r.producto_nombre}`}
                  className="p-1 rounded text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] transition-colors"
                >
                  <Pencil size={13} />
                </button>
              )}
              {onDelete && !deOrden && (
                <button
                  onClick={() => void eliminar([r])}
                  disabled={ocupado}
                  title={`Eliminar ${r.producto_nombre}`}
                  aria-label={`Eliminar ${r.producto_nombre}`}
                  className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {deOrden && (
          <div className="flex items-center gap-1 ml-auto">
            {onReactivar && (
              <button
                onClick={() => void reactivar(v.registros)}
                disabled={ocupado}
                title="Reactivar: volver a pendiente"
                aria-label="Reactivar: volver a pendiente"
                className="p-1.5 rounded-md text-gray-400 hover:text-[#7a1f2c] hover:bg-[#fbfaf6] disabled:opacity-40 transition-colors"
              >
                <RotateCcw size={15} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => void eliminar(v.registros)}
                disabled={ocupado}
                title="Eliminar"
                aria-label="Eliminar"
                className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 transition-colors"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )}
      </li>
    )
  }

  function bloqueParcela(g: GrupoOrden, p: GrupoParcela) {
    const clave = `${g.clave}|${p.parcelaId}`
    const abierta = abierto(clave, false)
    const c = carencia.get(p.parcelaId)
    return (
      <li key={p.parcelaId} className="border-t border-gray-100" data-testid="grupo-parcela">
        <button
          type="button"
          onClick={() => alternar(clave, abierta)}
          aria-expanded={abierta}
          className="w-full flex items-center gap-2 pl-8 pr-4 py-2.5 text-left hover:bg-gray-50 transition-colors"
        >
          <Chevron abierto={abierta} />
          <span className="text-sm font-medium text-gray-900">{parcelaNombre(p.parcelaId)}</span>
          <span className="text-xs text-gray-500">
            {p.valvulas.length} {p.valvulas.length === 1 ? 'aplicación' : 'aplicaciones'} · última {formatFecha(ultimaFecha(fechasDe(p.valvulas)))}
          </span>
          <span className="ml-auto">
            {c ? (
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${claseCarencia(c.dias)}`}
                title={`Habilita el ${formatFecha(c.hasta)}`}
              >
                <AlertTriangle size={12} /> Carencia {textoDias(c.dias)}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-green-700">
                <CheckCircle2 size={12} /> Habilitado
              </span>
            )}
          </span>
        </button>
        {abierta && (
          <ul className="pl-8 bg-gray-50/40">
            {p.valvulas.map(filaValvula)}
          </ul>
        )}
      </li>
    )
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm divide-y divide-gray-100">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="px-4 py-4"><div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" /></div>
        ))}
      </div>
    )
  }

  if (grupos.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-4 py-12 text-center text-gray-400">
        No hay aplicaciones registradas
      </div>
    )
  }

  const totalRegistros = grupos.reduce(
    (n, g) => n + g.parcelas.reduce((m, p) => m + p.valvulas.reduce((k, v) => k + v.registros.length, 0), 0), 0,
  )

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <ul>
        {paged.map((g, idx) => {
          const abierta = abierto(g.clave, idx === 0)
          const nValvulas = g.parcelas.reduce((n, p) => n + p.valvulas.length, 0)
          const ultima = ultimaFecha(g.parcelas.flatMap((p) => fechasDe(p.valvulas)))
          const productos = g.orden?.lineas.map((l) => l.insumo_nombre).join(', ')
          return (
            <li key={g.clave} className={idx > 0 ? 'border-t border-gray-200' : ''} data-testid="grupo-orden">
              <button
                type="button"
                onClick={() => alternar(g.clave, abierta)}
                aria-expanded={abierta}
                className="w-full flex items-start gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
              >
                <span className="mt-0.5"><Chevron abierto={abierta} /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900 truncate">{tituloOrden(g)}</span>
                  <span className="block text-xs text-gray-500">
                    {g.orden ? `Planificada ${formatFecha(g.orden.fecha_planificada)} · ` : ''}
                    {g.parcelas.length} {g.parcelas.length === 1 ? 'parcela' : 'parcelas'} · {nValvulas} {nValvulas === 1 ? 'aplicación' : 'aplicaciones'} · última {formatFecha(ultima)}
                    {productos ? ` · ${productos}` : ''}
                  </span>
                </span>
              </button>
              {abierta && (
                <ul>
                  {g.parcelas.map((p) => bloqueParcela(g, p))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>

      {totalPages > 1 && (
        <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={14} /> Anterior
          </button>
          <span className="text-xs text-gray-500">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, grupos.length)} de {grupos.length} órdenes
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-gray-600 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Siguiente <ChevronRight size={14} />
          </button>
        </div>
      )}

      <div className="px-4 py-2.5 border-t border-gray-200 bg-gray-50 text-xs text-gray-400 text-right">
        {totalRegistros} registros en {grupos.length} {grupos.length === 1 ? 'grupo' : 'grupos'}
      </div>
    </div>
  )
}
