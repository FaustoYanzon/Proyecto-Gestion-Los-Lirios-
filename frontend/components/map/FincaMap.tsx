'use client'

import dynamic from 'next/dynamic'

const Inner = dynamic(() => import('./FincaMapInner'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center bg-gray-100 w-full h-full min-h-40">
      <p className="text-sm text-gray-400">Cargando mapa...</p>
    </div>
  ),
})

export default function FincaMap({ compact, height }: { compact?: boolean; height?: string }) {
  return <Inner compact={compact} height={height} />
}
