/**
 * EventLog — dense, scannable operational event timeline for instrument runs.
 *
 * Design principles:
 * - Terminal/log density: 15+ events visible without scrolling
 * - Strong severity coding via color and weight
 * - Compact single-line entries with monospace timestamps
 * - Filter chips for event-type scoping
 * - Expandable rows for raw payload inspection
 * - Time-grouped headers for scanability
 * - Scroll fade indicators
 */
import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import {
  Activity,
  ArrowRightLeft,
  Check,
  ChevronRight,
  ClipboardCheck,
  Circle,
  CircleDot,
  Grid3x3,
  Heart,
  Play,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type {
  InstrumentObservation,
  ObservationType,
} from '#/lib/instrument-monitor'

export interface EventLogProps {
  observations: InstrumentObservation[]
  timeZone: string
  /** Whether the run is still active — shows a "Live" indicator. */
  isLive?: boolean
}

/* ------------------------------------------------------------------ */
/* Event type configuration                                           */
/* ------------------------------------------------------------------ */

type Severity = 'error' | 'success' | 'info' | 'warning' | 'routine'

interface EventTypeConfig {
  icon: LucideIcon
  /** Short label for filter chips and grouping. */
  category: 'run' | 'stage' | 'qc' | 'heartbeat' | 'plate' | 'status'
  severity: Severity
}

const EVENT_TYPE_CONFIG: Partial<Record<ObservationType, EventTypeConfig>> = {
  run_start: { icon: Play, category: 'run', severity: 'info' },
  run_complete: { icon: Check, category: 'run', severity: 'success' },
  run_fail: { icon: XCircle, category: 'run', severity: 'error' },
  stage_start: { icon: CircleDot, category: 'stage', severity: 'info' },
  stage_complete: { icon: Check, category: 'stage', severity: 'success' },
  plate_snapshot: { icon: Grid3x3, category: 'plate', severity: 'routine' },
  qc_result: { icon: ClipboardCheck, category: 'qc', severity: 'warning' },
  heartbeat: { icon: Heart, category: 'heartbeat', severity: 'routine' },
  status_change: { icon: ArrowRightLeft, category: 'status', severity: 'info' },
  telemetry: { icon: Activity, category: 'heartbeat', severity: 'routine' },
}

const DEFAULT_CONFIG: EventTypeConfig = {
  icon: Circle,
  category: 'status',
  severity: 'routine',
}

const SEVERITY_DOT_CLASS: Record<Severity, string> = {
  error: 'bg-destructive',
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  routine: 'bg-muted-foreground/40',
}

const SEVERITY_TEXT_CLASS: Record<Severity, string> = {
  error: 'text-destructive font-medium',
  success: 'text-success',
  info: 'text-info',
  warning: 'text-warning-foreground',
  routine: 'text-muted-foreground',
}

/* ------------------------------------------------------------------ */
/* Filter configuration                                               */
/* ------------------------------------------------------------------ */

type FilterKey = 'all' | 'errors' | 'stages' | 'qc' | 'heartbeats'

interface FilterDef {
  key: FilterKey
  label: string
  /** Returns true if the observation matches this filter. */
  match: (type: ObservationType, config: EventTypeConfig) => boolean
}

const FILTERS: FilterDef[] = [
  {
    key: 'all',
    label: 'All',
    match: () => true,
  },
  {
    key: 'errors',
    label: 'Errors',
    match: (_type, config) =>
      config.severity === 'error' || config.severity === 'warning',
  },
  {
    key: 'stages',
    label: 'Stages',
    match: (type) => type === 'stage_start' || type === 'stage_complete',
  },
  {
    key: 'qc',
    label: 'QC',
    match: (type) => type === 'qc_result',
  },
  {
    key: 'heartbeats',
    label: 'Routine',
    match: (_type, config) => config.severity === 'routine',
  },
]

/* ------------------------------------------------------------------ */
/* Payload description extraction                                     */
/* ------------------------------------------------------------------ */

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function describeEvent(
  type: ObservationType,
  payload: Record<string, unknown>,
): string {
  const name = str(payload.name)
  const cyclesCompleted = num(payload.cyclesCompleted)

  switch (type) {
    case 'run_start': {
      const plateFormat = str(payload.plateFormat)
      return plateFormat
        ? `Run started · ${plateFormat}-well plate`
        : 'Run started'
    }
    case 'stage_start': {
      const targetTemp = num(payload.targetTemperature)
      const cycleCount = num(payload.cycleCount)
      const detail =
        targetTemp !== undefined
          ? ` · ${targetTemp}°C`
          : cycleCount !== undefined
            ? ` · ${cycleCount} cycles`
            : ''
      return `Stage '${name ?? 'Unnamed'}' started${detail}`
    }
    case 'stage_complete':
      return `Stage '${name ?? 'Unnamed'}' completed${cyclesCompleted !== undefined ? ` · ${cyclesCompleted} cycles` : ''}`
    case 'run_complete': {
      const progressPercent = num(payload.progressPercent)
      const details = [
        cyclesCompleted !== undefined ? `${cyclesCompleted} cycles` : null,
        progressPercent !== undefined ? `${progressPercent}%` : null,
      ].filter(Boolean)
      return `Run completed${details.length ? ` · ${details.join(' · ')}` : ''}`
    }
    case 'run_fail': {
      const error = str(payload.error)
      return error ? `Run failed: ${error}` : 'Run failed'
    }
    case 'plate_snapshot': {
      const cycle = num(payload.cycle)
      const wells = payload.wells
      const wellCount =
        wells && typeof wells === 'object' && !Array.isArray(wells)
          ? Object.keys(wells).length
          : 0
      return `Plate snapshot${cycle !== undefined ? ` · cycle ${cycle}` : ''} · ${wellCount} wells`
    }
    case 'qc_result': {
      const checks = payload.checks
      if (!Array.isArray(checks)) return 'QC results'
      const fails = checks.filter(
        (c) =>
          c &&
          typeof c === 'object' &&
          (c as Record<string, unknown>).checkType === 'fail',
      ).length
      const passes = checks.filter(
        (c) =>
          c &&
          typeof c === 'object' &&
          (c as Record<string, unknown>).checkType === 'pass',
      ).length
      if (fails > 0) return `QC: ${fails} failed · ${passes} passed`
      return `QC: ${passes}/${checks.length} passed`
    }
    case 'heartbeat': {
      const blockTemp = num(payload.blockTemp)
      return `Heartbeat${blockTemp !== undefined ? ` · ${blockTemp}°C block` : ''}`
    }
    case 'status_change': {
      const from = str(payload.from)
      const to = str(payload.to)
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
  if (elapsedSeconds < 5) return 'now'
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}m`
  return `${Math.floor(elapsedSeconds / 3600)}h`
}

/* ------------------------------------------------------------------ */
/* Time grouping                                                      */
/* ------------------------------------------------------------------ */

function groupLabel(ageMs: number): string {
  if (ageMs < 5 * 60_000) return 'Last 5 minutes'
  if (ageMs < 60 * 60_000) return 'Last hour'
  if (ageMs < 6 * 60 * 60_000) return 'Last 6 hours'
  return 'Earlier'
}

interface EventGroup {
  label: string
  events: InstrumentObservation[]
}

function groupByRecency(
  events: InstrumentObservation[],
  now: number,
): EventGroup[] {
  const groups: Map<string, InstrumentObservation[]> = new Map()
  const order = ['Last 5 minutes', 'Last hour', 'Last 6 hours', 'Earlier']

  for (const event of events) {
    const age = now - new Date(event.sourceTimestamp).getTime()
    const label = groupLabel(age)
    const list = groups.get(label) ?? []
    list.push(event)
    groups.set(label, list)
  }

  return order
    .filter((label) => groups.has(label))
    .map((label) => ({ label, events: groups.get(label)! }))
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export function EventLog({ observations, timeZone, isLive = false }: EventLogProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isScrolled, setIsScrolled] = useState(false)

  const allEvents = useMemo(
    () =>
      observations
        .filter((o) => o.observationType !== 'telemetry')
        .sort(
          (a, b) =>
            new Date(b.sourceTimestamp).getTime() -
            new Date(a.sourceTimestamp).getTime(),
        ),
    [observations],
  )

  const filteredEvents = useMemo(() => {
    if (activeFilter === 'all') return allEvents
    const filter = FILTERS.find((f) => f.key === activeFilter)!
    return allEvents.filter((event) => {
      const config = EVENT_TYPE_CONFIG[event.observationType] ?? DEFAULT_CONFIG
      return filter.match(event.observationType, config)
    })
  }, [allEvents, activeFilter])

  const now = Date.now()
  const groups = useMemo(
    () => groupByRecency(filteredEvents, now),
    [filteredEvents, now],
  )

  const filterCounts = useMemo(() => {
    const counts: Record<FilterKey, number> = {
      all: allEvents.length,
      errors: 0,
      stages: 0,
      qc: 0,
      heartbeats: 0,
    }
    for (const event of allEvents) {
      const config = EVENT_TYPE_CONFIG[event.observationType] ?? DEFAULT_CONFIG
      if (config.severity === 'error' || config.severity === 'warning')
        counts.errors++
      if (event.observationType === 'stage_start' || event.observationType === 'stage_complete')
        counts.stages++
      if (event.observationType === 'qc_result') counts.qc++
      if (config.severity === 'routine') counts.heartbeats++
    }
    return counts
  }, [allEvents])

  // Auto-scroll to top (newest) on mount
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    setIsScrolled(scrollRef.current.scrollTop > 4)
  }, [])

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  if (allEvents.length === 0) {
    return (
      <p className="px-4 py-12 text-center text-sm text-muted-foreground">
        No events recorded yet.
      </p>
    )
  }

  const absoluteFormatter = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Filter bar + count */}
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((filter) => {
            const count = filterCounts[filter.key]
            const isActive = activeFilter === filter.key
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setActiveFilter(filter.key)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                }`}
              >
                {filter.label}
                <span className="tabular-nums text-muted-foreground/70">
                  {count}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isLive ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-success">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
              Live
            </span>
          ) : null}
          <span className="text-xs tabular-nums text-muted-foreground">
            {filteredEvents.length} events
          </span>
        </div>
      </div>

      {/* Scrollable event list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative min-h-0 flex-1 overflow-y-auto"
      >
        {/* Top fade when scrolled */}
        {isScrolled ? (
          <div className="pointer-events-none sticky top-0 z-10 h-2 bg-gradient-to-b from-background to-transparent" />
        ) : null}

        <div className="py-1">
          {groups.map((group) => (
            <div key={group.label} className="mb-1">
              {/* Group header */}
              <div className="sticky top-0 z-[1] bg-background/95 px-3 py-1 backdrop-blur-sm">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                  {group.label}
                </span>
              </div>
              {/* Event rows */}
              {group.events.map((event) => {
                const config =
                  EVENT_TYPE_CONFIG[event.observationType] ?? DEFAULT_CONFIG
                const Icon = config.icon
                const isExpanded = expandedId === event.id
                const hasBadIngestion =
                  event.ingestionStatus === 'failed' ||
                  event.ingestionStatus === 'duplicate'

                return (
                  <div key={event.id}>
                    <button
                      type="button"
                      onClick={() => toggleExpand(event.id)}
                      className="flex w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-accent/40"
                    >
                      {/* Expand chevron */}
                      <ChevronRight
                        className={`size-3 shrink-0 text-muted-foreground/50 transition-transform ${
                          isExpanded ? 'rotate-90' : ''
                        }`}
                        aria-hidden="true"
                      />
                      {/* Severity dot */}
                      <span
                        className={`size-2 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[config.severity]}`}
                        aria-hidden="true"
                      />
                      {/* Icon */}
                      <Icon
                        className={`size-3.5 shrink-0 ${SEVERITY_TEXT_CLASS[config.severity]}`}
                        aria-hidden="true"
                      />
                      {/* Description */}
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${SEVERITY_TEXT_CLASS[config.severity]}`}
                      >
                        {describeEvent(event.observationType, event.payload)}
                      </span>
                      {/* Ingestion indicator */}
                      {hasBadIngestion ? (
                        <span
                          className={`shrink-0 text-xs font-medium uppercase ${
                            event.ingestionStatus === 'failed'
                              ? 'text-destructive'
                              : 'text-warning-foreground'
                          }`}
                        >
                          {event.ingestionStatus}
                        </span>
                      ) : null}
                      {/* Timestamp */}
                      <time
                        dateTime={event.sourceTimestamp}
                        title={absoluteFormatter.format(
                          new Date(event.sourceTimestamp),
                        )}
                        className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
                      >
                        {formatRelative(event.sourceTimestamp)}
                      </time>
                    </button>
                    {/* Expanded payload */}
                    {isExpanded ? (
                      <pre className="mx-3 mb-1.5 overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-xs text-muted-foreground">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Bottom fade */}
        <div className="pointer-events-none sticky bottom-0 h-2 bg-gradient-to-t from-background to-transparent" />
      </div>
    </div>
  )
}
