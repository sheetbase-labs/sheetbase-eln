import { t } from '#/copy'
import { Muted } from '#/components/ui/layout'
import { Status } from '#/components/ui/status'
import { dateTimeFormat } from '#/lib/intl-cache'
import { nextStarts, readsOnlyChanged } from '#/lib/pipelines/starts-view'
import type { StartRules } from '#/lib/pipelines/start-rules'
import type { PipelineScheduleWire } from '#/lib/pipelines/types'
import { scheduleSpecLabel } from '#/routes/pipelines/-schedule-labels'

/** "Thu 12 · 07:00" in the person's zone. */
export function dayAndTime(at: Date, timeZone: string): string {
  const day = dateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
  }).format(at)

  const time = dateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at)

  return `${day} · ${time}`
}

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
    <section className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <h3 className="text-label font-semibold">
          {t('features.pipelineStarts.next.title')}
        </h3>
        <span className="text-caption text-fg-muted">{timeZone}</span>
      </div>
      {next.length === 0 ? (
        <Muted>{t('features.pipelineStarts.next.none')}</Muted>
      ) : (
        <ul className="m-0 list-none p-0">
          {next.map((start) => {
            const schedule = schedules.find((s) => s.id === start.scheduleId)

            return (
              <li
                key={`${start.scheduleId}-${start.at.toISOString()}`}
                className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-2.5 border-b border-border-subtle py-1.5 text-caption"
              >
                <span className="num pt-px text-fg-muted">
                  {dayAndTime(start.at, timeZone)}
                </span>
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-body">
                      {schedule
                        ? scheduleSpecLabel(
                            schedule.kind,
                            schedule.spec,
                            datasetNames,
                          )
                        : t('features.pipelineStarts.composer.schedule')}
                    </span>
                    <span className="block text-[11px] text-fg-muted">
                      {start.state === 'outside'
                        ? t('features.pipelineStarts.next.outsideWhy')
                        : start.onlyIfChanged ||
                            (schedule && readsOnlyChanged(schedule))
                          ? t('features.pipelineStarts.next.onlyIfChanged')
                          : t('features.pipelineStarts.next.anyTime')}
                    </span>
                  </span>
                  <Status
                    tone={start.state === 'planned' ? 'none' : 'stored'}
                    className="shrink-0 text-fg-muted"
                  >
                    {start.state === 'planned'
                      ? t('features.pipelineStarts.next.planned')
                      : t('features.pipelineStarts.next.outside')}
                  </Status>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {hasSnapshot ? (
        <Muted>{t('features.pipelineStarts.next.snapshotsHint')}</Muted>
      ) : null}
    </section>
  )
}
