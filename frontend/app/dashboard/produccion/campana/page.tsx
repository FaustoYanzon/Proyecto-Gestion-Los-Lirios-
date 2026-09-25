import { redirect } from 'next/navigation'

// Ciclo de Campaña se mudó a Documentación, junto al calendario de Fenología.
export default function CampanaRedirect() {
  redirect('/dashboard/documentacion/campana')
}
