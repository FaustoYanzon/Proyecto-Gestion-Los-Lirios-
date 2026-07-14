// Segment-level loading state for /dashboard routes.
// Skeleton matches the card style of the design system (no spinner flash).

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-4 animate-pulse" aria-busy="true" aria-label="Cargando">
      {/* Header */}
      <div>
        <div className="h-7 w-64 bg-[#fbfaf6] rounded" />
        <div className="h-4 w-44 bg-[#fbfaf6] rounded mt-2" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-[10px] border border-[#fbfaf6] p-4"
            style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)' }}
          >
            <div className="h-3 w-20 bg-[#fbfaf6] rounded" />
            <div className="h-6 w-16 bg-[#fbfaf6] rounded mt-2" />
          </div>
        ))}
      </div>

      {/* Main panel */}
      <div
        className="bg-white rounded-[10px] border border-[#fbfaf6] p-4"
        style={{ boxShadow: '0 1px 2px rgba(31,26,23,0.06)', minHeight: 320 }}
      >
        <div className="h-3 w-48 bg-[#fbfaf6] rounded" />
        <div className="h-full min-h-[240px] bg-[#fbfaf6] rounded mt-3" />
      </div>
    </div>
  )
}
