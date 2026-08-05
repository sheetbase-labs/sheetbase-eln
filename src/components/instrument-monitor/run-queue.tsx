import { Badge } from '#/components/ui'
import {
  RUN_STATUS_BADGE_VARIANT,
  RUN_STATUS_LABELS,
} from '#/lib/instrument-monitor'
import type { Instrument, InstrumentRun } from '#/lib/instrument-monitor'
import { cn } from '#/lib/utils'

export interface RunQueueProps {
  runs: InstrumentRun[]
  instruments: Instrument[]
  selectedRunId: string | null
  onSelectRun: (id: string) => void
}

function formatElapsed(seconds: number | null): string {
  if (seconds == null) return '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return hours > 0
    ? `${hours}h ${minutes}m`
    : minutes > 0
      ? `${minutes}m ${secs}s`
      : `${secs}s`
}

export function RunQueue({
  runs,
  instruments,
  selectedRunId,
  onSelectRun,
}: RunQueueProps) {
  const instrumentNames = new Map(
    instruments.map((item) => [item.id, item.name]),
  )
  const sortedRuns = [...runs].sort(
    (a, b) =>
      a.queuePosition - b.queuePosition ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

  return (
    <div aria-label="Run queue" className="h-full overflow-y-auto">
      {sortedRuns.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          No instrument runs in the queue.
        </p>
      ) : (
        <div className="space-y-1 p-2">
          {sortedRuns.map((run) => (
            <button
              key={run.id}
              type="button"
              aria-label={`Run ${run.runIdentifier}`}
              onClick={() => onSelectRun(run.id)}
              className={cn(
                'w-full rounded-md border border-transparent p-3 text-left transition-colors hover:bg-muted/50',
                selectedRunId === run.id && 'border-primary/30 bg-primary/5',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {run.runIdentifier}
                  </p>
                  <p className="truncate text-xs">{run.name}</p>
                </div>
                <Badge
                  variant={RUN_STATUS_BADGE_VARIANT[run.status]}
                  className="shrink-0 whitespace-nowrap"
                >
                  {RUN_STATUS_LABELS[run.status]}
                </Badge>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {instrumentNames.get(run.instrumentId) ?? 'Unknown instrument'}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.max(0, Math.min(100, run.progressPercent))}%`,
                    }}
                  />
                </div>
                <span className="whitespace-nowrap text-xs font-medium tabular-nums">
                  {run.progressPercent}%
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Elapsed {formatElapsed(run.elapsedSeconds)}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
