import { WELL_COLS, WELL_ROWS } from '#/lib/instrument-monitor'
import type {
  InstrumentPlateSnapshot,
  RunStatus,
} from '#/lib/instrument-monitor'
import { cn } from '#/lib/utils'

export interface PlateStateProps {
  snapshots: InstrumentPlateSnapshot[]
  runStatus: RunStatus
}

const WELL_COLORS: Record<string, string> = {
  amplified: 'border-success bg-success/80',
  no_amplification: 'border-info bg-info/80',
  blank: 'border-zinc-400 bg-zinc-300',
  pending: 'border-border bg-muted/30',
}

export function PlateState({ snapshots, runStatus }: PlateStateProps) {
  const latest: InstrumentPlateSnapshot | null =
    snapshots.length > 0
      ? [...snapshots].sort(
          (a, b) =>
            new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
        )[0]
      : null
  return (
    <div className="overflow-x-auto">
      <div
        role="grid"
        aria-label="96-well plate state"
        className="grid min-w-[540px] grid-cols-[24px_repeat(12,minmax(32px,1fr))] gap-1 rounded-lg border bg-muted/10 p-3"
      >
        <span />
        {WELL_COLS.map((col) => (
          <span
            key={col}
            role="columnheader"
            className="text-center text-xs text-muted-foreground"
          >
            {col}
          </span>
        ))}
        {WELL_ROWS.map((row) => (
          <div key={row} className="contents">
            <span
              role="rowheader"
              className="self-center text-center text-xs text-muted-foreground"
            >
              {row}
            </span>
            {WELL_COLS.map((col) => {
              const code = `${row}${col}`
              const value = latest?.wells[code]
              const status =
                typeof value === 'string'
                  ? value
                  : value && typeof value === 'object'
                    ? String(
                        (value as Record<string, unknown>).status ?? 'pending',
                      )
                    : 'pending'
              return (
                <button
                  key={code}
                  type="button"
                  role="gridcell"
                  aria-label={code}
                  title={`${code}: ${status}`}
                  className={cn(
                    'aspect-square rounded-full border transition-transform hover:scale-110',
                    WELL_COLORS[status] ?? WELL_COLORS.pending,
                    runStatus === 'cancelled' && 'opacity-60',
                  )}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
