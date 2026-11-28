'use client'

import { Link } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import { useMemo } from 'react'

import { mapTimelineEvents } from '#/components/audit/record-history-events'
import { RecordHistoryTimeline } from '#/components/audit/record-history-timeline'
import { useRecordModelTimeline } from '#/components/models/models-data'
import { RelatedWorkPanel } from '#/components/related-work/related-work-panel'
import { Property, PropertyList } from '#/components/scientific/property-list'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { InspectorSection } from '#/components/ui/layout'
import type { RelatedWorkKind } from '#/lib/related-work'
import type { TimelineEventWire } from '#/lib/sign-002'
import { useUserNames } from '#/lib/user-names'
import { t } from '#/copy'

/** One of the record's other fields, as the side panel lists it. */
export interface RecordProperty {
  label: string
  /** Nothing, null or an empty string is an empty field. */
  value: React.ReactNode
  mono?: boolean
  wrap?: boolean
}

function isEmpty(value: React.ReactNode): boolean {
  return value === null || value === undefined || value === '' || value === '—'
}

/**
 * The record's other fields: everything the header does not already say.
 * Filled fields come first; empty ones fold under one line so a sparse record
 * does not read as a column of dashes. Tags end the section as chips.
 */
export function RecordProperties({
  items,
  tags,
  onAddTag,
  action,
  children,
}: {
  items: readonly RecordProperty[]
  tags?: readonly string[]
  onAddTag?: () => void
  /** An Edit link at the end of the heading. */
  action?: React.ReactNode
  /** Fields a model adds, rendered after the page's own. */
  children?: React.ReactNode
}) {
  const filled = items.filter((item) => !isEmpty(item.value))
  const empty = items.filter((item) => isEmpty(item.value))

  return (
    <InspectorSection
      title={t('notebook.recordPage.properties')}
      action={action}
    >
      <PropertyList>
        {filled.map((item) => (
          <Property
            key={item.label}
            label={item.label}
            mono={item.mono}
            wrap={item.wrap}
          >
            {item.value}
          </Property>
        ))}
      </PropertyList>
      {empty.length > 0 ? (
        <details data-record-empty-fields className="group mt-2">
          <summary className="cursor-pointer list-none text-label text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            {t('notebook.recordPage.emptyFields', { count: empty.length })}
          </summary>
          <PropertyList className="mt-2">
            {empty.map((item) => (
              <Property key={item.label} label={item.label}>
                <span className="font-normal text-fg-faint">
                  {t('notebook.recordPage.notSet')}
                </span>
              </Property>
            ))}
          </PropertyList>
        </details>
      ) : null}
      {children}
      {tags && (tags.length > 0 || onAddTag) ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="kind"
              className="px-2 py-0 text-[0.6875rem]"
            >
              {tag}
            </Badge>
          ))}
          {onAddTag ? (
            <Button variant="quiet" size="sm" icon="plus" onClick={onAddTag}>
              {t('notebook.recordPage.addTag')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </InspectorSection>
  )
}

/** How many links the side panel shows before "Show all". */
export const RECORD_LINKS_LIMIT = 5

/** What links to the record and what it links to, less what the header says. */
export function RecordLinks({
  kind = 'record',
  id,
  exclude,
}: {
  kind?: RelatedWorkKind
  id: string
  exclude?: readonly string[]
}) {
  return (
    <RelatedWorkPanel
      kind={kind}
      id={id}
      title={t('notebook.recordPage.links')}
      exclude={exclude}
      limit={RECORD_LINKS_LIMIT}
    />
  )
}

/** How many events the side panel shows before "All history". */
export const RECENT_ACTIVITY_LIMIT = 5

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

/** "Today", "Yesterday" or the date, for a group of the day's events. */
export function activityDayLabel(iso: string, now = new Date()): string {
  const day = new Date(iso)

  const start = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()

  const days = Math.round((start(now) - start(day)) / 86_400_000)

  if (days === 0) return t('notebook.recordPage.today')

  if (days === 1) return t('notebook.recordPage.yesterday')

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: day.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(day)
}

/** The last few events, newest first, grouped by day. */
export function recentActivityGroups(
  events: readonly TimelineEventWire[],
  nameOf: (userId: string) => string | undefined,
  limit = RECENT_ACTIVITY_LIMIT,
) {
  const newest = [...events].sort((a, b) => b.ts.localeCompare(a.ts))
  const mapped = mapTimelineEvents(newest, undefined, undefined, nameOf)

  const ts = new Map(
    newest.map((event) => [`${event.type}-${event.id}`, event.ts]),
  )

  const groups: { day: string; label: string; items: typeof mapped }[] = []

  for (const event of mapped.slice(0, limit)) {
    const at = ts.get(event.id) ?? ''
    const key = dayKey(at)
    const last = groups.at(-1)

    if (last?.day === key) last.items.push(event)
    else groups.push({ day: key, label: activityDayLabel(at), items: [event] })
  }

  return { groups, total: mapped.length }
}

/**
 * The record's last few events, grouped by day, with a way to the whole
 * history in the History tab.
 */
export function RecordActivity({
  recordId,
  historyLink,
  onShowHistory,
}: {
  recordId: string
  /** The History tab's address, for a page whose tabs are addresses. */
  historyLink?: LinkProps
  /** Opens the History tab, for a page whose tabs are in-page. */
  onShowHistory?: () => void
}) {
  const timeline = useRecordModelTimeline(recordId)
  const events = timeline.data ?? []

  const actorIds = useMemo(
    () =>
      (timeline.data ?? []).flatMap((event) =>
        event.actorUserId ? [event.actorUserId] : [],
      ),
    [timeline.data],
  )

  const { names } = useUserNames(actorIds)
  const { groups, total } = recentActivityGroups(events, (id) => names[id])

  const allHistory =
    total > 0 && historyLink ? (
      <Link {...historyLink} className="text-link">
        {t('notebook.recordPage.allHistory')}
      </Link>
    ) : total > 0 && onShowHistory ? (
      <button type="button" className="text-link" onClick={onShowHistory}>
        {t('notebook.recordPage.allHistory')}
      </button>
    ) : null

  return (
    <InspectorSection
      title={t('notebook.recordPage.activity')}
      action={allHistory}
    >
      {timeline.isLoading ? (
        <p className="text-label text-fg-muted">{t('common.states.loading')}</p>
      ) : groups.length === 0 ? (
        <p className="text-label text-fg-muted">
          {t('notebook.recordPage.noActivity')}
        </p>
      ) : (
        <div data-record-activity className="flex flex-col gap-3">
          {groups.map((group) => (
            <section key={group.day} className="flex flex-col gap-1.5">
              <h3 className="text-label text-fg-muted">{group.label}</h3>
              <ul className="flex flex-col gap-1.5">
                {group.items.map((event) => (
                  <li key={event.id} className="text-label leading-5 text-fg">
                    {event.title}
                    {event.target ? (
                      <span className="text-fg-muted"> · {event.target}</span>
                    ) : null}
                    {event.actor ? (
                      <span className="block text-fg-muted">
                        {event.actor.name} · {event.timestamp}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </InspectorSection>
  )
}

/** The History tab: the record's whole timeline. */
export function RecordHistoryTab({ recordId }: { recordId: string }) {
  const timeline = useRecordModelTimeline(recordId)

  return (
    <RecordHistoryTimeline
      events={timeline.data ?? []}
      loading={timeline.isLoading}
      error={timeline.error}
      onRefresh={() => void timeline.refetch()}
      refreshing={timeline.isFetching}
    />
  )
}
