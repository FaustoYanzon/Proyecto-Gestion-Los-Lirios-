type BadgeVariant = 'dot' | 'count' | 'label'

/**
 * dot: hay novedad, no importa cuánta. count: conteo, hasta 9 y después "9+".
 * label: estados con nombre. Nunca "label" para conteos.
 */
export default function Badge({
  variant,
  value,
  ringColor = '#ffffff',
}: {
  variant: BadgeVariant
  value?: number | string
  ringColor?: string
}) {
  if (variant === 'dot') {
    return (
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 9,
          height: 9,
          borderRadius: 999,
          backgroundColor: '#7a1f2c',
          boxShadow: `0 0 0 2px ${ringColor}`,
        }}
      />
    )
  }

  if (variant === 'count') {
    const n = typeof value === 'number' ? value : Number(value ?? 0)
    const display = n > 9 ? '9+' : String(n)
    return (
      <span
        className="inline-flex items-center justify-center rounded-full text-white font-bold"
        style={{
          minHeight: 17,
          minWidth: 17,
          padding: '0 5px',
          fontSize: 10,
          backgroundColor: '#7a1f2c',
          boxShadow: `0 0 0 2px ${ringColor}`,
        }}
      >
        {display}
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center rounded-full font-bold uppercase tracking-wide"
      style={{
        fontSize: 10,
        letterSpacing: '0.4px',
        padding: '2px 8px',
        backgroundColor: '#faf6ec',
        color: '#7a1f2c',
      }}
    >
      {value}
    </span>
  )
}
