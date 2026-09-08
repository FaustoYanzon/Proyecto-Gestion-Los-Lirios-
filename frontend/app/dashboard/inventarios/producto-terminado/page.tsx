'use client'

import { PackageSearch } from 'lucide-react'

export default function ProductoTerminadoPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Producto Terminado</h1>
        <p className="text-sm text-gray-500 mt-1">Inventario de producto terminado</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col items-center justify-center py-20 text-center px-6">
        <PackageSearch size={40} className="text-gray-300 mb-3" />
        <p className="text-gray-500 font-medium">Todavía no está definido</p>
        <p className="text-sm text-gray-400 mt-1 max-w-sm">
          Acá va a vivir el inventario de producto terminado, cuando definamos cómo llevarlo.
        </p>
      </div>
    </div>
  )
}
