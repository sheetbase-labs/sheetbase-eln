import { t } from '#/copy'
import { Muted, Section } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { relativeTime } from '#/lib/pipeline-schedule-form'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { nextStarts } from '#/lib/pipelines/starts-view'
import type { StartRules } from '#/lib/pipelines/start-rules'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'

/** The next timed starts across every enabled schedule, as the rules would
 * treat them: one outside the hours is shown, and shown as skipped. */
export function NextStarts({
  schedules,
  rules,
  now,
}: {
  schedules: PipelineScheduleWire[]
  rules: StartRules
  now: Date
}) {
  const next = nextStarts(schedules, rules, now, 3)
  const hasSnapshot = schedules.some((s) => s.enabled && s.kind === 'event')

  return (
    <Section title={t('features.pipelineStarts.next.title')}>
      {next.length === 0 ? (
        <Muted>{t('features.pipelineStarts.next.none')}</Muted>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {next.map((start) => {
            const iso = start.at.toISOString()

            return (
              <li
                key={`${start.scheduleId}-${iso}`}
                className="flex flex-col gap-0.5 rounded-md border border-line bg-surface px-3 py-2"
              >
                <span className="flex flex-wrap items-baseline gap-x-2 text-body">
                  <span className="num font-medium">
                    {formatNotebookDateTime(iso, { zone: true })}
                  </span>
                  <span className="text-caption text-fg-muted">
                    {relativeTime(iso, now)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-x-3 text-caption text-fg-muted">
                  <Status tone={start.state === 'planned' ? 'ok' : 'warn'}>
                    {start.state === 'planned'
                      ? t('features.pipelineStarts.next.planned')
                      : t('features.pipelineStarts.next.outside')}
                  </Status>
                  {start.onlyIfChanged ? (
                    <span>
                      {t('features.pipelineStarts.next.onlyIfChanged')}
                    </span>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {hasSnapshot ? (
        <Muted>{t('features.pipelineStarts.next.snapshotsHint')}</Muted>
      ) : null}
    </Section>
  )
}
