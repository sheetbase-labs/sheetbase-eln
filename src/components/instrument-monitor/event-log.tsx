import {
  Activity,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  ClipboardCheck,
  Grid3x3,
  Play,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Badge } from '#/components/ui'
import type {
  InstrumentObservation,
  ObservationType,
} from '#/lib/instrument-monitor'

export interface EventLogProps {
  observations: InstrumentObservation[]
  timeZone: string
}

type EventVariant = 'success' | 'info' | 'danger' | 'warning' | 'secondary'

interface EventConfig {
  icon: LucideIcon
  label: string
  variant: EventVariant
  iconClassName: string
}

const EVENT_CONFIG: Partial<Record<ObservationType, EventConfig>> = {
  run_start: {
    icon: Play,
    label: 'Run started',
    variant: 'success',
    iconClassName: 'border-success/20 bg-success/10 text-success',
  },
  run_complete: {
    icon: CheckCircle2,
    label: 'Run complete',
    variant: 'success',
    iconClassName: 'border-success/20 bg-success/10 text-success',
  },
  run_fail: {
    icon: XCircle,
    label: 'Run failed',
    variant: 'danger',
    iconClassName: 'border-destructive/20 bg-destructive/10 text-destructive',
  },
  stage_start: {
    icon: CircleDot,
    label: 'Stage started',
    variant: 'info',
    iconClassName: 'border-info/20 bg-info/10 text-info',
  },
  stage_complete: {
    icon: Check,
    label: 'Stage complete',
    variant: 'success',
    iconClassName: 'border-success/20 bg-success/10 text-success',
  },
  plate_snapshot: {
    icon: Grid3x3,
    label: 'Plate snapshot',
    variant: 'secondary',
    iconClassName: 'border-border bg-secondary text-secondary-foreground',
  },
  qc_result: {
    icon: ClipboardCheck,
    label: 'QC results',
    variant: 'info',
    iconClassName: 'border-info/20 bg-info/10 text-info',
  },
  heartbeat: {
    icon: Activity,
    label: 'Heartbeat',
    variant: 'secondary',
    iconClassName: 'border-border bg-secondary text-secondary-foreground',
  },
  status_change: {
    icon: ArrowRightLeft,
    label: 'Status change',
    variant: 'secondary',
    iconClassName: 'border-border bg-secondary text-secondary-foreground',
  },
  telemetry: {
    icon: Circle,
    label: 'Telemetry',
    variant: 'secondary',
    iconClassName: 'border-border bg-secondary text-secondary-foreground',
  },
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function describeEvent(
  type: ObservationType,
  payload: Record<string, unknown>,
): string {
  const name = stringValue(payload.name)
  const cyclesCompleted = numberValue(payload.cyclesCompleted)

  switch (type) {
    case 'run_start': {
      const plateFormat = stringValue(payload.plateFormat)
      return plateFormat
        ? `Run started · ${plateFormat}-well plate`
        : 'Run started'
    }
    case 'stage_start': {
      const targetTemperature = numberValue(payload.targetTemperature)
      const cycleCount = numberValue(payload.cycleCount)
      const detail =
        targetTemperature !== undefined
          ? ` · ${targetTemperature}°C`
          : cycleCount !== undefined
            ? ` · ${cycleCount} cycles`
            : ''
      return `Stage '${name ?? 'Unnamed'}' started${detail}`
    }
    case 'stage_complete':
      return `Stage '${name ?? 'Unnamed'}' completed${cyclesCompleted !== undefined ? ` · ${cyclesCompleted} cycles` : ''}`
    case 'run_complete': {
      const progressPercent = numberValue(payload.progressPercent)
      const details = [
        cyclesCompleted !== undefined ? `${cyclesCompleted} cycles` : null,
        progressPercent !== undefined ? `${progressPercent}%` : null,
      ].filter(Boolean)
      return `Run completed${details.length ? ` · ${details.join(' · ')}` : ''}`
    }
    case 'run_fail': {
      const error = stringValue(payload.error)
      return error ? `Run failed: ${error}` : 'Run failed'
    }
    case 'plate_snapshot': {
      const cycle = numberValue(payload.cycle)
      const wells = payload.wells
      const wellCount =
        wells && typeof wells === 'object' && !Array.isArray(wells)
          ? Object.keys(wells).length
          : 0
      return `Plate snapshot${cycle !== undefined ? ` · cycle ${cycle}` : ''} · ${wellCount} wells`
    }
    case 'qc_result':
      return `QC results: ${Array.isArray(payload.checks) ? payload.checks.length : 0} checks`
    case 'heartbeat': {
      const blockTemp = numberValue(payload.blockTemp)
      return `Heartbeat${blockTemp !== undefined ? ` · ${blockTemp}°C block` : ''}`
    }
    case 'status_change': {
      const from = stringValue(payload.from)
      const to = stringValue(payload.to)
      return from && to ? `Status: ${from} → ${to}` : 'Status change'
    }
    default:
      return type
  }
}

export function formatRelative(timestamp: string): string {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000),
  )
  if (elapsedSeconds < 5) return 'just now'
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}m ago`
  return `${Math.floor(elapsedSeconds / 3600)}h ago`
}

export function EventLog({ observations, timeZone }: EventLogProps) {
  const events = observations
    .filter((observation) => observation.observationType !== 'telemetry')
    .sort(
      (left, right) =>
        new Date(right.sourceTimestamp).getTime() -
        new Date(left.sourceTimestamp).getTime(),
    )
    .slice(0, 50)

  if (events.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        No events recorded yet.
      </p>
    )
  }

  const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone,
  })

  return (
    <div className="max-h-80 overflow-y-auto px-4 py-3">
      <ol className="ml-3 border-l">
        {events.map((event) => {
          const config = EVENT_CONFIG[event.observationType] ?? {
            icon: Circle,
            label: event.observationType,
            variant: 'secondary' as const,
            iconClassName:
              'border-border bg-secondary text-secondary-foreground',
          }
          const Icon = config.icon

          return (
            <li key={event.id} className="relative pb-5 pl-7 last:pb-1">
              <span
                className={`absolute -left-3.5 flex size-7 items-center justify-center rounded-full border ${config.iconClassName}`}
              >
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={config.variant}>{config.label}</Badge>
                    {event.ingestionStatus === 'failed' ? (
                      <Badge variant="danger">Ingestion failed</Badge>
                    ) : null}
                    {event.ingestionStatus === 'duplicate' ? (
                      <Badge variant="warning">Duplicate</Badge>
                    ) : null}
                  </div>
                  <p className="text-sm tabular-nums">
                    {describeEvent(event.observationType, event.payload)}
                  </p>
                </div>
                <time
                  dateTime={event.sourceTimestamp}
                  className="shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground tabular-nums"
                >
                  <span className="block">
                    {formatRelative(event.sourceTimestamp)}
                  </span>
                  <span className="block">
                    {timeFormatter.format(new Date(event.sourceTimestamp))}
                  </span>
                </time>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
