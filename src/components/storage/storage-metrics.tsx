import { Card, CardContent } from '#/components/ui'
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
  ] as const
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {values.map(([label, value, tone]) => (
        <Card key={label} className="overflow-hidden py-0">
          <CardContent className="px-3 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <div className="mt-1 flex items-end justify-between">
              <strong className="text-2xl">{value}</strong>
              <span className="text-xs text-muted-foreground">
                {total ? `${Math.round((value / total) * 100)}%` : '—'}
              </span>
            </div>
          </CardContent>
          <div className={`h-1 ${tone}`} aria-hidden />
        </Card>
      ))}
    </div>
  )
}
