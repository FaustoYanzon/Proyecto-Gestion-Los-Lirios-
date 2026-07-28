import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// /login: solo para usuarios sin sesión (si hay token, se manda a /dashboard).
// /privacy: siempre pública, incluso con sesión iniciada — la pide Play Store
// y tiene que ser accesible sin depender de si quien la visita está logueado.
const unauthOnlyRoutes = ['/login']
const alwaysPublicRoutes = ['/privacy']

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get('auth_token')?.value

  if (pathname === '/') {
    return NextResponse.redirect(
      new URL(token ? '/dashboard' : '/login', request.url)
    )
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
