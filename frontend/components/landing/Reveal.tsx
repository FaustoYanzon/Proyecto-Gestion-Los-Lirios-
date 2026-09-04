// Reveal on scroll — puro CSS (animation-timeline: view()), sin JS ni estado.
// El contenido SIEMPRE se renderiza visible; donde el navegador soporta
// scroll-driven animations y no hay prefers-reduced-motion, entra con un
// fundido corto. Estilo en globals.css (`.landing .reveal-scroll`).

export default function Reveal({
  as: Tag = 'div',
  className = '',
  children,
  style,
}: {
  as?: React.ElementType
  className?: string
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <Tag className={`reveal-scroll ${className}`.trim()} style={style}>
      {children}
    </Tag>
  )
}
