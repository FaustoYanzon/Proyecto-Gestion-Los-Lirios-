import type { IconoMaquina } from '@/lib/api/maquinaria'

interface Props {
  icono: IconoMaquina
  size?: number
  className?: string
}

// Three hand-drawn icons sharing one style (24px grid, 1.75 round stroke):
// lucide has no plow, so all three are drawn here to stay consistent.
export default function MaquinaIcon({ icono, size = 18, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {icono === 'tractor' && (
        <>
          <circle cx="16.5" cy="16" r="4" />
          <circle cx="6" cy="18" r="2" />
          <path d="M3 14V9h6l1.5 3.5H13" />
          <path d="M13 12 13.5 5H17l1.5 7" />
          <path d="M5 9V5" />
        </>
      )}
      {icono === 'carro' && (
        <>
          <path d="M4 6h16v9H4z" />
          <path d="M4 10.5H1.5" />
          <circle cx="8" cy="18" r="2" />
          <circle cx="16" cy="18" r="2" />
        </>
      )}
      {icono === 'implemento' && (
        <>
          <path d="M3 5h15" />
          <path d="M7 5v8a3 3 0 0 0 3 3h3" />
          <path d="M14 5v8a3 3 0 0 0 3 3h3" />
          <circle cx="20.5" cy="5" r="1.5" />
        </>
      )}
    </svg>
  )
}
