import Link from 'next/link'
import { LANDING as C } from '@/lib/content/landing'
import Reveal from '@/components/landing/Reveal'
import VarietyMap from '@/components/landing/VarietyMap'

// Landing institucional (Fase 4 de Trazabilidad). Vive en `/`.
// proxy.ts manda a /dashboard a quien ya tiene sesión; el visitante anónimo
// (llegó por el QR de una carta, o buscando la finca) ve esta página.
// Contenido editable en lib/content/landing.ts. Movimiento: globals.css (.landing).

export const metadata = {
  // Dominio público del sitio, para resolver la imagen de OpenGraph.
  metadataBase: new URL('https://frontend-six-jade-79.vercel.app'),
  title: `${C.empresa.nombre} — uva con nombre y procedencia`,
  description: C.hero.bajada,
  openGraph: {
    title: C.empresa.razonSocial,
    description: C.hero.bajada,
    images: [{ url: C.hero.foto.src }],
  },
}

const preLine = { whiteSpace: 'pre-line' as const }

export default function LandingPage() {
  return (
    <main className="landing">
      <header className="landing__header">
        <div className="landing__wrap">
          <span className="brand">
            <img src="/logo-reducido.svg" alt="" width={26} height={26} />
            {C.empresa.razonSocial}
          </span>
          <Link href="/login" className="enter">
            Ingresar al sistema
          </Link>
        </div>
      </header>

      {/* ── Hero fijo ── */}
      <section className="landing__hero">
        <img
          src={C.hero.foto.src}
          width={C.hero.foto.w}
          height={C.hero.foto.h}
          alt={C.hero.foto.alt}
          fetchPriority="high"
        />
        <div className="landing__hero-scrim" />
        <div className="landing__hero-copy">
          <div className="landing__wrap">
            <h1 className="landing__display" style={preLine}>
              {C.hero.titulo}
            </h1>
            <p>{C.hero.bajada}</p>
          </div>
        </div>
        <span className="landing__scroll-hint" aria-hidden="true" />
      </section>

      <div className="landing__flow">
        {/* ── Quiénes somos ── */}
        <section className="landing__section landing__section--paper">
          <div className="mx-auto grid max-w-[1400px] items-center gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,40%)]">
            <div className="landing__wrap lg:mx-0 lg:ml-auto lg:max-w-[52ch] lg:pr-14">
              <Reveal>
                <h2 className="landing__display text-[length:var(--step-3)]" style={preLine}>
                  {C.nosotros.titulo}
                </h2>
                <div className="mt-6 space-y-4">
                  {C.nosotros.parrafos.map((p, i) => (
                    <p key={i} className="landing__body">
                      {p}
                    </p>
                  ))}
                </div>
              </Reveal>
            </div>
            <Reveal
              className="landing__frame landing__frame--parallax h-[62vh] max-h-[560px] w-full self-stretch lg:h-full"
            >
              <img
                src={C.nosotros.foto.src}
                width={C.nosotros.foto.w}
                height={C.nosotros.foto.h}
                alt={C.nosotros.foto.alt}
                loading="lazy"
              />
            </Reveal>
          </div>
        </section>

        {/* ── Dónde está cada variedad ── */}
        <section className="landing__section landing__section--bone">
          <div className="landing__wrap">
            <Reveal>
              <p className="landing__kicker">{C.mapa.kicker}</p>
              <h2
                className="landing__display mt-3 text-[length:var(--step-3)]"
                style={preLine}
              >
                {C.mapa.titulo}
              </h2>
              <p className="landing__body mt-5">{C.mapa.intro}</p>
            </Reveal>
            <Reveal className="mt-12">
              <VarietyMap />
            </Reveal>
          </div>
        </section>

        {/* ── Trazabilidad ── */}
        <section className="landing__section landing__section--wine !pt-0">
          <div className="landing__frame landing__frame--duo landing__frame--parallax h-[38svh] min-h-[260px] w-full">
            <img
              src={C.trazabilidad.foto.src}
              width={C.trazabilidad.foto.w}
              height={C.trazabilidad.foto.h}
              alt={C.trazabilidad.foto.alt}
              loading="lazy"
            />
          </div>
          <div className="landing__wrap pt-[clamp(3.5rem,10vh,7rem)]">
            <div className="grid gap-x-14 gap-y-8 lg:grid-cols-[0.9fr_1.1fr]">
              <Reveal>
                <h2 className="landing__display text-[length:var(--step-3)]" style={preLine}>
                  {C.trazabilidad.titulo}
                </h2>
              </Reveal>
              <Reveal>
                <div className="space-y-4">
                  {C.trazabilidad.parrafos.map((p, i) => (
                    <p key={i} className="landing__body">
                      {p}
                    </p>
                  ))}
                </div>
                <p className="mt-7 font-mono text-[0.8rem] tracking-wide text-[color:var(--l-cream-on-wine)] opacity-80">
                  {C.trazabilidad.urlEjemplo}
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Contacto + footer ── */}
        <section className="landing__section landing__section--tail landing__section--paper">
          <div className="landing__wrap">
            <Reveal>
              <h2 className="landing__display text-[length:var(--step-2)]">Contacto</h2>
              <div className="landing__body mt-5 space-y-1">
                <p>
                  <a
                    href={`mailto:${C.contacto.email}`}
                    className="text-[color:var(--l-wine)] underline underline-offset-4"
                  >
                    {C.contacto.email}
                  </a>
                </p>
                <p>{C.contacto.domicilio}</p>
              </div>
            </Reveal>

            <hr className="landing__rule mt-14" />
            <div className="mt-6 flex flex-col gap-3 text-[0.8rem] text-[color:var(--l-ink-soft)] sm:flex-row sm:items-center sm:justify-between">
              <span>
                {C.empresa.razonSocial} · Desde {C.empresa.desde} · {C.empresa.ubicacion}
              </span>
              <span className="flex gap-5">
                <Link href="/login" className="hover:text-[color:var(--l-wine)]">
                  Ingresar al sistema
                </Link>
                <Link href="/privacy" className="hover:text-[color:var(--l-wine)]">
                  Privacidad
                </Link>
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
