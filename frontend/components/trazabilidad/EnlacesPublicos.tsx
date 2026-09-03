'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Link2, Trash2 } from 'lucide-react'
import {
  listEnlacesPublicos,
  crearEnlacePublico,
  revocarEnlacePublico,
} from '@/lib/api/trazabilidad'

// Panel de gestión de enlaces públicos (QR sin login). Sólo se monta para
// super_admin / gerencial — ver PUEDE_GESTIONAR_ENLACES_ROLES en la página.

function fmtFecha(d: string) {
  return d.split('-').reverse().join('/')
}

function urlPublica(token: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/trazabilidad/publica/${token}`
}

export default function EnlacesPublicos({
  parcelaId,
  desde,
  hasta,
}: {
  parcelaId: string
  desde: string
  hasta: string
}) {
  const qc = useQueryClient()
  const [copiado, setCopiado] = useState<string | null>(null)

  const { data: enlaces = [] } = useQuery({
    queryKey: ['enlaces-publicos', parcelaId],
    queryFn: () => listEnlacesPublicos(parcelaId),
    staleTime: 30_000,
  })

  const crear = useMutation({
    mutationFn: () => crearEnlacePublico(parcelaId, desde, hasta),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enlaces-publicos', parcelaId] }),
  })

  const revocar = useMutation({
    mutationFn: (enlaceId: string) => revocarEnlacePublico(enlaceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enlaces-publicos', parcelaId] }),
  })

  async function copiar(token: string) {
    await navigator.clipboard.writeText(urlPublica(token))
    setCopiado(token)
    setTimeout(() => setCopiado((c) => (c === token ? null : c)), 1500)
  }

  const activos = enlaces.filter((e) => e.activo)
  const revocados = enlaces.filter((e) => !e.activo)
  const yaHayParaEsteRango = activos.some((e) => e.desde === desde && e.hasta === hasta)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Link2 size={15} /> Enlaces públicos (QR sin login)
        </h3>
        <button
          onClick={() => crear.mutate()}
          disabled={crear.isPending || yaHayParaEsteRango}
          className="rounded-md bg-[#7a1f2c] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#5a1320] disabled:opacity-50"
          title={yaHayParaEsteRango ? 'Ya existe un enlace activo para este período' : undefined}
        >
          {crear.isPending ? 'Generando...' : 'Generar enlace para este período'}
        </button>
      </div>

      <p className="mb-3 text-xs text-gray-400">
        El enlace queda fijo al período {fmtFecha(desde)} — {fmtFecha(hasta)} pero muestra los datos
        en vivo. Oculta responsables y compradores. Se puede revocar en cualquier momento.
      </p>

      {activos.length === 0 && revocados.length === 0 && (
        <p className="py-4 text-center text-sm text-gray-400">Todavía no hay enlaces para esta parcela.</p>
      )}

      <ul className="space-y-2">
        {activos.map((e) => (
          <li key={e.id} className="rounded-md border border-gray-200 bg-gray-50/60 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-gray-500">
                {fmtFecha(e.desde)} — {fmtFecha(e.hasta)} · creado {fmtFecha(e.created_at.slice(0, 10))}
              </span>
              <button
                onClick={() => revocar.mutate(e.id)}
                disabled={revocar.isPending}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 size={13} /> Revocar
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                readOnly
                value={urlPublica(e.token)}
                className="min-w-0 flex-1 truncate rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600"
                onFocus={(ev) => ev.currentTarget.select()}
              />
              <button
                onClick={() => copiar(e.token)}
                className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
              >
                {copiado === e.token ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                {copiado === e.token ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </li>
        ))}

        {revocados.map((e) => (
          <li
            key={e.id}
            className="flex items-center justify-between gap-2 rounded-md border border-gray-100 px-2.5 py-2 text-[11px] text-gray-400"
          >
            <span>
              {fmtFecha(e.desde)} — {fmtFecha(e.hasta)}
            </span>
            <span>Revocado{e.revoked_at ? ` el ${fmtFecha(e.revoked_at.slice(0, 10))}` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
