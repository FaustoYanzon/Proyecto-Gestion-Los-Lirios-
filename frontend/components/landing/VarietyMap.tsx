'use client'

import { useMemo, useState } from 'react'
import { PARRALES, CONTEXTO, FINCA_MAP_VIEWBOX } from '@/lib/content/finca-map'
import { VARIEDADES, VARIEDAD_BY_KEY } from '@/lib/content/landing'

const [, , VB_W] = FINCA_MAP_VIEWBOX.split(' ').map(Number)

type Hover = { plot: string | null; variedad: string | null }

export default function VarietyMap() {
  const [hover, setHover] = useState<Hover>({ plot: null, variedad: null })

  const resumen = useMemo(() => {
    return VARIEDADES.map((v) => {
      const cuadros = PARRALES.filter((p) => p.variedad === v.key)
      const ha = cuadros.reduce((s, p) => s + (p.ha ?? 0), 0)
      return { ...v, n: cuadros.length, ha }
    }).filter((v) => v.n > 0)
  }, [])

  const active = hover.plot
    ? PARRALES.find((p) => p.name === hover.plot) ?? null
    : null
  const activeVar = active?.variedad ?? hover.variedad

  function fill(key: string | null) {
    return key ? `var(${VARIEDAD_BY_KEY[key]?.cssVar ?? '--v-none'})` : 'var(--v-none)'
  }

  return (
    <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
      <div className="relative">
        <svg
          className="landing__map-svg"
          viewBox={FINCA_MAP_VIEWBOX}
          role="img"
          aria-label="Plano de la finca con cada cuadro de parral pintado según su variedad de uva"
          onPointerLeave={() => setHover({ plot: null, variedad: null })}
        >
          {CONTEXTO.map((c, i) => (
            <path key={i} className="ctx" d={c.d} />
          ))}

          {PARRALES.map((p) => {
            const dim =
              activeVar != null && p.variedad !== activeVar ? 0.42 : 1
            return (
              <path
                key={p.name}
                className="plot"
                d={p.d}
                fill={fill(p.variedad)}
                fillOpacity={dim}
                data-active={hover.plot === p.name || (activeVar != null && p.variedad === activeVar)}
                tabIndex={0}
                role="button"
                aria-label={`Parral ${p.name}${
                  p.variedad ? `, ${VARIEDAD_BY_KEY[p.variedad]?.label}` : ''
                }${p.ha ? `, ${p.ha} hectáreas` : ''}`}
                onPointerEnter={() => setHover({ plot: p.name, variedad: null })}
                onFocus={() => setHover({ plot: p.name, variedad: null })}
                onBlur={() => setHover({ plot: null, variedad: null })}
              >
                <title>{`Parral ${p.name}${p.variedad ? ` · ${VARIEDAD_BY_KEY[p.variedad]?.label ?? ''}` : ''}${p.ha ? ` · ${p.ha} ha` : ''}`}</title>
              </path>
            )
          })}

          {active && (
            <Tooltip
              x={active.c[0]}
              y={active.c[1]}
              name={active.name}
              variedad={active.variedad ? VARIEDAD_BY_KEY[active.variedad]?.label ?? '' : 'Sin variedad'}
              ha={active.ha}
            />
          )}
        </svg>
      </div>

      <ul
        className="landing__legend"
        onPointerLeave={() => setHover({ plot: null, variedad: null })}
      >
        {resumen.map((v) => (
          <li
            key={v.key}
            data-active={activeVar === v.key}
            onPointerEnter={() => setHover({ plot: null, variedad: v.key })}
          >
            <span className="swatch" style={{ background: `var(${v.cssVar})` }} />
            <span className="v-name">{v.label}</span>
            <span className="v-meta">
              {v.rubro === 'Uva para vino' ? 'vino' : 'mesa'} · {v.n}{' '}
              {v.n === 1 ? 'cuadro' : 'cuadros'} · {v.ha.toFixed(1).replace('.', ',')} ha
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Tooltip({
  x,
  y,
  name,
  variedad,
  ha,
}: {
  x: number
  y: number
  name: string
  variedad: string
  ha: number | null
}) {
  const W = 250
  const H = 92
  // clamp dentro del viewBox
  const tx = Math.max(6, Math.min(VB_W - W - 6, x - W / 2))
  const ty = y - H - 16 < 6 ? y + 16 : y - H - 16
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={tx}
        y={ty}
        width={W}
        height={H}
        rx={7}
        fill="oklch(0.99 0.006 82)"
        stroke="oklch(0.84 0.016 74)"
      />
      <text x={tx + 16} y={ty + 32} fontFamily="var(--font-display)" fontWeight={600} fontSize={25} fill="var(--l-wine)">
        Parral {name}
      </text>
      <text x={tx + 16} y={ty + 58} fontFamily="var(--font-sans)" fontSize={18} fill="var(--l-ink)">
        {variedad}
      </text>
      {ha != null && (
        <text x={tx + 16} y={ty + 79} fontFamily="var(--font-mono)" fontSize={15} fill="var(--l-ink-soft)">
          {ha.toString().replace('.', ',')} ha
        </text>
      )}
    </g>
  )
}
