import { Badge, Separator } from '#/components/ui'
import {
  CONNECTION_STATUS_BADGE_VARIANT,
  CONNECTION_STATUS_LABELS,
  FILE_INGESTION_BADGE_VARIANT,
  QC_CHECK_BADGE_VARIANT,
  QC_CHECK_LABELS,
} from '#/lib/instrument-monitor'
import type {
  Instrument,
  InstrumentQcCheck,
  InstrumentRawFile,
  InstrumentRun,
  InstrumentRunLink,
} from '#/lib/instrument-monitor'

export interface RunInspectorProps {
  run: InstrumentRun | null
  instrument: Instrument | null
  qcChecks: InstrumentQcCheck[]
  rawFiles: InstrumentRawFile[]
  runLinks: InstrumentRunLink[]
  timeZone: string
}

function formatDate(value: string | null, timeZone: string): string {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
      }).format(new Date(value))
    : '—'
}
function formatElapsed(seconds: number | null): string {
  if (seconds == null) return '—'
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`
}
function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  const unit = Math.min(
    Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)),
    units.length - 1,
  )
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function RunInspector({
  run,
  instrument,
  qcChecks,
  rawFiles,
  runLinks,
  timeZone,
}: RunInspectorProps) {
  if (!run)
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          No run selected
        </p>
      </div>
    )
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="space-y-1 p-4">
        <h2 className="text-sm font-semibold">{run.runIdentifier}</h2>
        <p className="text-xs text-muted-foreground">Run inspector</p>
      </header>
      <Separator />
      <section className="space-y-3 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Run info
        </h3>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Instrument</dt>
          <dd className="font-medium">{instrument?.name ?? '—'}</dd>
          <dt className="text-muted-foreground">Model</dt>
          <dd className="font-medium">{instrument?.model ?? '—'}</dd>
          <dt className="text-muted-foreground">Serial number</dt>
          <dd className="font-medium">{instrument?.serialNumber ?? '—'}</dd>
          <dt className="text-muted-foreground">Protocol</dt>
          <dd className="font-medium">{run.protocolName ?? '—'}</dd>
          <dt className="text-muted-foreground">Started</dt>
          <dd className="font-medium">{formatDate(run.startedAt, timeZone)}</dd>
          <dt className="text-muted-foreground">Completed</dt>
          <dd className="font-medium">
            {formatDate(run.completedAt, timeZone)}
          </dd>
          <dt className="text-muted-foreground">Elapsed</dt>
          <dd className="font-medium tabular-nums">
            {formatElapsed(run.elapsedSeconds)}
          </dd>
          <dt className="text-muted-foreground">Operator</dt>
          <dd className="font-medium">{run.operator ?? '—'}</dd>
          <dt className="text-muted-foreground">Connection</dt>
          <dd>
            {instrument ? (
              <Badge
                variant={
                  CONNECTION_STATUS_BADGE_VARIANT[instrument.connectionStatus]
                }
                className="whitespace-nowrap"
              >
                {CONNECTION_STATUS_LABELS[instrument.connectionStatus]}
              </Badge>
            ) : (
              '—'
            )}
          </dd>
        </dl>
      </section>
      <Separator />
      <section className="space-y-3 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          QC checks
        </h3>
        {qcChecks.length ? (
          <ul className="space-y-2">
            {qcChecks.map((check) => (
              <li key={check.id} className="rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={QC_CHECK_BADGE_VARIANT[check.checkType]}
                    className="whitespace-nowrap"
                  >
                    {QC_CHECK_LABELS[check.checkType]}
                  </Badge>
                  <span className="text-xs font-medium">{check.checkName}</span>
                </div>
                {check.message ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {check.message}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No QC checks yet.</p>
        )}
      </section>
      <Separator />
      <section className="space-y-3 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Raw files
        </h3>
        {rawFiles.length ? (
          <ul className="space-y-2">
            {rawFiles.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between gap-2 rounded-md border p-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {file.filename}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatBytes(file.sizeBytes)}
                  </p>
                </div>
                <Badge
                  variant={FILE_INGESTION_BADGE_VARIANT[file.ingestionStatus]}
                  className="whitespace-nowrap capitalize"
                >
                  {file.ingestionStatus}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No raw files.</p>
        )}
      </section>
      <Separator />
      <section className="space-y-3 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Linked records
        </h3>
        {runLinks.length ? (
          <ul className="space-y-2">
            {runLinks.map((link) => (
              <li key={link.id} className="rounded-md border p-2">
                <div className="flex justify-between gap-2">
                  <span className="truncate text-xs font-medium">
                    {link.linkedRecordIdentifier ?? 'Unidentified record'}
                  </span>
                  <Badge variant="outline" className="capitalize">
                    {link.linkType}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {link.linkedRecordTitle ?? 'Untitled'}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No linked records.</p>
        )}
      </section>
    </div>
  )
}
