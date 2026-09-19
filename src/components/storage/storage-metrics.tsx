import { boxOccupancy } from '#/lib/storage'
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
  // The strip is a per-box capacity summary; the positions query only sees
  // the selected box, so with nothing selected there is nothing to
  // summarise — render nothing rather than a misleading all-zero strip.
  if (!box) return null
  const total = box.capacity
  const occupancy = boxOccupancy(positions, total)
  const values = [
    ['Total capacity', total, 'bg-primary'],
    ['Occupied', occupancy.occupied, 'bg-success'],
    ['Available', occupancy.available, 'bg-muted-foreground'],
    ['Low volume', positions.filter(isLowVolume).length, 'bg-warning'],
    ['Expiring soon', positions.filter(isExpiringSoon).length, 'bg-warning'],
    ['Quarantined', occupancy.quarantined, 'bg-destructive'],
    ['Missing', occupancy.missing, 'bg-violet'],
  ] as const
  return (
    <section
      aria-label="Box capacity summary"
      aria-description="Occupied, available, quarantined, and missing positions are mutually exclusive and reconcile to total capacity. Low-volume and expiring-soon values are attention flags within occupied positions."
      className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1"
    >
      {values.map(([label, value, dot]) => (
        <span key={label} className="flex items-center gap-1.5 text-xs">
          <span aria-hidden="true" className={`size-1.5 rounded-full ${dot}`} />
          <span className="font-medium tabular-nums">{value}</span>
          <span className="text-muted-foreground">{label}</span>
        </span>
      ))}
    </section>
  )
}
