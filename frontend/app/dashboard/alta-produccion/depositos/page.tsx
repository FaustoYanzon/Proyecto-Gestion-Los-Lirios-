'use client'

import MaestroCrud from '@/components/alta-produccion/MaestroCrud'
import { getDepositos, createDeposito, updateDeposito } from '@/lib/api/altaProduccion'

export default function DepositosPage() {
  return (
    <MaestroCrud
      titulo="Depósitos"
      singular="depósito"
      queryKey="ap-depositos"
      fetchAll={() => getDepositos()}
      onCreate={(v) => createDeposito({ nombre: v.nombre })}
      onUpdate={(id, v) => updateDeposito(id, { nombre: v.nombre, is_active: v.is_active })}
    />
  )
}
