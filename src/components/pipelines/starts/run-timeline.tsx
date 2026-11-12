import { useMemo } from 'react'

import { t } from '#/copy'
import { Muted } from '#/components/ui/layout'
import { Dot } from '#/components/ui/status'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { localClock } from '#/lib/pipelines/start-rules'
import type { StartWindow } from '#/lib/pipelines/start-rules'
import { buildTimeline } from '#/lib/pipelines/starts-view'
import type { DotKind, TimelineItem } from '#/lib/pipelines/starts-view'
import type { PipelineRunWire } from '#/lib/pipelines/types'
import { cn } from '#/lib/utils'

const DOT_CLASS: Record<DotKind, string> = {
  ok: 'bg-success',
  wait: 'bg-warning',
  bad: 'bg-danger',
  live: 'bg-link',
  skip: 'size-2.5 border-[1.5px] border-neutral-dot bg-surface',
}

const LEGEND = ['ok', 'wait', 'bad', 'skip'] as const

function dotOf(status: PipelineRunWire['status']): DotKind {
  if (status === 'succeeded') return 'ok'

  if (status === 'waiting') return 'wait'

  if (status === 'running') return 'live'

  return 'bad'
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)

  return h * 60 + m
}

const pct = (minutes: number) => `${(minutes / 1440) * 100}%`

/** The last 7 days of runs, one row a day, each dot where in the day it
 * started. The hours a start may begin are shaded; a start that did not run
 * is a ring. Pick a dot to read the run beneath. */
export function RunTimeline({
  runs,
  skips,
  numbers,
  now,
  timeZone,
  window,
  picked,
  onPick,
}: {
  runs: PipelineRunWire[]
  skips: { id: string; at: string }[]
  numbers: Map<string, number> | undefined
  now: Date
  timeZone: string
  window: StartWindow | null
  picked: string | null
  onPick: (runId: string) => void
}) {
  const items = useMemo<TimelineItem[]>(
    () => [
      ...runs.map((run) => {
        const kind = dotOf(run.status)
        const number = numbers?.get(run.id)

        return {
          id: run.id,
          at: new Date(run.started_at),
          kind,
          runId: run.id,
          label: number && kind !== 'ok' ? `#${number}` : undefined,
        }
      }),
      ...skips.map((skip) => ({
        id: skip.id,
        at: new Date(skip.at),
        kind: 'skip' as const,
        runId: null,
      })),
    ],
    [runs, skips, numbers],
  )

  const days = useMemo(
    () => buildTimeline({ items, now, days: 7, timeZone }),
    [items, now, timeZone],
  )

  const nowMinutes = (() => {
    const clock = localClock(now, timeZone)

    return clock.minutes
  })()

  const from = window ? toMinutes(window.from) : 0
  const to = window ? toMinutes(window.to) : 0

  const ticks = window ? [0, from, 720, to, 1440] : [0, 360, 720, 1080, 1440]

  return (
    <div>
      <div
        role="group"
        aria-label={t('features.pipelineStarts.runs.title')}
        className="grid grid-cols-[64px_minmax(0,1fr)] text-caption"
      >
        {days.map((day) => {
          const weekend = day.weekday === 'Sat' || day.weekday === 'Sun'

          const shaded =
            window !== null &&
            (window.days === 'daily' ||
              (window.days === 'weekdays' ? !weekend : weekend))

          return (
            <div key={day.key} className="contents">
              <div
                className={cn(
                  'flex h-[30px] items-center border-b border-border-subtle text-fg-muted',
                  day.today && 'font-semibold text-fg',
                )}
              >
                {day.weekday} {day.day}
              </div>
              <div className="relative h-[30px] border-b border-border-subtle">
                {shaded ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 bg-surface-muted"
                    style={{
                      left: pct(from),
                      width: `${((to - from) / 1440) * 100}%`,
                    }}
                  />
                ) : null}
                {day.today ? (
                  <span
                    aria-hidden="true"
                    className="absolute -inset-y-0.5 border-l border-dashed border-fg-muted"
                    style={{ left: pct(nowMinutes) }}
                  />
                ) : null}
                {day.items.map((item) => {
                  const left = `${item.fraction * 100}%`

                  if (!item.runId) {
                    return (
                      <span
                        key={item.id}
                        aria-hidden="true"
                        className={cn(
                          'absolute top-1/2 -ml-[5px] -mt-[5px] size-2.5 rounded-full',
                          DOT_CLASS.skip,
                        )}
                        style={{ left }}
                      />
                    )
                  }

                  const selected = picked === item.runId

                  return (
                    <span key={item.id}>
                      {item.label ? (
                        <span
                          aria-hidden="true"
                          className={cn(
                            'pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] text-fg-muted',
                            selected && 'font-semibold text-fg',
                          )}
                          style={{
                            right: `calc(${(1 - item.fraction) * 100}% + 10px)`,
                          }}
                        >
                          {item.label}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={t('features.pipelineStarts.runs.dotLabel', {
                          status: t(
                            `features.pipelineStarts.runs.legend.${item.kind}`,
                          ),
                          time: formatNotebookDateTime(item.at.toISOString(), {
                            zone: true,
                          }),
                        })}
                        onClick={() => onPick(item.runId ?? '')}
                        className={cn(
                          'absolute top-1/2 -ml-1.5 -mt-1.5 size-3 cursor-pointer rounded-full border-0 p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                          DOT_CLASS[item.kind],
                          selected &&
                            'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--link)]',
                        )}
                        style={{ left }}
                      />
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div />
        <div
          aria-label={t('features.pipelineStarts.runs.axisLabel')}
          className="relative h-5 text-[11px] text-fg-faint"
        >
          {ticks.map((minutes) => (
            <span
              key={minutes}
              className="num absolute top-1 -translate-x-1/2"
              style={{ left: pct(minutes) }}
            >
              {String(Math.floor(minutes / 60)).padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>
      {runs.length === 0 ? (
        <Muted>{t('features.pipelineStarts.runs.none')}</Muted>
      ) : null}
    </div>
  )
}

export function TimelineLegend({ hasWindow }: { hasWindow: boolean }) {
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 text-caption text-fg-muted">
      {LEGEND.map((kind) => (
        <li key={kind} className="flex items-center gap-1.5">
          {kind === 'skip' ? (
            <span
              aria-hidden="true"
              className="inline-block size-[9px] rounded-full border-[1.5px] border-neutral-dot"
            />
          ) : (
            <Dot
              tone={kind === 'ok' ? 'ok' : kind === 'wait' ? 'warn' : 'bad'}
            />
          )}
          {t(`features.pipelineStarts.runs.legend.${kind}`)}
        </li>
      ))}
      {hasWindow ? (
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-[9px] rounded-[2px] border border-border bg-surface-muted"
          />
          {t('features.pipelineStarts.runs.legend.window')}
        </li>
      ) : null}
    </ul>
  )
}
