'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Upload, Loader2, Snowflake, Flame, Thermometer, Sprout, Droplet, ShieldAlert, History,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import {
  importarTermografoCsv, getLotesTermografo, getLecturasTermografo, getMetricasTermografo,
} from '@/lib/api/termografo'

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtFechaHora(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtHoras(h: number): string {
  return `${h.toFixed(1)} h`
}

function KpiCard({ icon: Icon, label, value, hint, color = '#1f1a17' }: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>
  label: string
  value: string
  hint?: string
  color?: string
}) {
  return (
    <div className="bg-white rounded-[10px] border border-[#e2dbcc] p-4" style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon size={14} strokeWidth={1.75} color={color} />
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#5a544c]">{label}</p>
      </div>
      <p className="text-xl font-bold" style={{ color }}>{value}</p>
      {hint && <p className="text-xs text-[#a09584] mt-0.5">{hint}</p>}
    </div>
  )
}

function todayISO(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

const HELADA_PAGE_SIZE = 10

export default function TermografoPanel() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)
  const [historialOpen, setHistorialOpen] = useState(false)
  const [desde, setDesde] = useState(todayISO(-30))
  const [hasta, setHasta] = useState(todayISO())
  const [heladaPage, setHeladaPage] = useState(0)

  // Reset de página al cambiar el filtro de fecha -- ajuste de estado durante
  // el render (patrón documentado de React), no en un efecto, para evitar
  // el render en cascada de un setState dentro de useEffect.
  const [heladaPageFiltro, setHeladaPageFiltro] = useState(`${desde}|${hasta}`)
  if (heladaPageFiltro !== `${desde}|${hasta}`) {
    setHeladaPageFiltro(`${desde}|${hasta}`)
    setHeladaPage(0)
  }

  const { data: lotes = [] } = useQuery({
    queryKey: ['termografo-lotes'],
    queryFn: () => getLotesTermografo(),
    staleTime: 30_000,
  })

  const { data: lecturas, isLoading: lecturasLoading } = useQuery({
    queryKey: ['termografo-lecturas', desde, hasta],
    queryFn: () => getLecturasTermografo({ desde, hasta }),
    enabled: desde <= hasta,
  })

  const { data: metricas, isLoading: metricasLoading } = useQuery({
    queryKey: ['termografo-metricas', desde, hasta],
    queryFn: () => getMetricasTermografo({ desde, hasta }),
    enabled: desde <= hasta,
  })

  const chartData = useMemo(() => {
    if (!lecturas) return []
    if (lecturas.granularidad === 'cruda') {
      return (lecturas.puntos as { fecha_hora: string; temperatura: number; humedad: number }[]).map((p) => ({
        x: p.fecha_hora,
        label: fmtFechaHora(p.fecha_hora),
        temperatura: p.temperatura,
        humedad: p.humedad,
      }))
    }
    return (lecturas.puntos as { dia: string; temp_min: number; temp_max: number; temp_avg: number; humedad_avg: number }[]).map((p) => ({
      x: p.dia,
      label: fmtFecha(p.dia),
      temp_min: p.temp_min,
      temp_max: p.temp_max,
      temperatura: p.temp_avg,
      humedad: p.humedad_avg,
    }))
  }, [lecturas])

  const eventosHelada = metricas?.eventos_helada ?? []
  const heladaTotalPages = Math.max(1, Math.ceil(eventosHelada.length / HELADA_PAGE_SIZE))
  const heladaPageActual = Math.min(heladaPage, heladaTotalPages - 1)
  const eventosHeladaPagina = eventosHelada.slice(
    heladaPageActual * HELADA_PAGE_SIZE, (heladaPageActual + 1) * HELADA_PAGE_SIZE
  )

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImporting(true)
    setResultado(null)
    try {
      const res = await importarTermografoCsv(file)
      let msg = `${res.nuevos} lecturas nuevas, ${res.duplicados} ya importadas.`
      if (res.errores.length > 0) msg += ` ${res.errores.length} fila(s) con error (revisar consola).`
      if (res.errores.length > 0) console.warn('Errores al importar termógrafo:', res.errores)
      setResultado(msg)
      queryClient.invalidateQueries({ queryKey: ['termografo-lotes'] })
      queryClient.invalidateQueries({ queryKey: ['termografo-lecturas'] })
      queryClient.invalidateQueries({ queryKey: ['termografo-metricas'] })
    } catch {
      setResultado('Error al importar el archivo. Verificá el formato del CSV.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Banner de carga */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-800">Termógrafo de campo</p>
          <p className="text-xs text-gray-500">
            {lotes.length > 0
              ? `Última importación: ${fmtFechaHora(lotes[0].importado_at)} (${lotes[0].cantidad_nuevas} nuevas)`
              : 'Sin importaciones todavía'}
          </p>
          {resultado && <p className="text-xs text-[#7a1f2c] mt-1">{resultado}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHistorialOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            <History size={15} />
            Historial
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileSelected} className="hidden" />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-60 transition-colors"
          >
            {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Importar CSV
          </button>
        </div>
      </div>

      {historialOpen && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          {lotes.length === 0 ? (
            <p className="text-sm text-gray-400">Sin importaciones todavía.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {lotes.map((l) => (
                <li key={l.id} className="py-2 flex items-center justify-between text-sm">
                  <span className="text-gray-700">{l.nombre_archivo}</span>
                  <span className="text-gray-500">{fmtFechaHora(l.importado_at)}</span>
                  <span className="text-gray-500">
                    {fmtFecha(l.rango_inicio)} – {fmtFecha(l.rango_fin)}
                  </span>
                  <span className="text-[#7a1f2c] font-medium">
                    {l.cantidad_nuevas} nuevas / {l.cantidad_duplicadas} duplicadas
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Selector de rango */}
      <div className="flex flex-wrap items-center gap-3 bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <label className="text-sm text-gray-600">Desde</label>
        <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
          className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]" />
        <label className="text-sm text-gray-600">Hasta</label>
        <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
          className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#7a1f2c]" />
        {desde > hasta && <span className="text-xs text-red-600">&quot;Hasta&quot; no puede ser anterior a &quot;Desde&quot;.</span>}
      </div>

      {/* Gráfico */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <p className="text-sm font-medium text-gray-800 mb-3">
          Temperatura y humedad {lecturas?.granularidad === 'diaria' ? '(promedio diario)' : ''}
        </p>
        {lecturasLoading ? (
          <div className="h-64 flex items-center justify-center text-sm text-gray-400">Cargando...</div>
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-sm text-gray-400">Sin lecturas en este rango.</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ead8" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={30} />
              <YAxis yAxisId="temp" tick={{ fontSize: 11 }} unit="°C" width={45} />
              <YAxis yAxisId="hum" orientation="right" tick={{ fontSize: 11 }} unit="%" width={40} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="temp" type="monotone" dataKey="temperatura" name="Temperatura" stroke="#c96a1f" dot={false} strokeWidth={1.75} />
              <Line yAxisId="hum" type="monotone" dataKey="humedad" name="Humedad" stroke="#3d6b86" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* KPIs */}
      {!metricasLoading && metricas && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard icon={Snowflake} label="Horas bajo 0°C" value={fmtHoras(metricas.horas_bajo_cero)} color="#3d6b86" />
          <KpiCard icon={Flame} label="Horas sobre 30°C" value={fmtHoras(metricas.horas_sobre_30)} color="#c96a1f" />
          <KpiCard icon={Thermometer} label="Horas de frío (0-7°C)" value={fmtHoras(metricas.horas_de_frio)} color="#5a544c" />
          <KpiCard
            icon={Sprout}
            label="GDD acumulado"
            value={metricas.gdd_acumulado.toFixed(0)}
            hint={metricas.gdd_acumulado_desde_brotacion != null ? `${metricas.gdd_acumulado_desde_brotacion.toFixed(0)} desde Brotación` : undefined}
            color="#3f5c3a"
          />
          <KpiCard
            icon={Droplet}
            label="Amplitud térmica"
            value={metricas.amplitud_termica_promedio != null ? `${metricas.amplitud_termica_promedio.toFixed(1)}°C` : '—'}
            hint="promedio diario"
            color="#5a544c"
          />
          <KpiCard icon={ShieldAlert} label="Riesgo fúngico" value={fmtHoras(metricas.horas_riesgo_fungico)} hint="15-25°C + hum. >80%" color="#a3293a" />
        </div>
      )}

      {/* Eventos de helada */}
      {eventosHelada.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-sm font-medium text-gray-800 mb-3">
            Eventos de helada ({eventosHelada.length})
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="pb-2 pr-4">Inicio</th>
                  <th className="pb-2 pr-4">Fin</th>
                  <th className="pb-2 pr-4">Duración</th>
                  <th className="pb-2">Mínima</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {eventosHeladaPagina.map((ev, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-4 text-gray-700">{fmtFechaHora(ev.inicio)}</td>
                    <td className="py-1.5 pr-4 text-gray-700">{fmtFechaHora(ev.fin)}</td>
                    <td className="py-1.5 pr-4 text-gray-700">{fmtHoras(ev.duracion_horas)}</td>
                    <td className="py-1.5 font-medium text-[#3d6b86]">{ev.minima.toFixed(1)}°C</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {heladaTotalPages > 1 && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
              <button
                onClick={() => setHeladaPage((p) => Math.max(0, p - 1))}
                disabled={heladaPageActual === 0}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={14} />
                Anterior
              </button>
              <span className="text-xs text-gray-500">
                Página {heladaPageActual + 1} de {heladaTotalPages}
              </span>
              <button
                onClick={() => setHeladaPage((p) => Math.min(heladaTotalPages - 1, p + 1))}
                disabled={heladaPageActual >= heladaTotalPages - 1}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Siguiente
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
