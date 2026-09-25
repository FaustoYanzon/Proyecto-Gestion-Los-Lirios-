import { redirect } from 'next/navigation'

// El historial de aplicaciones vive ahora en la pestaña "Aplicadas" de
// Órdenes de Aplicación; esta ruta queda solo para links viejos.
export default function FitosanitariosRedirect() {
  redirect('/dashboard/produccion/ordenes-aplicacion?vista=aplicadas')
}
