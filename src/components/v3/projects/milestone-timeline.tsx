import { Icon } from '#/components/v3/icons'
import type { MilestoneRiskState, StudyTaskStatus } from '#/lib/planner'
import { cn } from '#/lib/utils'
import { now as appNow } from '#/lib/clock'
import { formatDate } from '#/lib/format-date'

/**
 * The project plan timeline (R5-CONFIG-05): a month/week scale, a today
 * marker, phase bars, client-visible rings and dependency elbows, drawn from
 * real milestone dates and real dependency edges. Pure functions are exported
 * so the scale and windowing can be tested without a route.
 */
export type MilestoneScale = 'month' | 'week'

export const MILESTONE_SCALES: { value: MilestoneScale; label: string }[] = [
  { value: 'month', label: 'Months' },
  { value: 'week', label: 'Weeks' },
]

export interface PlanMilestone {
  id: string
  title: string
  dueAt: string | null
  status: StudyTaskStatus
  /** 'unknown' when the risk read model has no row for this milestone. */
  risk: MilestoneRiskState | 'unknown'
  clientVisible: boolean
  workstreamId: string | null
}

export interface PlanPhase {
  id: string
  name: string
}

export interface PlanDependency {
  id: string
  predecessorId: string
  successorId: string
}

const DAY = 24 * 60 * 60 * 1000

/** Monday 00:00 of the week containing `time`. */
export function startOfWeek(time: number): number {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day)
  return date.getTime()
}

/**
 * The window the scale draws: whole months or whole weeks that contain every
 * milestone date and today, so the today marker is always in range.
 */
export function timelineWindow(
  dates: number[],
  now: number,
  scale: MilestoneScale,
): { start: number; end: number } {
  const times = [...dates, now]
  const min = Math.min(...times)
  const max = Math.max(...times)
  if (scale === 'week') {
    const start = startOfWeek(min)
    return { start, end: startOfWeek(max) + 7 * DAY }
  }
  const start = new Date(min)
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  const end = new Date(max)
  end.setMonth(end.getMonth() + 1, 1)
  end.setHours(0, 0, 0, 0)
  return { start: start.getTime(), end: end.getTime() }
}

export interface TimelineTick {
  at: number
  label: string
}

