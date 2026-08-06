import { Badge, Card, CardContent } from '#/components/ui'
import { MetricCard } from '#/components/scientific'
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
  JsonObject,
} from '#/lib/instrument-monitor'

import { EventLog } from './event-log'
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

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function latestTelemetry(
  observations: InstrumentObservation[],
): InstrumentObservation | null {
  let best: InstrumentObservation | null = null
  let bestTs = -Infinity
  for (const obs of observations) {
    if (obs.observationType !== 'telemetry') continue
    const ts = new Date(obs.sourceTimestamp).getTime()
    if (Number.isFinite(ts) && ts > bestTs) {
      best = obs
      bestTs = ts
    }
  }
  return best
}

function meanFluorescence(payload: JsonObject): number | undefined {
  const readings = payload.readings
  if (!Array.isArray(readings)) return undefined
  const values: number[] = []
  for (const r of readings) {
    if (r && typeof r === 'object') {
      const f = num((r as Record<string, unknown>).fluorescence)
      if (f !== undefined) values.push(f)
    }
  }
  if (values.length === 0) return undefined
  return values.reduce((a, b) => a + b, 0) / values.length
}

function totalCyclesFromStages(stages: InstrumentRunStage[]): number | undefined {
  const cycling = stages.find((s) => s.stageType === 'cycling')
  return cycling?.cycleCount ?? undefined
}

interface SnapshotStats {
  wellsComplete: number
  wellsTotal: number
  meanCt: number | undefined
  ntcStatus: string
}

function deriveSnapshotStats(
  snapshots: InstrumentPlateSnapshot[],
  observations: InstrumentObservation[],
): SnapshotStats | null {
  if (snapshots.length === 0) return null
  const latest = snapshots.reduce((a, b) =>
    new Date(b.capturedAt).getTime() > new Date(a.capturedAt).getTime() ? b : a,
  )
  const wells = latest.wells
  const entries = Object.entries(wells)
  const wellsTotal = 96
  let wellsComplete = 0
  const ctValues: number[] = []
  let ntcAmplified = false
  for (const [, w] of entries) {
    if (w && typeof w === 'object') {
      const well = w as Record<string, unknown>
      const status = well.status
      const sample = well.sample
      const ct = num(well.ct)
      if (ct !== undefined) ctValues.push(ct)
      if (status === 'amplified') wellsComplete++
      if (
        typeof sample === 'string' &&
        /negative|ntc/i.test(sample) &&
        status === 'amplified'
      ) {
        ntcAmplified = true
      }
    }
  }
  const meanCt =
    ctValues.length > 0
      ? ctValues.reduce((a, b) => a + b, 0) / ctValues.length
      : undefined

  // Prefer QC observation for NTC status
  const qcObs = observations.find((o) => o.observationType === 'qc_result')
  let ntcStatus: string
  if (qcObs) {
    const checks = qcObs.payload.checks
    if (Array.isArray(checks)) {
      const ntcCheck = checks.find(
        (c) =>
          c &&
          typeof c === 'object' &&
          /negative|ntc/i.test(String((c as Record<string, unknown>).name)),
      )
      if (ntcCheck) {
        const ct = (ntcCheck as Record<string, unknown>).checkType
        ntcStatus = ct === 'pass' ? 'Clean' : ct === 'fail' ? 'Contaminated' : 'Check'
      } else {
        ntcStatus = ntcAmplified ? 'Contaminated' : 'Clean'
      }
    } else {
      ntcStatus = ntcAmplified ? 'Contaminated' : 'Clean'
    }
  } else {
    ntcStatus = ntcAmplified ? 'Contaminated' : 'Clean'
  }

  return { wellsComplete, wellsTotal, meanCt, ntcStatus }
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

  const telemetry = latestTelemetry(observations)
  const telPayload = telemetry?.payload ?? {}
  const blockTemp = num(telPayload.blockTemperature) ?? num(telPayload.temperature)
  const sampleTemp = num(telPayload.sampleTemperature)
  const cycle = num(telPayload.cycle)
  const totalCycles = num(telPayload.totalCycles) ?? totalCyclesFromStages(stages)
  const rfu = num(telPayload.fluorescence) ?? meanFluorescence(telPayload)
  const baseline = num(telPayload.baseline)
  const snapshotStats = deriveSnapshotStats(plateSnapshots, observations)

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
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Live telemetry
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <MetricCard
              label="Block temp"
              value={blockTemp !== undefined ? `${blockTemp.toFixed(1)}°C` : '—'}
            />
            <MetricCard
              label="Sample temp"
              value={sampleTemp !== undefined ? `${sampleTemp.toFixed(1)}°C` : '—'}
            />
            <MetricCard
              label="Cycle"
              value={
                cycle !== undefined
                  ? totalCycles !== undefined
                    ? `${cycle}/${totalCycles}`
                    : `${cycle}`
                  : '—'
              }
            />
            <MetricCard
              label="Fluorescence"
              value={rfu !== undefined ? rfu.toFixed(3) : '—'}
              hint="RFU"
            />
            <MetricCard
              label="Baseline"
              value={baseline !== undefined ? baseline.toFixed(3) : '—'}
            />
          </div>
        </section>
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Event log
          </h3>
          <Card className="flex h-[36rem] flex-col overflow-hidden">
            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              <EventLog
                observations={observations}
                timeZone={timeZone}
                isLive={run.status === 'running'}
              />
            </CardContent>
          </Card>
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
        {snapshotStats ? (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Run snapshot
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard
                label="Wells complete"
                value={`${snapshotStats.wellsComplete}/${snapshotStats.wellsTotal}`}
              />
              <MetricCard
                label="Mean Ct"
                value={
                  snapshotStats.meanCt !== undefined
                    ? snapshotStats.meanCt.toFixed(2)
                    : '—'
                }
                hint="Threshold cycle"
              />
              <MetricCard
                label="NTC status"
                value={snapshotStats.ntcStatus}
                hintTone={
                  snapshotStats.ntcStatus === 'Clean'
                    ? 'success'
                    : snapshotStats.ntcStatus === 'Contaminated'
                      ? 'danger'
                      : 'warning'
                }
              />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
