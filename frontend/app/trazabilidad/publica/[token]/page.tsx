'use client'

import { use, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import {
  getHistorialPublico,
  downloadCartaPdfPublica,
  COMPLIANCE_ESTADO_LABELS,
  ORIGEN_ANALISIS_LABELS,
  ESTADO_SANITARIO_LABELS,
} from '@/lib/api/trazabilidad'
import RiegoPorEstado from '@/components/trazabilidad/RiegoPorEstado'
import DestinoResumen from '@/components/trazabilidad/DestinoResumen'

// Página pública (QR, sin login): fuera de /dashboard, no toca authStore.
// La mira un comprador con el papel de la carta en la mano, así que es
// mobile-first y muestra sólo lo que el backend ya curó (sin responsable de
// riego/fito ni comprador de cosecha).

function fmtFecha(d: string) {
  return d.split('-').reverse().join('/')
}

const ESTADO_ROW: Record<string, string> = {
  cumplido: 'bg-green-50/60',
  incumplido: 'bg-red-50/60',
  pendiente: 'bg-amber-50/60',
}
const ESTADO_TEXT: Record<string, string> = {
  cumplido: 'text-green-700',
  incumplido: 'text-red-700',
  pendiente: 'text-amber-700',
}

function Card({ valor, label }: { valor: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
      <div className="text-lg font-semibold text-[#7a1f2c]">{valor}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
    </div>
  )
}

function Dato({ label, valor }: { label: string; valor: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-sm text-gray-800">{valor}</p>
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">{titulo}</h2>
      {children}
    </section>
  )
}

export default function TrazabilidadPublicaPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)
  const [descargando, setDescargando] = useState(false)

  const { data: h, isLoading, isError } = useQuery({
    queryKey: ['trazabilidad-publica', token],
    queryFn: () => getHistorialPublico(token),
    retry: false,
    staleTime: 60_000,
  })

  async function handleDescargarPdf() {
    setDescargando(true)
    try {
      const blob = await downloadCartaPdfPublica(token)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `trazabilidad-${h?.parcela_nombre ?? token}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setDescargando(false)
    }
  }

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[#faf8f5] px-4 py-10">
        <div className="mx-auto max-w-3xl space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </main>
    )
  }

  if (isError || !h) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#faf8f5] px-6">
        <div className="max-w-md rounded-lg border border-gray-200 bg-white p-8 text-center">
          <img src="/logo.svg" alt="Los Lirios SA" className="mx-auto mb-4 h-10 w-auto" />
          <h1 className="text-lg font-semibold text-[#1f1a17]">Este enlace no está disponible</h1>
          <p className="mt-2 text-sm text-gray-500">
            El enlace de trazabilidad no existe o fue dado de baja. Si lo recibiste en un
            documento impreso, pedí a Los Lirios SA una versión vigente.
          </p>
        </div>
      </main>
    )
  }

  const r = h.resumen

  return (
    <main className="min-h-screen bg-[#faf8f5] px-4 py-8 sm:py-10">
      <div className="mx-auto max-w-3xl space-y-5">
        {/* Header */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="Los Lirios SA" className="h-9 w-auto sm:h-11" />
              <div>
                <h1 className="text-lg font-semibold text-[#1f1a17] sm:text-xl">
                  Carta de Trazabilidad
                </h1>
                <p className="text-xs text-gray-500">
                  Período {fmtFecha(h.desde)} — {fmtFecha(h.hasta)}
                </p>
              </div>
            </div>
            <div className="hidden text-right text-[11px] leading-tight text-gray-500 sm:block">
              <strong className="text-gray-700">{h.empresa.razon_social}</strong>
              <br />
              CUIT {h.empresa.cuit}
              <br />
              {h.empresa.domicilio}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-4">
            <Dato label="Parcela" valor={h.parcela_nombre} />
            <Dato label="Tipo" valor={h.parcela_tipo} />
            <Dato label="Variedad" valor={h.parcela_variedad ?? '—'} />
            <Dato
              label="Superficie"
              valor={h.parcela_superficie_ha != null ? `${h.parcela_superficie_ha.toFixed(2)} ha` : '—'}
            />
            <Dato label="Finca" valor={h.parcela_finca ?? '—'} />
            <Dato label="Tipo de riego" valor={h.parcela_tipo_riego ?? '—'} />
            <Dato label="Cobertura de invierno" valor={h.parcela_cobertura_invierno ?? 'No'} />
            <Dato
              label="Ubicación"
              valor={
                h.parcela_centroide ? (
                  <a
                    href={`https://www.google.com/maps?q=${h.parcela_centroide.lat},${h.parcela_centroide.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#7a1f2c] hover:underline"
                  >
                    Ver en el mapa
                  </a>
                ) : (
                  '—'
                )
              }
            />
          </div>

          {h.parcela_variedad_descripcion && (
            <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
              {h.parcela_variedad_descripcion}
            </p>
          )}

          <button
            onClick={handleDescargarPdf}
            disabled={descargando}
            className="mt-4 flex items-center gap-2 rounded-md bg-[#7a1f2c] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#5a1320] disabled:opacity-50"
          >
            <Download size={15} />
            {descargando ? 'Generando...' : 'Descargar carta (PDF)'}
          </button>
        </div>

        {/* Resumen ejecutivo */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card
            valor={`${r.kg_total.toLocaleString('es-AR')} kg`}
            label={
              r.meta_produccion_kg
                ? `Cosechado — ${r.pct_meta_produccion}% del plan`
                : 'Cosechado'
            }
          />
          <Card
            valor={`${r.mm_riego_total} mm`}
            label={
              r.pct_objetivo_riego != null
                ? `Riego — ${r.pct_objetivo_riego}% del objetivo anual`
                : 'Riego aplicado'
            }
          />
          <Card
            valor={r.horas_de_frio != null ? `${r.horas_de_frio} h` : '—'}
            label="Horas de frío del período"
          />
          <Card
            valor={`${r.fitos_cumplidos} / ${r.fitos_incumplidos}`}
            label="Aplicaciones cumplidas / incumplidas"
          />
        </div>

        {/* Manejo fitosanitario */}
        <Seccion titulo="Manejo fitosanitario y carencia">
          {h.fitosanitarios.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">
              Sin aplicaciones fitosanitarias en el período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500">
                    <th className="py-1.5 pr-2 font-medium">Fecha</th>
                    <th className="py-1.5 pr-2 font-medium">Producto</th>
                    <th className="py-1.5 pr-2 font-medium text-right">Dosis L/ha</th>
                    <th className="py-1.5 pr-2 font-medium text-right">Carencia</th>
                    <th className="py-1.5 pr-2 font-medium">Habilita cosecha</th>
                    <th className="py-1.5 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {h.fitosanitarios.map((f, i) => (
                    <tr key={i} className={`border-b border-gray-50 ${ESTADO_ROW[f.estado_compliance]}`}>
                      <td className="py-1.5 pr-2 text-gray-500">{fmtFecha(f.fecha)}</td>
                      <td className="py-1.5 pr-2 text-gray-800">{f.producto_nombre}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700">{f.dosis_lt_ha}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700">{f.dias_carencia} d</td>
                      <td className="py-1.5 pr-2 text-gray-500">{fmtFecha(f.fecha_habilitacion_cosecha)}</td>
                      <td className={`py-1.5 font-medium ${ESTADO_TEXT[f.estado_compliance]}`}>
                        {COMPLIANCE_ESTADO_LABELS[f.estado_compliance]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Seccion>

        <RiegoPorEstado items={h.cumplimiento_riego_por_estado} />
        <DestinoResumen items={h.resumen_destino} />

        {/* Tareas resumen */}
        <Seccion titulo="Tareas realizadas (resumen)">
          {h.tareas_resumen.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Sin tareas registradas en el período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500">
                    <th className="py-1.5 pr-2 font-medium">Tarea</th>
                    <th className="py-1.5 pr-2 font-medium">Desde</th>
                    <th className="py-1.5 pr-2 font-medium">Hasta</th>
                    <th className="py-1.5 font-medium text-right">Registros</th>
                  </tr>
                </thead>
                <tbody>
                  {h.tareas_resumen.map((t, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1.5 pr-2 text-gray-800">{t.tarea}</td>
                      <td className="py-1.5 pr-2 text-gray-500">{fmtFecha(t.fecha_inicio)}</td>
                      <td className="py-1.5 pr-2 text-gray-500">{fmtFecha(t.fecha_fin)}</td>
                      <td className="py-1.5 text-right text-gray-700">{t.registros}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Seccion>

        {/* Análisis de calidad */}
        <Seccion titulo="Análisis de calidad">
          {h.analisis_calidad.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">Sin análisis de calidad en el período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-gray-500">
                    <th className="py-1.5 pr-2 font-medium">Fecha</th>
                    <th className="py-1.5 pr-2 font-medium">Origen</th>
                    <th className="py-1.5 pr-2 font-medium text-right">Brix</th>
                    <th className="py-1.5 pr-2 font-medium text-right">Acidez</th>
                    <th className="py-1.5 pr-2 font-medium text-right">pH</th>
                    <th className="py-1.5 pr-2 font-medium">Sanidad</th>
                    <th className="py-1.5 font-medium">Informe</th>
                  </tr>
                </thead>
                <tbody>
                  {h.analisis_calidad.map((a, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1.5 pr-2 text-gray-500">{fmtFecha(a.fecha)}</td>
                      <td className="py-1.5 pr-2 text-gray-700">{ORIGEN_ANALISIS_LABELS[a.origen]}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700">{a.brix ?? '—'}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700">{a.acidez ?? '—'}</td>
                      <td className="py-1.5 pr-2 text-right text-gray-700">{a.ph ?? '—'}</td>
                      <td className="py-1.5 pr-2 text-gray-700">
                        {a.estado_sanitario ? ESTADO_SANITARIO_LABELS[a.estado_sanitario] : '—'}
                      </td>
                      <td className="py-1.5">
                        {a.informe_url ? (
                          <a
                            href={a.informe_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#7a1f2c] hover:underline"
                          >
                            Ver
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Seccion>

        {/* Fotos */}
        {h.fotos.length > 0 && (
          <Seccion titulo="Fotos del período">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {h.fotos.map((f, i) => (
                <a
                  key={i}
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block overflow-hidden rounded-md border border-gray-200"
                >
                  <img src={f.url} alt={f.descripcion ?? f.categoria} className="h-32 w-full object-cover" />
                  <div className="px-2 py-1 text-[11px] text-gray-500">
                    {f.categoria} — {fmtFecha(f.fecha)}
                  </div>
                </a>
              ))}
            </div>
          </Seccion>
        )}

        <p className="pb-6 text-center text-[11px] leading-relaxed text-gray-400">
          {h.empresa.razon_social} — CUIT {h.empresa.cuit} — {h.empresa.domicilio}
          <br />
          Documento generado automáticamente a partir de los registros cargados en el sistema.
          No constituye una firma digital.
        </p>
      </div>
    </main>
  )
}
