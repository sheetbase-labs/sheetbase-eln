import { Badge } from '#/components/ui'
import {
  CONNECTION_STATUS_LABELS,
  CONNECTION_STATUS_TOKENS,
  RUN_STATUS_LABELS,
  RUN_STATUS_TOKENS,
} from '#/lib/instrument-monitor'
import type {
  Instrument,
  InstrumentObservation,
  InstrumentPlateSnapshot,
  InstrumentRun,
  InstrumentRunStage,
} from '#/lib/instrument-monitor'
import { cn } from '#/lib/utils'

import { PlateState } from './plate-state'
import { StageProgress } from './stage-progress'
import { TelemetryChart } from './telemetry-chart'

export interface RunDetailProps {
  run: InstrumentRun | null
  instrument: Instrument | null
  stages: InstrumentRunStage[]
  observations: InstrumentObservation[]
  plateSnapshots: InstrumentPlateSnapshot[]
  timeZone: string
}

function elapsed(seconds: number | null): string {
  if (seconds == null) return '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours ? `${hours}h ` : ''}${minutes}m ${seconds % 60}s`
}

export function RunDetail({
  run,
  instrument,
  stages,
  observations,
  plateSnapshots,
  timeZone,
}: RunDetailProps) {
  if (!run)
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
        Select a run from the queue to view details.
      </div>
    )

  const progress = Math.max(0, Math.min(100, run.progressPercent))
  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{run.runIdentifier}</h1>
              <Badge className={cn(RUN_STATUS_TOKENS[run.status])}>
                {RUN_STATUS_LABELS[run.status]}
              </Badge>
            </div>
            <p className="text-sm font-medium">{run.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {instrument?.name ?? 'Unknown instrument'}
              {instrument?.model ? ` · ${instrument.model}` : ''} ·{' '}
              {run.protocolName ?? 'No protocol'}
            </p>
          </div>
          {instrument ? (
            <Badge
              className={cn(
                CONNECTION_STATUS_TOKENS[instrument.connectionStatus],
              )}
            >
              {CONNECTION_STATUS_LABELS[instrument.connectionStatus]}
            </Badge>
          ) : null}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Run progress"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-blue-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs font-medium">{progress}%</span>
          <span className="text-xs text-muted-foreground">
            Elapsed {elapsed(run.elapsedSeconds)}
          </span>
        </div>
        <span className="sr-only">Time zone: {timeZone}</span>
      </header>
      <section className="border-b p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase text-muted-foreground">
          Stage progress
        </h2>
        <StageProgress stages={stages} />
      </section>
      <section className="border-b p-5">
        <h2 className="mb-3 text-sm font-semibold">Amplification curves</h2>
        <TelemetryChart observations={observations} />
      </section>
      <section className="p-5">
        <h2 className="mb-3 text-sm font-semibold">Plate state</h2>
        <PlateState snapshots={plateSnapshots} runStatus={run.status} />
      </section>
    </div>
  )
}
