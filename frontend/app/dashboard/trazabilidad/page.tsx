'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useContextStore, campanaToAnio } from '@/store/contextStore'
import { useAuthStore } from '@/store/authStore'
import { getParcelas, formatParcelaLabel } from '@/lib/api/produccion'
import { downloadCartaPdf, getHistorialParcela } from '@/lib/api/trazabilidad'
import MesRangeQuickButtons from '@/components/finanzas/MesRangeQuickButtons'
import ComplianceBanner from '@/components/trazabilidad/ComplianceBanner'
import ParcelaHeader from '@/components/trazabilidad/ParcelaHeader'
import Timeline from '@/components/trazabilidad/Timeline'
import RiegoPorEstado from '@/components/trazabilidad/RiegoPorEstado'
import DestinoResumen from '@/components/trazabilidad/DestinoResumen'
import FotoAlbum from '@/components/trazabilidad/FotoAlbum'
import AnalisisList from '@/components/trazabilidad/AnalisisList'

// Mismo orden/campos que finanzas/dashboard/page.tsx y MesRangeQuickButtons.tsx
// (mayo→abril) -- se repite acá en vez de compartir un modulo porque no existe
// uno hoy en el repo para esto (ver plan de la feature).
const MESES_ORDER = [5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4]
const MES_LABELS: Record<number, string> = {
  5: 'May', 6: 'Jun', 7: 'Jul', 8: 'Ago', 9: 'Set', 10: 'Oct',
  11: 'Nov', 12: 'Dic', 1: 'Ene', 2: 'Feb', 3: 'Mar', 4: 'Abr',
}

// Mismo allow-list real de require_encargado_up en el backend (incluye
// regador pese al nombre) -- ver app/api/deps.py.
const PUEDE_EDITAR_ROLES = ['super_admin', 'gerencial', 'encargado', 'regador']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

const selectCls = 'rounded-md border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]'

export default function TrazabilidadPage() {
  const user = useAuthStore((s) => s.user)
  const puedeEditar = !!user && PUEDE_EDITAR_ROLES.includes(user.role)

  const campanaGlobal = useContextStore((s) => s.campana)
  const [anio, setAnio] = useState(() => campanaToAnio(campanaGlobal))
  const [mesDesdeIdx, setMesDesdeIdx] = useState(0)
  const [mesHastaIdx, setMesHastaIdx] = useState(11)
  const [parcelaId, setParcelaId] = useState('')

  // Re-sincroniza con la campaña global elegida en el header -- mismo patrón
  // "sync on render" (no useEffect) que finanzas/dashboard/page.tsx.
  const [prevCampanaGlobal, setPrevCampanaGlobal] = useState(campanaGlobal)
  if (prevCampanaGlobal !== campanaGlobal) {
    setPrevCampanaGlobal(campanaGlobal)
    setAnio(campanaToAnio(campanaGlobal))
    setMesDesdeIdx(0)
    setMesHastaIdx(11)
  }

  const mesDesdeReal = MESES_ORDER[mesDesdeIdx]
  const mesHastaReal = MESES_ORDER[mesHastaIdx]
  const anioDesdeReal = mesDesdeReal >= 5 ? anio : anio + 1
  const anioHastaReal = mesHastaReal >= 5 ? anio : anio + 1
  const desde = `${anioDesdeReal}-${pad(mesDesdeReal)}-01`
  const hasta = `${anioHastaReal}-${pad(mesHastaReal)}-${pad(lastDayOfMonth(anioHastaReal, mesHastaReal))}`

  const { data: parcelas = [] } = useQuery({
    queryKey: ['parcelas'],
    queryFn: getParcelas,
    staleTime: 5 * 60_000,
  })
  // Filtrado a parral -- dominio de la feature (carencia, cosecha, riego por
  // válvula son todos datos de viña). Se puede ampliar a otros tipos después
  // si hace falta trazabilidad de potreros.
  const parralesActivos = parcelas.filter((p) => p.is_active && p.tipo === 'parral')
  const parcelaSeleccionada = parcelas.find((p) => p.id === parcelaId)

  const queryClient = useQueryClient()
  const { data: historial, isLoading } = useQuery({
    queryKey: ['trazabilidad-historial', parcelaId, desde, hasta],
    queryFn: () => getHistorialParcela(parcelaId, desde, hasta),
    enabled: !!parcelaId,
    staleTime: 30_000,
  })

  function invalidar() {
    queryClient.invalidateQueries({ queryKey: ['trazabilidad-historial', parcelaId] })
  }

  const [descargando, setDescargando] = useState(false)

  async function handleDescargarPdf() {
    if (!historial) return
    setDescargando(true)
    try {
      const blob = await downloadCartaPdf(parcelaId, desde, hasta)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `trazabilidad-${historial.parcela_nombre}-${desde}_${hasta}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setDescargando(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">Trazabilidad</h1>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Parcela</label>
            <select value={parcelaId} onChange={(e) => setParcelaId(e.target.value)} className={selectCls}>
              <option value="">Seleccionar...</option>
              {parralesActivos.map((p) => (
                <option key={p.id} value={p.id}>{formatParcelaLabel(p.nombre)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Desde</label>
            <select
              value={mesDesdeIdx}
              onChange={(e) => {
                const v = Number(e.target.value)
                setMesDesdeIdx(v)
                if (v > mesHastaIdx) setMesHastaIdx(v)
              }}
              className={selectCls}
            >
              {MESES_ORDER.map((m, i) => <option key={m} value={i}>{MES_LABELS[m]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Hasta</label>
            <select
              value={mesHastaIdx}
              onChange={(e) => {
                const v = Number(e.target.value)
                setMesHastaIdx(v)
                if (v < mesDesdeIdx) setMesDesdeIdx(v)
              }}
              className={selectCls}
            >
              {MESES_ORDER.map((m, i) => <option key={m} value={i}>{MES_LABELS[m]}</option>)}
            </select>
          </div>
          <MesRangeQuickButtons
            onApply={(a, d, h) => { setAnio(a); setMesDesdeIdx(d); setMesHastaIdx(h) }}
          />
          {historial && (
            <button
              onClick={handleDescargarPdf}
              disabled={descargando}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-[#7a1f2c] rounded-md hover:bg-[#5a1320] transition-colors disabled:opacity-50 ml-auto"
            >
              <Download size={15} />
              {descargando ? 'Generando...' : 'Descargar carta (PDF)'}
            </button>
          )}
        </div>
      </div>

      {!parcelaId && (
        <div className="text-sm text-gray-400 text-center py-12">
          Elegí una parcela para ver su ficha de trazabilidad.
        </div>
      )}

      {parcelaId && isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      )}

      {parcelaId && historial && (
        <>
          {parcelaSeleccionada && <ParcelaHeader parcela={parcelaSeleccionada} historial={historial} />}
          <ComplianceBanner compliance={historial.compliance_fitosanitarios} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-5">
              <Timeline historial={historial} />
              <RiegoPorEstado items={historial.cumplimiento_riego_por_estado} />
            </div>
            <div className="space-y-5">
              <DestinoResumen items={historial.resumen_destino} />
              <FotoAlbum
                parcelaId={parcelaId}
                fotos={historial.fotos}
                puedeEditar={puedeEditar}
                onChanged={invalidar}
              />
              <AnalisisList
                parcelaId={parcelaId}
                analisis={historial.analisis_calidad}
                puedeEditar={puedeEditar}
                onChanged={invalidar}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
