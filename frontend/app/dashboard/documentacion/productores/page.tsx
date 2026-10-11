'use client'

import MaestroCrud from '@/components/alta-produccion/MaestroCrud'
import { getProductores, createProductor, updateProductor } from '@/lib/api/altaProduccion'

export default function ProductoresPage() {
  return (
    <MaestroCrud
      titulo="Productores"
      singular="productor"
      queryKey="ap-productores"
      conTipo
      conContacto
      fetchAll={() => getProductores()}
      onCreate={(v) => createProductor(v)}
      onUpdate={(id, v) => updateProductor(id, v)}
    />
  )
}
