import { Fragment } from 'react'

import { t } from '#/copy'
import { BoardStatus } from '#/features/pipelines/board/board'
import {
  dayAndTime,
  nextStarts,
  readsOnlyChanged,
} from '#/lib/pipelines/starts-view'
import type { StartRules } from '#/lib/pipelines/start-rules'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'
import { scheduleSpecLabel } from '#/routes/pipelines/-schedule-labels'

/** The next timed starts across every enabled schedule, as the rules would
 * treat them: one outside the hours is shown, and shown as skipped. */
export function NextStarts({
  schedules,
  rules,
  now,
  timeZone,
  datasetNames,
}: {
  schedules: PipelineScheduleWire[]
  rules: StartRules
  now: Date
  timeZone: string
  datasetNames: Map<string, string>
}) {
  const next = nextStarts(schedules, rules, now, 3)
  const hasSnapshot = schedules.some((s) => s.enabled && s.kind === 'event')

  return (
    <section>
      <div className="h3row">
        <h3>{t('features.pipelineStarts.next.title')}</h3>
        <span className="muted" style={{ fontSize: 11 }}>
          {timeZone}
        </span>
      </div>
      {next.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>
          {t('features.pipelineStarts.next.none')}
        </div>
      ) : (
        <div className="ns">
          {next.map((start) => {
            const schedule = schedules.find((s) => s.id === start.scheduleId)

            return (
              <Fragment key={`${start.scheduleId}-${start.at.toISOString()}`}>
                <span className="w">{dayAndTime(start.at, timeZone)}</span>
                <span className="e">
                  <span className="top">
                    <span>
                      {schedule
                        ? scheduleSpecLabel(
                            schedule.kind,
                            schedule.spec,
                            datasetNames,
                          )
                        : t('features.pipelineStarts.composer.schedule')}
                    </span>
                    <span className="res">
                      <BoardStatus
                        tone={start.state === 'planned' ? 'none' : 'draft'}
                      >
                        {start.state === 'planned'
                          ? t('features.pipelineStarts.next.planned')
                          : t('features.pipelineStarts.next.outside')}
                      </BoardStatus>
                    </span>
                  </span>
                  <span className="why">
                    {start.state === 'outside'
                      ? t('features.pipelineStarts.next.outsideWhy')
                      : start.onlyIfChanged ||
                          (schedule && readsOnlyChanged(schedule))
                        ? t('features.pipelineStarts.next.onlyIfChanged')
                        : t('features.pipelineStarts.next.anyTime')}
                  </span>
                </span>
              </Fragment>
            )
          })}
        </div>
      )}
      {hasSnapshot ? (
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          {t('features.pipelineStarts.next.snapshotsHint')}
        </div>
      ) : null}
    </section>
  )
}
