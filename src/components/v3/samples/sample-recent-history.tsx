import { cn } from '#/lib/utils'
import type { SampleEvent } from '#/lib/samples'

import { formatSampleEventDay, sampleEventSummary } from './sample-history'
import { t } from '#/copy'

/**
 * LAB-03 — the sample inspector's Recent history (SampleDetail / SampleLineage
 * / SampleUsage). Each row is the canonical `api.sample_events` stream reduced
 * to the design's "23 Sep · Gareth P. withdrew 10,350 mL" line: the day, the
 * actor's display name (resolved by the caller) and a short sentence derived
 * from the operation and its quantity/location. Events the sample never had
 * simply do not render; a sample with no events says so.
 */
export function SampleRecentHistory({
  events,
  actorLabel,
  limit = 3,
}: {
  events: readonly SampleEvent[]
  /** Resolve an event to its actor's display name, or null when unknown. */
  actorLabel: (event: SampleEvent) => string | null
  limit?: number
}) {
  const rows = events.slice(0, limit)
  if (rows.length === 0) {
    return (
      <p className="m-0 text-caption text-fg-muted">
        {t('library.samples.sampleRecentHistory.noEventsRecorded')}
      </p>
    )
  }
  return (
    <div className="flex flex-col text-caption">
      {rows.map((event, index) => {
        const actor = actorLabel(event)
        return (
          <div
            key={event.id}
            className={cn(
              'grid grid-cols-[58px_1fr] gap-2 py-[5px]',
              index < rows.length - 1 && 'border-b border-border-subtle',
            )}
          >
            <span className="num text-fg-muted">
              {formatSampleEventDay(event.createdAt)}
            </span>
            <span>
              {actor ? `${actor} ` : ''}
              {sampleEventSummary(event)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
