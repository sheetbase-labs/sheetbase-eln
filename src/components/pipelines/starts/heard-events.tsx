import { Link } from '@tanstack/react-router'

import { t } from '#/copy'
import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
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
    <section className="flex flex-col gap-1">
      <h3 className="text-label font-semibold">
        {t('features.pipelineStarts.heard.title', { count: shown.length })}
      </h3>
      {shown.length === 0 ? (
        <Muted>{t('features.pipelineStarts.heard.none')}</Muted>
      ) : (
        <ul className="m-0 list-none p-0">
          {shown.map((row) => {
            const outcome = OUTCOMES[row.kind]
            const joined = Number(row.detail.joined ?? 0)
            const number = row.run_id ? numbers?.get(row.run_id) : undefined

            return (
              <li
                key={row.id}
                className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-2.5 border-b border-border-subtle py-1.5 text-caption"
              >
                <span className="num pt-px text-fg-muted">
                  {when(row.occurred_at)}
                </span>
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-body">
                      {row.label ?? sourceLabel(row.source)}
                      {joined > 0 ? (
                        <span className="ml-1.5 text-fg-muted">
                          {t('features.pipelineStarts.heard.joined', {
                            count: joined,
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-[11px] text-fg-muted">
                      {row.message || outcome.why()}
                    </span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap">
                    <Status tone={outcome.tone}>
                      {outcome.label()}
                      {row.run_id && number ? (
                        <>
                          {' '}
                          <Link
                            to="/pipelines/$pipelineId/runs/$runId"
                            params={{ pipelineId, runId: row.run_id }}
                            className="text-link hover:underline"
                          >
                            #{number}
                          </Link>
                        </>
                      ) : null}
                    </Status>
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
