import type { LucideIcon } from 'lucide-react'

// Sin ilustraciones ni emojis — ícono 24, título 15, descripción 13.
export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <Icon size={24} strokeWidth={1.75} color="#a09584" />
      <p className="text-[15px] font-semibold text-[#1f1a17] mt-3">{title}</p>
      {description && (
        <p className="text-[13px] text-[#5a544c] mt-1 max-w-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
