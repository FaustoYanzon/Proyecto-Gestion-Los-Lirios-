'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listUsers } from '@/lib/api/usuarios'
import MensajesWhatsappTable, { DescartadosWhatsappModal } from '@/components/finanzas/MensajesWhatsappTable'

export default function APagarPage() {
  const [descartadosOpen, setDescartadosOpen] = useState(false)

  const { data: usuarios = [] } = useQuery({
    queryKey: ['usuarios'],
    queryFn: listUsers,
    staleTime: 60_000,
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">A pagar</h1>
          <p className="text-sm text-gray-500 mt-1">
            Gastos informales recibidos por WhatsApp, pendientes de clasificar como egreso.
          </p>
        </div>
        <button
          onClick={() => setDescartadosOpen(true)}
          className="px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors self-start sm:self-auto"
        >
          Ver descartados
        </button>
      </div>

      <MensajesWhatsappTable />

      {descartadosOpen && (
        <DescartadosWhatsappModal usuarios={usuarios} onClose={() => setDescartadosOpen(false)} />
      )}
    </div>
  )
}