/** Month or week ticks across the window. */
export function timelineTicks(
  start: number,
  end: number,
  scale: MilestoneScale,
): TimelineTick[] {
  const ticks: TimelineTick[] = []
  const cursor = new Date(start)
  if (scale === 'week') {
    while (cursor.getTime() < end) {
      ticks.push({
        at: cursor.getTime(),
        label: cursor.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
        }),
      })
      cursor.setDate(cursor.getDate() + 7)
    }
    return ticks
  }
  cursor.setDate(1)
  while (cursor.getTime() < end) {
    ticks.push({
      at: cursor.getTime(),
      label: cursor.toLocaleDateString('en-GB', { month: 'short' }),
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return ticks
}

export interface PhaseBand {
  id: string
  name: string
  milestones: PlanMilestone[]
  start: number
  end: number
}

/**
 * One band per phase that has milestones, in the phases' own order, with an
 * "Unphased" band last. A band's range is the span of its milestones' dates.
 */
export function phaseBands(
  milestones: PlanMilestone[],
  phases: PlanPhase[],
): PhaseBand[] {
  const bands: PhaseBand[] = []
  const byPhase = new Map<string | null, PlanMilestone[]>()
  for (const milestone of milestones) {
    const bucket = byPhase.get(milestone.workstreamId)
    if (bucket) bucket.push(milestone)
    else byPhase.set(milestone.workstreamId, [milestone])
  }
  for (const phase of phases) {
    const inPhase = byPhase.get(phase.id)
    if (!inPhase?.length) continue
    bands.push({ id: phase.id, name: phase.name, ...span(inPhase) })
  }
  const unphased = byPhase.get(null)
  if (unphased?.length) {
    bands.push({ id: 'unphased', name: 'Unphased', ...span(unphased) })
  }
  return bands
}

function span(milestones: PlanMilestone[]): {
  milestones: PlanMilestone[]
  start: number
  end: number
} {
  const dated = milestones.filter((m) => m.dueAt)
  const times = dated.map((m) => Date.parse(m.dueAt!))
  return {
    milestones,
    start: times.length ? Math.min(...times) : 0,
    end: times.length ? Math.max(...times) : 0,
  }
}

const RISK_FILL: Record<PlanMilestone['risk'], string> = {
  done: 'bg-success',
  late: 'bg-danger',
  at_risk: 'bg-warning',
  on_track: 'bg-link',
  unknown: 'bg-border-strong',
}

const BAND_HEIGHT = 52
const HEADER_HEIGHT = 24
/** Diamonds sit in the upper part of a band, their label underneath. */
const BAND_CENTRE = 22

export function MilestoneTimeline({
  milestones,
  phases,
  dependencies,
  scale,
  onScaleChange,
  selectedId,
  onSelect,
  now = appNow().getTime(),
}: {
  milestones: PlanMilestone[]
  phases: PlanPhase[]
  dependencies: PlanDependency[]
  scale: MilestoneScale
  onScaleChange: (scale: MilestoneScale) => void
  selectedId: string | null
  onSelect: (id: string) => void
  now?: number
}) {
  const dated = milestones.filter((m) => m.dueAt)
  if (dated.length === 0) return null

  const { start, end } = timelineWindow(
    dated.map((m) => Date.parse(m.dueAt!)),
    now,
    scale,
  )
  const width = end - start || 1
  const at = (time: number) => ((time - start) / width) * 100
  const ticks = timelineTicks(start, end, scale)
  const bands = phaseBands(milestones, phases)
  const rowOf = new Map<string, number>()
  bands.forEach((band, index) => {
    band.milestones.forEach((m) => rowOf.set(m.id, index))
  })
  const visible = new Set(milestones.map((m) => m.id))
  const edges = dependencies.filter(
    (d) => visible.has(d.predecessorId) && visible.has(d.successorId),
  )
  const todayLabel = new Date(now).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
  const finished = milestones.filter((m) => m.status === 'completed').length

  return (
    <section aria-label="Milestone timeline" className="mb-3 max-md:hidden">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div
          role="radiogroup"
          aria-label="Timeline scale"
          className="inline-flex rounded-md border border-border bg-surface p-0.5"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const index = MILESTONE_SCALES.findIndex((s) => s.value === scale)
            const next =
              MILESTONE_SCALES[
                (index + (event.key === 'ArrowRight' ? 1 : -1) + 2) %
                  MILESTONE_SCALES.length
              ]
            onScaleChange(next.value)
          }}
        >
          {MILESTONE_SCALES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={option.value === scale}
              tabIndex={option.value === scale ? 0 : -1}
              onClick={() => onScaleChange(option.value)}
              className={cn(
                'h-6 cursor-pointer rounded border-0 bg-transparent px-2.5 text-label font-medium',
                option.value === scale
                  ? 'bg-surface-hover text-fg'
                  : 'text-fg-muted hover:text-fg',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="m-0 text-label text-fg-muted">
          {finished} of {milestones.length} done ·{' '}
          {milestones.filter((m) => m.risk === 'late').length} late ·{' '}
          {milestones.filter((m) => m.risk === 'at_risk').length} at risk
        </p>
      </div>

      <div className="relative overflow-hidden rounded-md border border-border bg-surface-muted/40">
        <div className="absolute top-0 bottom-0 right-3 left-[140px]">
          <div className="absolute inset-0">
            {ticks.map((tick) => (
              <span
                key={tick.at}
                className="absolute top-0 bottom-0 border-l border-border-subtle"
                style={{ left: `${at(tick.at)}%` }}
              >
                <span className="absolute top-1 left-1 text-caption whitespace-nowrap text-fg-muted">
                  {tick.label}
                </span>
              </span>
            ))}
          </div>
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            {edges.map((edge) => {
              const from = dated.find((m) => m.id === edge.predecessorId)
              const to = dated.find((m) => m.id === edge.successorId)
              if (!from || !to) return null
              const x1 = at(Date.parse(from.dueAt!))
              const x2 = at(Date.parse(to.dueAt!))
              const y1 =
                (rowOf.get(from.id) ?? 0) * BAND_HEIGHT +
                HEADER_HEIGHT +
                BAND_CENTRE
              const y2 =
                (rowOf.get(to.id) ?? 0) * BAND_HEIGHT +
                HEADER_HEIGHT +
                BAND_CENTRE
              const mid = (x1 + x2) / 2
              return (
                <path
                  key={edge.id}
                  data-dependency={edge.id}
                  d={`M ${x1}% ${y1} H ${mid}% V ${y2} H ${x2}%`}
                  fill="none"
                  strokeDasharray="3 3"
                  className="stroke-border-strong"
                />
              )
            })}
          </svg>
          <div
            data-today=""
            className="absolute top-0 bottom-0 border-l border-dashed border-fg-muted"
            style={{ left: `${at(now)}%` }}
          >
            <span className="absolute top-1 ml-1 rounded-[3px] bg-inverse px-1 text-caption whitespace-nowrap text-inverse-foreground">
              Today {todayLabel}
            </span>
          </div>
        </div>

        <div
          className="grid grid-cols-[140px_minmax(0,1fr)] items-center border-b border-border-subtle"
          style={{ height: HEADER_HEIGHT }}
        >
          <div className="px-3 text-caption text-fg-muted">Phase</div>
        </div>
        {bands.map((band) => (
          <div
            key={band.id}
            style={{ height: BAND_HEIGHT }}
            className="grid grid-cols-[140px_minmax(0,1fr)] items-center border-b border-border-subtle last:border-b-0"
          >
            <div className="min-w-0 px-3">
              <div className="truncate text-label font-medium">{band.name}</div>
              <div className="truncate text-caption text-fg-muted">
                {band.start
                  ? `${new Date(band.start).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })} – ${new Date(band.end).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })}`
                  : 'No dates'}
              </div>
            </div>
            <div className="relative mr-3 h-full">
              {band.start ? (
                <span
                  aria-hidden="true"
                  data-band={band.id}
                  className={cn(
                    'absolute h-2 -translate-y-1/2 rounded-full',
                    band.end < now
                      ? band.milestones.every((m) => m.status === 'completed')
                        ? 'bg-success-wash'
                        : 'bg-danger-wash'
                      : band.start <= now && now <= band.end
                        ? 'bg-selection'
                        : 'bg-surface-hover',
                  )}
                  style={{
                    top: BAND_CENTRE,
                    left: `${at(band.start)}%`,
                    width: `${Math.max(at(band.end) - at(band.start), 1)}%`,
                  }}
                />
              ) : null}
              {band.milestones.map((milestone) =>
                milestone.dueAt ? (
                  <span
                    key={`${milestone.id}-label`}
                    aria-hidden="true"
                    className="pointer-events-none absolute max-w-[140px] -translate-x-1/2 truncate text-caption text-fg-muted"
                    style={{
                      top: BAND_CENTRE + 12,
                      left: `${at(Date.parse(milestone.dueAt))}%`,
                    }}
                  >
                    {milestone.title}
                  </span>
                ) : null,
              )}
              {band.milestones.map((milestone) => {
                if (!milestone.dueAt) return null
                const label = milestone.title
                return (
                  <button
                    key={milestone.id}
                    type="button"
                    title={`${label} · ${formatDate(milestone.dueAt)} · ${milestone.risk}`}
                    aria-label={`${label}, due ${formatDate(milestone.dueAt)}, ${milestone.risk.replace('_', ' ')}`}
                    aria-pressed={milestone.id === selectedId}
                    onClick={() => onSelect(milestone.id)}
                    className={cn(
                      'absolute size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-pointer border-0 p-0',
                      RISK_FILL[milestone.risk],
                      milestone.clientVisible && 'ring-2 ring-focus',
                      milestone.id === selectedId && 'ring-2 ring-fg',
                    )}
                    style={{
                      top: BAND_CENTRE,
                      left: `${at(Date.parse(milestone.dueAt))}%`,
                    }}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-2 mb-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
        <span className="flex items-center gap-1">
          <span className="size-2 rotate-45 bg-link" /> On track
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rotate-45 bg-warning" /> At risk
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rotate-45 bg-danger" /> Late
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rotate-45 bg-success" /> Done
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rotate-45 bg-border-strong" /> Unknown risk
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full ring-2 ring-focus" />{' '}
          Client-visible
        </span>
        <span className="flex items-center gap-1">
          <Icon name="info" size={12} /> Dashed line: depends on
        </span>
      </p>
    </section>
  )
}
