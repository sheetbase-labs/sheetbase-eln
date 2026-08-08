import type { BoxPositionWithSample, StorageBox } from '#/lib/storage'

function properties(position: BoxPositionWithSample) {
  if (!position.sample) return undefined
  return (
    position.sample as unknown as { properties?: Record<string, unknown> }
  ).properties
}

export function isLowVolume(position: BoxPositionWithSample) {
  const value = properties(position)?.quantity
  return (
    position.status === 'occupied' && typeof value === 'number' && value <= 1
  )
}

export function isExpiringSoon(position: BoxPositionWithSample) {
  const value = properties(position)?.expiryDate
  if (typeof value !== 'string') return false
  const days = (new Date(value).getTime() - Date.now()) / 86_400_000
  return position.status === 'occupied' && days >= 0 && days <= 30
}

export function StorageMetrics({
  positions,
  box,
}: {
  positions: BoxPositionWithSample[]
  box: StorageBox | null
}) {
  const total = box?.capacity ?? 0
  const values = [
    ['Total capacity', total, 'bg-info'],
    [
      'Occupied',
      positions.filter((p) => p.status === 'occupied').length,
      'bg-success',
    ],
    [
      'Available',
      positions.filter((p) => p.status === 'available').length,
      'bg-muted-foreground',
    ],
    ['Low volume', positions.filter(isLowVolume).length, 'bg-warning'],
    ['Expiring soon', positions.filter(isExpiringSoon).length, 'bg-orange-500'],
    [
      'Quarantined',
      positions.filter((p) => p.status === 'quarantined').length,
      'bg-danger',
    ],
    [
      'Missing',
      positions.filter((p) => p.status === 'missing').length,
      'bg-danger',
    ],
  ] as const
  return (
    <section
      aria-label="Box capacity summary"
      aria-description="Occupied, available, quarantined, and missing positions are mutually exclusive and reconcile to total capacity. Low-volume and expiring-soon values are attention flags within occupied positions."
      className="grid divide-y overflow-hidden rounded-lg border bg-card sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-3 xl:grid-cols-7"
    >
      {values.map(([label, value, tone]) => (
        <div key={label} className="relative px-3 py-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <strong className="text-xl tabular-nums">{value}</strong>
            <span className="text-xs text-muted-foreground">
              {total ? `${Math.round((value / total) * 100)}%` : '—'}
            </span>
          </div>
          <div
            className={`absolute inset-x-0 bottom-0 h-0.5 ${tone}`}
            aria-hidden
          />
        </div>
      ))}
    </section>
  )
}
