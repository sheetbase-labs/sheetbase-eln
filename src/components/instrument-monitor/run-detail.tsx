import { Badge, Card, CardContent } from '#/components/ui'
import {
  CONNECTION_STATUS_BADGE_VARIANT,
  CONNECTION_STATUS_LABELS,
  RUN_STATUS_BADGE_VARIANT,
  RUN_STATUS_LABELS,
} from '#/lib/instrument-monitor'
import type {
  Instrument,
  InstrumentObservation,
  InstrumentPlateSnapshot,
  InstrumentRun,
  InstrumentRunStage,
} from '#/lib/instrument-monitor'

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
      <header className="space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                {run.runIdentifier}
              </h2>
              <Badge
                variant={RUN_STATUS_BADGE_VARIANT[run.status]}
                className="whitespace-nowrap"
              >
                {RUN_STATUS_LABELS[run.status]}
              </Badge>
            </div>
            <p className="text-sm font-medium">{run.name}</p>
            <p className="text-xs text-muted-foreground">
              {instrument?.name ?? 'Unknown instrument'}
              {instrument?.model ? ` · ${instrument.model}` : ''} ·{' '}
              {run.protocolName ?? 'No protocol'}
            </p>
          </div>
          {instrument ? (
            <Badge
              variant={
                CONNECTION_STATUS_BADGE_VARIANT[instrument.connectionStatus]
              }
              className="whitespace-nowrap"
            >
              {CONNECTION_STATUS_LABELS[instrument.connectionStatus]}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Run progress"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="whitespace-nowrap text-xs font-medium tabular-nums">
            {progress}%
          </span>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            Elapsed {elapsed(run.elapsedSeconds)}
          </span>
        </div>
        <span className="sr-only">Time zone: {timeZone}</span>
      </header>
      <div className="space-y-8 px-6 pb-8">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Stage progress
          </h3>
          <StageProgress stages={stages} />
        </section>
        <section>
          <TelemetryChart observations={observations} />
        </section>
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Plate state</h3>
          <Card>
            <CardContent className="p-4">
              <PlateState snapshots={plateSnapshots} runStatus={run.status} />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}
