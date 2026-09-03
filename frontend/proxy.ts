import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// /login: solo para usuarios sin sesión (si hay token, se manda a /dashboard).
// /privacy: siempre pública, incluso con sesión iniciada — la pide Play Store
// y tiene que ser accesible sin depender de si quien la visita está logueado.
const unauthOnlyRoutes = ['/login']
// /trazabilidad/publica/<token>: la vista pública de trazabilidad que se abre
// desde el QR de la carta, sin sesión — la mira un comprador, no un usuario.
const alwaysPublicRoutes = ['/privacy', '/trazabilidad/publica']

// Cualquier archivo estático de public/ (logos, favicons, imágenes) tiene que
// servirse siempre, sin cookie de sesión — si no, un <img src="/logo.svg">
// en una pantalla pública (login) recibe el 307 a /login en vez del archivo.
const STATIC_ASSET_EXT = /\.(svg|png|jpe?g|ico|webp)$/

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get('auth_token')?.value

  if (pathname === '/') {
    return NextResponse.redirect(
      new URL(token ? '/dashboard' : '/login', request.url)
    )
  }

  if (STATIC_ASSET_EXT.test(pathname)) {
    return NextResponse.next()
  }

  if (alwaysPublicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  const isUnauthOnlyRoute = unauthOnlyRoutes.some((route) => pathname.startsWith(route))

  if (!isUnauthOnlyRoute && !token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (isUnauthOnlyRoute && token) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
