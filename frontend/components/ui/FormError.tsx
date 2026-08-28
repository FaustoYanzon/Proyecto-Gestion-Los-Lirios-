import { AlertTriangle } from 'lucide-react'

export default function FormError({
  title,
  description,
}: {
  title?: string
  description: string
}) {
  return (
    <div
      className="rounded-[10px] border px-4 py-3 flex items-start gap-2.5"
      style={{ backgroundColor: '#fbeced', borderColor: '#f3d5d8' }}
    >
      <AlertTriangle
        size={16}
        strokeWidth={1.75}
        className="mt-0.5 flex-shrink-0"
        style={{ color: '#a3293a' }}
      />
      <div>
        {title && <p className="text-sm font-bold text-[#a3293a]">{title}</p>}
        <p className="text-sm text-[#a3293a]">{description}</p>
      </div>
    </div>
  )
}
