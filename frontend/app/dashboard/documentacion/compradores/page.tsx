'use client'

import MaestroCrud from '@/components/alta-produccion/MaestroCrud'
import { getCompradores, createComprador, updateComprador } from '@/lib/api/altaProduccion'

export default function CompradoresPage() {
  return (
    <MaestroCrud
      titulo="Compradores"
      singular="comprador"
      queryKey="ap-compradores"
      conContacto
      fetchAll={() => getCompradores()}
      onCreate={(v) => createComprador(v)}
      onUpdate={(id, v) => updateComprador(id, v)}
    />
  )
}
