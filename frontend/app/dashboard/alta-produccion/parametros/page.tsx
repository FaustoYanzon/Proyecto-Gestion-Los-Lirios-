'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import {
  getParametros, updateParametros, errorDetail,
  type ParametrosProduccion, type ParametrosUpdate,
} from '@/lib/api/altaProduccion'
import FormError from '@/components/ui/FormError'

const inputCls = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c] disabled:bg-gray-50 disabled:text-gray-500'
const labelCls = 'block text-xs font-semibold text-gray-700 mb-1'

type Clave = keyof ParametrosProduccion

const CAMPOS: { clave: Clave; label: string; ayuda: string; entero?: boolean; opcional?: boolean }[] = [
  { clave: 'kg_por_ficha', label: 'Kg por ficha', ayuda: 'Peso de uva de una ficha.' },
  { clave: 'fichas_por_carro', label: 'Fichas por carro', ayuda: 'Cantidad de fichas que lleva un carro.', entero: true },
  { clave: 'ratio_uva_pasa', label: 'Ratio uva/pasa', ayuda: 'Kg de uva fresca necesarios por kg de pasa (4 = 4:1).' },
  { clave: 'kg_nominal_bin', label: 'Kg nominal por bin', ayuda: 'Peso de referencia de un bin de pasa.' },
  {
    clave: 'tope_bines_lote', label: 'Tope de bines por lote', entero: true, opcional: true,
    ayuda: 'El lote se cierra solo al llegar a este número. Vacío = sin tope.',
  },
]

function aTexto(p: ParametrosProduccion): Record<Clave, string> {
  return {
    kg_por_ficha: String(p.kg_por_ficha),
    fichas_por_carro: String(p.fichas_por_carro),
    ratio_uva_pasa: String(p.ratio_uva_pasa),
    kg_nominal_bin: String(p.kg_nominal_bin),
    tope_bines_lote: p.tope_bines_lote == null ? '' : String(p.tope_bines_lote),
  }
}

export default function ParametrosPage() {
  const qc = useQueryClient()
  const role = useAuthStore((s) => s.user?.role)
  // PATCH exige gerencial+; encargado solo lee.
  const puedeEditar = role === 'super_admin' || role === 'gerencial'

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['ap-parametros'],
    queryFn: getParametros,
    staleTime: 60_000,
  })

  if (isLoading) {
    return <div className="h-40 bg-gray-100 rounded animate-pulse" />
  }
  if (!data) {
    return <FormError description={errorDetail(loadError, 'No se pudieron cargar los parámetros')} />
  }
  // `key` fuerza a reiniciar el formulario cuando llegan valores nuevos del servidor.
  return (
    <ParametrosForm
      key={JSON.stringify(data)}
      actual={data}
      puedeEditar={puedeEditar}
      onSaved={() => qc.invalidateQueries({ queryKey: ['ap-parametros'] })}
    />
  )
}

function ParametrosForm({
  actual, puedeEditar, onSaved,
}: {
  actual: ParametrosProduccion
  puedeEditar: boolean
  onSaved: () => Promise<unknown>
}) {
  const [valores, setValores] = useState<Record<Clave, string>>(aTexto(actual))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const original = aTexto(actual)

  function validar(): { payload: ParametrosUpdate; error: string | null } {
    const payload: ParametrosUpdate = {}
    for (const c of CAMPOS) {
      const v = valores[c.clave].trim().replace(',', '.')
      if (v === original[c.clave]) continue
      if (v === '') {
        if (c.opcional) { payload[c.clave] = null as never; continue }
        return { payload, error: `${c.label} es obligatorio` }
      }
      const n = Number(v)
      if (!Number.isFinite(n) || n <= 0) return { payload, error: `${c.label} debe ser mayor a 0` }
      if (c.entero && !Number.isInteger(n)) return { payload, error: `${c.label} debe ser un número entero` }
      payload[c.clave] = n as never
    }
    return { payload, error: null }
  }

  const { payload, error: errorValidacion } = validar()
  const hayCambios = Object.keys(payload).length > 0

  async function guardar() {
    setError(null)
    setOk(false)
    if (errorValidacion || !hayCambios) return
    setSaving(true)
    try {
      await updateParametros(payload)
      await onSaved()
      setOk(true)
    } catch (e) {
      setError(errorDetail(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Parámetros de producción</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Constantes que usan el ingreso al pasero, los lotes y el balance de pasa.
          {!puedeEditar && ' Solo gerencial puede modificarlos.'}
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 max-w-2xl space-y-4">
        {CAMPOS.map((c) => (
          <div key={c.clave}>
            <label className={labelCls}>{c.label}</label>
            <input
              type="text"
              inputMode="decimal"
              value={valores[c.clave]}
              disabled={!puedeEditar}
              placeholder={c.opcional ? 'Sin tope' : undefined}
              onChange={(e) => { setOk(false); setValores((v) => ({ ...v, [c.clave]: e.target.value })) }}
              className={inputCls}
            />
            <p className="text-xs text-gray-400 mt-1">{c.ayuda}</p>
          </div>
        ))}

        <p className="text-xs text-gray-500 border-t border-gray-100 pt-3">
          Kg teórico por carro: {Number(valores.fichas_por_carro.replace(',', '.')) * Number(valores.kg_por_ficha.replace(',', '.')) || 0} kg
        </p>

        {(error || (hayCambios && errorValidacion)) && <FormError description={error ?? errorValidacion ?? ''} />}
        {ok && (
          <p className="flex items-center gap-1.5 text-sm text-green-700"><Check size={14} /> Parámetros guardados</p>
        )}

        {puedeEditar && (
          <div className="flex justify-end">
            <button
              onClick={guardar}
              disabled={saving || !hayCambios || !!errorValidacion}
              className="px-4 py-2 bg-[#7a1f2c] text-white rounded-lg text-sm font-semibold hover:bg-[#5a1320] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
