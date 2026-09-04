import Link from 'next/link'
import { LANDING as C } from '@/lib/content/landing'

// Landing institucional (Fase 4 de Trazabilidad). Vive en `/`.
// proxy.ts manda a /dashboard a quien ya tiene sesión; el visitante anónimo
// (típicamente alguien que llegó desde el QR de una carta o buscando la
// empresa) ve esta página. Contenido editable en lib/content/landing.ts.

export const metadata = {
  title: `${C.empresa.nombre} — ${C.empresa.tagline}`,
  description: C.empresa.descripcionCorta,
}

const display = { fontFamily: 'var(--font-display)' }

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-2xl font-bold text-[#1f1a17] sm:text-3xl" style={display}>
      {children}
    </h2>
  )
}

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-[#1f1a17]">
      {/* ── Nav ── */}
      <header className="border-b border-[#e2dbcc]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <img src="/logo-reducido.svg" alt="" className="h-8 w-auto" />
            <span className="text-lg font-bold" style={display}>
              {C.empresa.nombre}
            </span>
          </div>
          {/* .btn/.btn--primary del design system: el color del texto lo fija
             esa clase, no `text-white` (globals.css tiene un `a { color }`
             sin @layer que le gana a las utilities de Tailwind). */}
          <Link href="/login" className="btn btn--primary btn--sm">
            Ingresar al sistema
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section
        className="border-b border-[#e2dbcc]"
        style={{ backgroundColor: '#faf6ec', borderTop: '3px solid #7a1f2c' }}
      >
        <div className="mx-auto max-w-5xl px-5 py-16 sm:py-24">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#a09584]">
            {C.empresa.nombre} · {C.empresa.ubicacion}
          </p>
          <h1
            className="mt-4 max-w-2xl text-3xl font-bold leading-tight text-[#1f1a17] sm:text-4xl"
            style={display}
          >
            {C.empresa.tagline}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-[#5a544c]">
            {C.empresa.descripcionCorta}
          </p>
          <div className="mt-7 h-0.5 w-8" style={{ backgroundColor: '#c89a3a' }} />
        </div>
      </section>

      {/* ── Quiénes somos ── */}
      <section className="mx-auto max-w-5xl px-5 py-14 sm:py-20">
        <SectionTitle>{C.nosotros.titulo}</SectionTitle>
        <div className="mt-5 max-w-2xl space-y-4">
          {C.nosotros.parrafos.map((p, i) => (
            <p key={i} className="text-[15px] leading-relaxed text-[#5a544c]">
              {p}
            </p>
          ))}
        </div>
      </section>

      {/* ── Qué producimos ── */}
      <section className="border-y border-[#e2dbcc] bg-[#fbfaf6]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:py-20">
          <SectionTitle>{C.produccion.titulo}</SectionTitle>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-[#5a544c]">
            {C.produccion.intro}
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {C.produccion.grupos.map((g) => (
              <div
                key={g.rubro}
                className="rounded-lg border border-[#e2dbcc] bg-white p-4"
              >
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#a09584]">
                  {g.rubro}
                </p>
                <ul className="mt-2 space-y-1">
                  {g.variedades.map((v) => (
                    <li key={v} className="text-sm text-[#1f1a17]">
                      {v}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trazabilidad ── */}
      <section className="mx-auto max-w-5xl px-5 py-14 sm:py-20">
        <SectionTitle>{C.trazabilidad.titulo}</SectionTitle>
        <div className="mt-5 max-w-2xl space-y-4">
          {C.trazabilidad.parrafos.map((p, i) => (
            <p key={i} className="text-[15px] leading-relaxed text-[#5a544c]">
              {p}
            </p>
          ))}
        </div>
      </section>

      {/* ── Contacto ── */}
      <section className="border-t border-[#e2dbcc] bg-[#faf6ec]">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:py-16">
          <SectionTitle>Contacto</SectionTitle>
          <div className="mt-5 space-y-1 text-[15px] text-[#5a544c]">
            <p>
              <a
                href={`mailto:${C.contacto.email}`}
                className="text-[#7a1f2c] underline underline-offset-2"
              >
                {C.contacto.email}
              </a>
            </p>
            <p>{C.contacto.domicilio}</p>
            {C.contacto.telefono && <p>{C.contacto.telefono}</p>}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[#e2dbcc]">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-6 text-xs text-[#a09584] sm:flex-row sm:items-center sm:justify-between">
          <span>
            {C.empresa.nombre} · Desde 1991 · {C.empresa.ubicacion}
          </span>
          <Link href="/privacy" className="hover:text-[#7a1f2c]">
            Política de privacidad
          </Link>
        </div>
      </footer>
    </main>
  )
}
