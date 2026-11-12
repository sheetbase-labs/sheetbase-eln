import { useMemo, useState } from 'react'

import { t } from '#/copy'
import { Muted, Section } from '#/components/ui/layout'
import { Dot } from '#/components/ui/status'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { buildTimeline } from '#/lib/pipelines/starts-view'
import type { DotKind, TimelineItem } from '#/lib/pipelines/starts-view'
import type { PipelineRunWire } from '#/lib/pipelines/types'
import { cn } from '#/lib/utils'

import { SelectedRun } from './selected-run'

const DOT_TONE = {
  ok: 'ok',
  wait: 'warn',
  bad: 'bad',
  skip: 'stored',
  live: 'progress',
} as const

function dotOf(status: PipelineRunWire['status']): DotKind {
  if (status === 'succeeded') return 'ok'

  if (status === 'waiting') return 'wait'

  if (status === 'running') return 'live'

  return 'bad'
}

/** The last 7 days of runs, one column a day, each dot where in the day it
 * started; a start that did not run is a small grey dot. Pick a dot to read
 * the run beneath. */
export function RunTimeline({
  runs,
  activity,
  numbers,
  now,
  timeZone,
  pipelineId,
  workspaceId,
}: {
  runs: PipelineRunWire[]
  activity: { id: string; at: string; kind: string }[]
  numbers: Map<string, number> | undefined
  now: Date
  timeZone: string
  pipelineId: string
  workspaceId: string
}) {
  const [picked, setPicked] = useState<string | null>(null)

  const items = useMemo<TimelineItem[]>(
    () => [
      ...runs.map((run) => ({
        id: run.id,
        at: new Date(run.started_at),
        kind: dotOf(run.status),
        runId: run.id,
      })),
      ...activity
        .filter((a) => a.kind.startsWith('skipped_'))
        .map((a) => ({
          id: a.id,
          at: new Date(a.at),
          kind: 'skip' as const,
          runId: null,
        })),
    ],
    [runs, activity],
  )

  const days = useMemo(
    () => buildTimeline({ items, now, days: 7, timeZone }),
    [items, now, timeZone],
  )

  const selected = runs.find((run) => run.id === picked) ?? null
  const week = runs.length

  return (
    <Section
      title={t('features.pipelineStarts.runs.title')}
      count={t('features.pipelineStarts.runs.counts', { count: week })}
    >
      <div
        role="group"
        aria-label={t('features.pipelineStarts.runs.title')}
        className="grid grid-cols-7 gap-1.5"
      >
        {days.map((day) => (
          <div
            key={day.key}
            className={cn(
              'flex min-w-0 flex-col items-center gap-1 rounded-md border border-line bg-surface px-1 pb-1.5 pt-1',
              day.today && 'border-link',
            )}
          >
            <span className="text-caption text-fg-muted">
              {day.weekday} <span className="num">{day.day}</span>
            </span>
            <div
              className="relative h-28 w-full"
              aria-label={t('features.pipelineStarts.runs.day', {
                date: day.key,
              })}
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line"
              />
              {day.items.map((item) =>
                item.runId ? (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={picked === item.runId}
                    aria-label={t('features.pipelineStarts.runs.dotLabel', {
                      status: t(
                        `features.pipelineStarts.runs.legend.${item.kind}`,
                      ),
                      time: formatNotebookDateTime(item.at.toISOString(), {
                        zone: true,
                      }),
                    })}
                    onClick={() => setPicked(item.runId)}
                    style={{ top: `${item.fraction * 100}%` }}
                    className={cn(
                      'absolute left-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-transparent bg-surface hover:border-border-strong focus-visible:outline-2 focus-visible:outline-focus',
                      picked === item.runId && 'border-link',
                    )}
                  >
                    <Dot tone={DOT_TONE[item.kind]} className="size-2.5" />
                  </button>
                ) : (
                  <span
                    key={item.id}
                    style={{ top: `${item.fraction * 100}%` }}
                    className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2"
                  >
                    <Dot tone="stored" className="size-1.5 opacity-60" />
                  </span>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption text-fg-muted">
        {(['ok', 'wait', 'bad', 'live', 'skip'] as const).map((kind) => (
          <li key={kind} className="flex items-center gap-1.5">
            <Dot tone={DOT_TONE[kind]} />
            {t(`features.pipelineStarts.runs.legend.${kind}`)}
          </li>
        ))}
      </ul>
      {week === 0 ? (
        <Muted>{t('features.pipelineStarts.runs.none')}</Muted>
      ) : null}
      {selected ? (
        <SelectedRun
          run={selected}
          number={numbers?.get(selected.id)}
          pipelineId={pipelineId}
          workspaceId={workspaceId}
        />
      ) : week > 0 ? (
        <Muted>{t('features.pipelineStarts.runs.pick')}</Muted>
      ) : null}
    </Section>
  )
}
