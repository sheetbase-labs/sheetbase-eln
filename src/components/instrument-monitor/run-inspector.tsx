import { Badge } from '#/components/ui'
import {
  CONNECTION_STATUS_LABELS,
  CONNECTION_STATUS_TOKENS,
  QC_CHECK_LABELS,
  QC_CHECK_TOKENS,
} from '#/lib/instrument-monitor'
import type {
  FileIngestionStatus,
  Instrument,
  InstrumentQcCheck,
  InstrumentRawFile,
  InstrumentRun,
  InstrumentRunLink,
} from '#/lib/instrument-monitor'
import { cn } from '#/lib/utils'

export interface RunInspectorProps {
  run: InstrumentRun | null
  instrument: Instrument | null
  qcChecks: InstrumentQcCheck[]
  rawFiles: InstrumentRawFile[]
  runLinks: InstrumentRunLink[]
  timeZone: string
}

const FILE_TOKENS: Record<FileIngestionStatus, string> = {
  pending: 'bg-slate-100 text-slate-600',
  complete: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
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
      <header className="border-b p-4">
        <h2 className="text-sm font-semibold">{run.runIdentifier}</h2>
        <p className="text-xs text-muted-foreground">Run inspector</p>
      </header>
      <section className="border-b p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
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
          <dd className="font-medium">{formatElapsed(run.elapsedSeconds)}</dd>
          <dt className="text-muted-foreground">Operator</dt>
          <dd className="font-medium">{run.operator ?? '—'}</dd>
          <dt className="text-muted-foreground">Connection</dt>
          <dd>
            {instrument ? (
              <Badge
                className={cn(
                  CONNECTION_STATUS_TOKENS[instrument.connectionStatus],
                )}
              >
                {CONNECTION_STATUS_LABELS[instrument.connectionStatus]}
              </Badge>
            ) : (
              '—'
            )}
          </dd>
        </dl>
      </section>
      <section className="border-b p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          QC checks
        </h3>
        {qcChecks.length ? (
          <ul className="space-y-2">
            {qcChecks.map((check) => (
              <li key={check.id} className="rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <Badge className={cn(QC_CHECK_TOKENS[check.checkType])}>
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
      <section className="border-b p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
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
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(file.sizeBytes)}
                  </p>
                </div>
                <Badge
                  className={cn(
                    'capitalize',
                    FILE_TOKENS[file.ingestionStatus],
                  )}
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
      <section className="p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
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
