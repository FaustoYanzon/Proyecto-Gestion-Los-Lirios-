'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import {
  deleteFotoOrden,
  getMaquinariaErrorMessage,
  uploadFotoOrden,
  type FotoOrdenResponse,
} from '@/lib/api/maquinaria'
import { esGerencialUp } from '@/lib/maquinariaTransiciones'
import { useAuthStore } from '@/store/authStore'
import ActionDialog from './ActionDialog'
import { btnSecondary } from './ordenUi'

// Mirror of MAX_FOTOS_REPORTE in backend/app/services/maquinaria.py.
export const MAX_FOTOS = 2

interface Props {
  ordenId: string
  fotos: FotoOrdenResponse[]
  // Photos can only be added/removed while the order is open.
  abierta: boolean
}

export default function OrdenFotos({ ordenId, fotos, abierta }: Props) {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<FotoOrdenResponse | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['maquinaria'] })

  const upload = useMutation({
    mutationFn: (file: File) => uploadFotoOrden(ordenId, file),
    onSuccess: () => {
      setError(null)
      refresh()
    },
    onError: (e) => setError(getMaquinariaErrorMessage(e, 'No se pudo subir la foto.')),
  })

  const remove = useMutation({
    mutationFn: (fotoId: string) => deleteFotoOrden(ordenId, fotoId),
    onSuccess: () => {
      setToDelete(null)
      setError(null)
      refresh()
    },
    onError: (e) => setError(getMaquinariaErrorMessage(e, 'No se pudo borrar la foto.')),
  })

  // Same rule as the API: gerencial+ delete any photo, the rest only their own.
  const puedeBorrar = (f: FotoOrdenResponse) =>
    abierta && (esGerencialUp(user?.role) || f.subida_por === user?.id)
  const puedeSubir = abierta && fotos.length < MAX_FOTOS

  return (
    <div className="space-y-3">
      {fotos.length === 0 ? (
        <p className="text-sm text-gray-500">Sin fotos.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {fotos.map((f) => (
            <div key={f.id} className="relative group overflow-hidden rounded-md border border-gray-200">
              <a href={f.url} target="_blank" rel="noopener noreferrer">
                {/* Cloudinary URL: plain img avoids configuring next/image remote patterns */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt="Foto de la falla" className="h-32 w-full object-cover" />
              </a>
              {puedeBorrar(f) && (
                <button
                  type="button"
                  aria-label="Borrar foto"
                  onClick={() => setToDelete(f)}
                  className="absolute right-1 top-1 rounded bg-white/90 p-1 text-red-600 shadow hover:bg-white"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {puedeSubir && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) upload.mutate(file)
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className={btnSecondary}
          >
            {upload.isPending ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            Agregar foto ({fotos.length}/{MAX_FOTOS})
          </button>
        </>
      )}

      {error && !toDelete && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>}

      {toDelete && (
        <ActionDialog
          title="Borrar foto"
          description="La foto se elimina de la orden y no se puede recuperar."
          confirmLabel="Borrar"
          danger
          pending={remove.isPending}
          error={error}
          onConfirm={() => remove.mutate(toDelete.id)}
          onClose={() => {
            setToDelete(null)
            setError(null)
          }}
        />
      )}
    </div>
  )
}
