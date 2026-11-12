import { Fragment, useMemo } from 'react'

import { t } from '#/copy'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { localClock } from '#/lib/pipelines/start-rules'
import type { StartWindow } from '#/lib/pipelines/start-rules'
import { buildTimeline } from '#/lib/pipelines/starts-view'
import type { DotKind, TimelineItem } from '#/lib/pipelines/starts-view'
import type { PipelineRunWire } from '#/lib/pipelines/types'
import { cn } from '#/lib/utils'

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
        className="tl"
      >
        {days.map((day) => {
          const weekend = day.weekday === 'Sat' || day.weekday === 'Sun'

          const shaded =
            window !== null &&
            (window.days === 'daily' ||
              (window.days === 'weekdays' ? !weekend : weekend))

          return (
            <Fragment key={day.key}>
              <div className={cn('dl0', day.today && 'today')}>
                {day.weekday} {day.day}
              </div>
              <div className="tr">
                {shaded ? (
                  <span
                    aria-hidden="true"
                    className="win"
                    style={{
                      left: pct(from),
                      width: `${((to - from) / 1440) * 100}%`,
                    }}
                  />
                ) : null}
                {day.today ? (
                  <span
                    aria-hidden="true"
                    className="now"
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
                        className="rd skip"
                        style={{ left }}
                      />
                    )
                  }

                  const selected = picked === item.runId

                  return (
                    <Fragment key={item.id}>
                      {item.label ? (
                        <span
                          aria-hidden="true"
                          className={cn('rl', selected && 'on')}
                          style={{
                            right: `calc(${(1 - item.fraction) * 100}% + 11px)`,
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
                        className={cn('rd', item.kind, selected && 'sel')}
                        style={{ left }}
                      />
                    </Fragment>
                  )
                })}
              </div>
            </Fragment>
          )
        })}
        <span />
        <div
          aria-label={t('features.pipelineStarts.runs.axisLabel')}
          className="ax"
        >
          {ticks.map((minutes) => (
            <span key={minutes} style={{ left: pct(minutes) }}>
              {String(Math.floor(minutes / 60)).padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>
      {runs.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>
          {t('features.pipelineStarts.runs.none')}
        </div>
      ) : null}
    </div>
  )
}

export function TimelineLegend({ hasWindow }: { hasWindow: boolean }) {
  return (
    <div className="lg">
      {LEGEND.map((kind) => (
        <span key={kind}>
          <i className={cn('lgi', kind)} />
          {t(`features.pipelineStarts.runs.legend.${kind}`)}
        </span>
      ))}
      {hasWindow ? (
        <span>
          <i className="lgi window" />
          {t('features.pipelineStarts.runs.legend.window')}
        </span>
      ) : null}
    </div>
  )
}
