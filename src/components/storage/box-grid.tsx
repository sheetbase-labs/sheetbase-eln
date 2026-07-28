import { Skeleton } from '#/components/ui'
import type { BoxPositionWithSample, StorageBox } from '#/lib/storage'
import { cn } from '#/lib/utils'
import { isExpiringSoon, isLowVolume } from './storage-metrics'

function appearance(position: BoxPositionWithSample) {
  if (position.status === 'quarantined')
    return ['Quarantined', 'bg-pink-100 border-pink-300 text-pink-900']
  if (position.status === 'missing')
    return ['Missing / Reserved', 'bg-slate-500 border-slate-600 text-white']
  if (isLowVolume(position))
    return ['Low volume', 'bg-yellow-100 border-yellow-300 text-yellow-900']
  if (isExpiringSoon(position))
    return ['Expiring soon', 'bg-orange-100 border-orange-300 text-orange-900']
  if (position.status === 'occupied')
    return ['In stock', 'bg-emerald-100 border-emerald-300 text-emerald-900']
  return ['Empty', 'bg-slate-50 border-slate-200 text-slate-600']
}

const legend = [
  ['In stock', 'bg-emerald-200'],
  ['Low volume', 'bg-yellow-200'],
  ['Expiring soon', 'bg-orange-200'],
  ['Quarantined', 'bg-pink-200'],
  ['Empty', 'bg-slate-100'],
  ['Reserved / Missing', 'bg-slate-500'],
]

export function BoxGrid({
  box,
  positions,
  loading,
  selectedPositionId,
  onSelectPosition,
  context,
}: {
  box: StorageBox | null
  positions: BoxPositionWithSample[]
  loading?: boolean
  selectedPositionId?: string | null
  onSelectPosition: (positionId: string) => void
  context?: string
}) {
  if (loading) return <Skeleton className="m-6 h-64" />
  if (!box)
    return (
      <div className="grid min-h-64 place-items-center text-sm text-muted-foreground">
        Select a box to view its positions.
      </div>
    )
  const byCell = new Map(
    positions.map((position) => [
      `${position.rowIndex}:${position.colIndex}`,
      position,
    ]),
  )
  return (
    <section
      className="min-w-0 rounded-lg border bg-card p-4"
      aria-label={`${box.name} contents`}
    >
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Open box: {box.name}</h2>
            <p className="text-xs text-muted-foreground">
              {context ?? 'Shelf / rack'} ·{' '}
              <span className="font-mono">{box.code}</span>
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {box.rows} × {box.cols}
          </span>
        </div>
      </header>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-max gap-1.5"
          style={{
            gridTemplateColumns: `1.5rem repeat(${box.cols}, minmax(4.25rem, 1fr))`,
          }}
        >
          <span />
          {Array.from({ length: box.cols }, (_, col) => (
            <span
              key={col}
              className="text-center text-xs font-medium text-muted-foreground"
            >
              {col + 1}
            </span>
          ))}
          {Array.from({ length: box.rows }, (_rowValue, row) => (
            <div key={row} className="contents">
              <span className="self-center text-center text-xs font-medium text-muted-foreground">
                {String.fromCharCode(65 + row)}
              </span>
              {Array.from({ length: box.cols }, (_colValue, col) => {
                const position = byCell.get(`${row}:${col}`)
                if (!position) return <span key={col} />
                const [label, tone] = appearance(position)
                return (
                  <button
                    key={position.id}
                    type="button"
                    onClick={() => onSelectPosition(position.id)}
                    aria-label={`${position.label}, ${label}${position.sample ? `, ${position.sample.identifier}, ${position.sample.title}` : ''}`}
                    className={cn(
                      'min-h-16 rounded-md border p-1.5 text-left text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      tone,
                      selectedPositionId === position.id &&
                        'ring-2 ring-primary ring-offset-1',
                    )}
                  >
                    <span className="block font-semibold">
                      {position.label} · {label}
                    </span>
                    {position.sample && (
                      <span className="mt-1 block truncate font-mono">
                        {position.sample.identifier}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div
        className="mt-4 flex flex-wrap gap-x-4 gap-y-2"
        aria-label="Position status legend"
      >
        {legend.map(([label, tone]) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 text-xs"
          >
            <span
              className={cn('size-3 rounded-sm border', tone)}
              aria-hidden
            />
            {label}
          </span>
        ))}
      </div>
    </section>
  )
}
