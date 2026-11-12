import { Fragment } from 'react'
import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { BoardStatus } from '#/features/pipelines/board/board'
import { dateTimeFormat } from '#/lib/intl-cache'
import type { PipelineScheduleActivityWire } from '#/lib/pipelines/types'

import { OUTCOMES } from './outcomes'

const sourceLabel = (source: PipelineScheduleActivityWire['source']): string =>
  source === 'webhook'
    ? t('features.pipelineStarts.heard.webhook')
    : source === 'event'
      ? t('features.pipelineStarts.heard.event')
      : t('features.pipelineStarts.composer.schedule')

/** The newest few things the starts heard, each with what it did and why. The
 * full log is the pipeline's activity. */
export function HeardEvents({
  rows,
  pipelineId,
  numbers,
  now,
  timeZone,
  limit = 5,
}: {
  rows: PipelineScheduleActivityWire[]
  pipelineId: string
  numbers: Map<string, number> | undefined
  now: Date
  timeZone: string
  limit?: number
}) {
  const shown = rows.slice(0, limit)

  const dayKey = (at: Date) =>
    dateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(at)

  const when = (iso: string) => {
    const at = new Date(iso)

    const time = dateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(at)

    return dayKey(at) === dayKey(now)
      ? `${t('features.pipelineStarts.heard.today')} ${time}`
      : `${dateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric' }).format(at)} ${time}`
  }

  return (
    <section>
      <div className="h3row">
        <h3>
          {t('features.pipelineStarts.heard.title', { count: shown.length })}
        </h3>
      </div>
      {shown.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>
          {t('features.pipelineStarts.heard.none')}
        </div>
      ) : (
        <div className="ns">
          {shown.map((row) => {
            const outcome = OUTCOMES[row.kind]
            const joined = Number(row.detail.joined ?? 0)
            const number = row.run_id ? numbers?.get(row.run_id) : undefined

            return (
              <Fragment key={row.id}>
                <span className="w">{when(row.occurred_at)}</span>
                <span className="e">
                  <span className="top">
                    <span>
                      {row.label ?? sourceLabel(row.source)}
                      {joined > 0 ? (
                        <span className="muted">
                          {' '}
                          {t('features.pipelineStarts.heard.joined', {
                            count: joined,
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span className="res">
                      <BoardStatus tone={outcome.tone}>
                        {outcome.label()}
                        {row.run_id && number ? (
                          <>
                            {' '}
                            <Link
                              to="/pipelines/$pipelineId/runs/$runId"
                              params={{ pipelineId, runId: row.run_id }}
                            >
                              #{number}
                            </Link>
                          </>
                        ) : null}
                      </BoardStatus>
                    </span>
                  </span>
                  <span className="why">{row.message || outcome.why()}</span>
                </span>
              </Fragment>
            )
          })}
        </div>
      )}
    </section>
  )
}
