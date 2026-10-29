import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useDisplayTimeZone } from '#/lib/display-time-zone'
import { Button, buttonVariants } from '#/components/v3/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import {
  auditEventMatchesCategory,
  auditHistoryCategories,
  auditKnockOnEvents,
  auditLinkFor,
  describeAuditEvent,
  fetchRecordAuditHistory,
  groupAuditEventsByDay,
} from '#/lib/audit-history'
import type { AuditEventWire, AuditHistoryCategory } from '#/lib/audit-history'
import { notebookDataClient } from '#/lib/notebook-data'
import { Tabs } from '#/components/v3/ui/tabs'
import { SavedTrails } from './saved-trails'
import {
  fetchWorkspaceGeneral,
  workspaceGeneralQueryKey,
} from '#/lib/workspace-general'
import { t } from '#/copy'

function actor(event: AuditEventWire) {
  return (
    event.actorName ??
    event.actorUserId ??
    (event.actorCredentialId
      ? t('projects.experimentHistory.apiCredential')
      : t('projects.experimentHistory.system'))
  )
}

function captured(event: AuditEventWire, key: string) {
  return typeof event.payload[key] === 'string'
    ? event.payload[key]
    : t('projects.experimentHistory.notCaptured')
}

export function ExperimentHistory({
  recordId,
  identifier,
}: {
  recordId: string
  identifier: string
}) {
  const history = useQuery({
    queryKey: ['record-audit-history', recordId],
    queryFn: () => fetchRecordAuditHistory(notebookDataClient, recordId),
  })
  const workspace = useQuery({
    queryKey: workspaceGeneralQueryKey,
    queryFn: () => fetchWorkspaceGeneral(),
  })
  // The person's own zone; the workspace's only when they have not set one.
  const displayZone = useDisplayTimeZone(workspace.data?.timezone)
  if (history.isPending || workspace.isPending)
    return (
      <p className="p-6 text-fg-muted" role="status">
        {t('projects.experimentHistory.loading')}
      </p>
    )
  if (history.error || workspace.error || !workspace.data)
    return (
      <div className="p-6">
        <p role="alert">{t('projects.experimentHistory.loadFailed')}</p>
        <Button
          onClick={() => {
            void history.refetch()
            void workspace.refetch()
          }}
        >
          {t('projects.experimentHistory.retry')}
        </Button>
      </div>
    )
  return (
    <ExperimentHistoryView
      key={recordId}
      recordId={recordId}
      identifier={identifier}
      events={history.data.events}
      snapshotBefore={history.data.snapshotBefore}
      timeZone={displayZone}
      extra={<SavedTrails recordId={recordId} />}
    />
  )
}

export function ExperimentHistoryView({
  recordId,
  identifier,
  events,
  snapshotBefore,
  timeZone,
  extra,
}: {
  recordId: string
  identifier: string
  events: AuditEventWire[]
  snapshotBefore: number
  timeZone: string
  /** Shown between the filters and the table, e.g. the saved trails. */
  extra?: React.ReactNode
}) {
  const [category, setCategory] = useState<AuditHistoryCategory>('all')
  const [actorId, setActorId] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const actors = new Map(
    events
      .filter((event) => event.actorUserId)
      .map((event) => [event.actorUserId, actor(event)]),
  )
  const byActor = events.filter(
    (event) => !actorId || event.actorUserId === actorId,
  )
  const visible = byActor.filter((event) =>
    auditEventMatchesCategory(event, category),
  )
  const selected = visible.find((event) => event.id === selectedId)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  })
  const exportQuery = new URLSearchParams({
    category,
    before: String(snapshotBefore),
  })
  if (actorId) exportQuery.set('actor', actorId)
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-history-ready="true"
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-6 py-2">
        <Tabs
          mode="state"
          variant="segment"
          label={t('projects.experimentHistory.category')}
          value={category}
          onValueChange={(next) => {
            setCategory(next as (typeof auditHistoryCategories)[number])
            setSelectedId(null)
          }}
          items={auditHistoryCategories.map((kind) => ({
            key: kind,
            label: (
              <span className="capitalize">
                {t(`projects.experimentHistory.categories.${kind}`)}
              </span>
            ),
            count: byActor.filter((event) =>
              auditEventMatchesCategory(event, kind),
            ).length,
          }))}
        />
        <label className="ml-auto flex items-center gap-1 text-label">
          {t('projects.experimentHistory.actorColon')}
          <select
            aria-label={t('projects.experimentHistory.actorFilter')}
            className="rounded border border-border bg-surface p-1 text-fg"
            value={actorId}
            onChange={(event) => {
              setActorId(event.target.value)
              setSelectedId(null)
            }}
          >
            <option value="">
              {t('projects.experimentHistory.anyone', {
                count: events.length,
              })}
            </option>
            {Array.from(
              actors,
              ([id, name]) =>
                id && (
                  <option key={id} value={id}>
                    {name} (
                    {events.filter((event) => event.actorUserId === id).length})
                  </option>
                ),
            )}
          </select>
        </label>
        <a
          className={buttonVariants({ size: 'sm' })}
          href={`/api/export/record/${recordId}/audit?${exportQuery}`}
        >
          {t('projects.experimentHistory.export')}
        </a>
      </div>
      {extra}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden">
        <div className="min-w-0 shrink-0 overflow-auto lg:flex-1">
          <Table
            aria-label={t('projects.experimentHistory.tableLabel', {
              identifier,
            })}
          >
            <TableHeader>
              <TableRow>
                {(
                  [
                    'time',
                    'actor',
                    'action',
                    'object',
                    'field',
                    'change',
                    'reason',
                  ] as const
                ).map((key) => (
                  <TableHead key={key}>
                    {t(`projects.experimentHistory.fields.${key}`)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupAuditEventsByDay(visible, timeZone).map((day) => (
                <Fragment key={day.label}>
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="bg-surface-muted text-label text-fg-muted"
                    >
                      {day.label}
                    </TableCell>
                  </TableRow>
                  {day.events.map((event) => {
                    const described = describeAuditEvent(event)
                    return (
                      <TableRow
                        key={event.id}
                        selected={event.id === selectedId}
                      >
                        <TableCell>
                          <time dateTime={event.createdAt}>
                            {time.format(new Date(event.createdAt))}
                          </time>
                        </TableCell>
                        <TableCell>{actor(event)}</TableCell>
                        <TableCell>
                          <button
                            type="button"
                            className="text-left focus-visible:outline-2 focus-visible:outline-focus"
                            aria-label={t(
                              'projects.experimentHistory.inspect',
                              {
                                sequence: event.sequence,
                                action: described.action,
                                subject: described.subject,
                              },
                            )}
                            onClick={() => setSelectedId(event.id)}
                          >
                            {described.action}
                          </button>
                        </TableCell>
                        <TableCell>{described.subject}</TableCell>
                        <TableCell>
                          {described.changes
                            .map((change) => change.label)
                            .join(', ') || '—'}
                        </TableCell>
                        <TableCell>
                          {described.changes.length
                            ? described.changes.map((change) => (
                                <div key={change.label}>
                                  <span className="text-fg-muted line-through">
                                    {change.from ?? '—'}
                                  </span>{' '}
                                  → {change.to ?? '—'}
                                </div>
                              ))
                            : t('projects.experimentHistory.notCaptured')}
                        </TableCell>
                        <TableCell className="max-w-80 whitespace-normal">
                          {captured(event, 'reason') ===
                          t('projects.experimentHistory.notCaptured')
                            ? '—'
                            : captured(event, 'reason')}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </Fragment>
              ))}
              {!visible.length && (
                <TableRow>
                  <TableCell colSpan={7}>
                    {t('projects.experimentHistory.emptySelection', {
                      what:
                        category === 'all'
                          ? t('projects.experimentHistory.auditEntries')
                          : t(
                              `projects.experimentHistory.categories.${category}`,
                            ),
                    })}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {selected && (
          <EntryDetails
            event={selected}
            events={events}
            timeZone={timeZone}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
      <div className="flex justify-between border-t border-border px-6 py-2 text-label text-fg-muted">
        <span>
          {t('projects.experimentHistory.entries', {
            shown: visible.length,
            total: events.length,
          })}
        </span>
        <span>
          {t('projects.experimentHistory.timesIn', { zone: timeZone })}
        </span>
      </div>
    </div>
  )
}

function EntryDetails({
  event,
  events,
  timeZone,
  onClose,
}: {
  event: AuditEventWire
  events: AuditEventWire[]
  timeZone: string
  onClose: () => void
}) {
  const described = describeAuditEvent(event)
  const effects = auditKnockOnEvents(event, events)
  const link = auditLinkFor(event)
  return (
    <aside
      aria-label={t('projects.experimentHistory.details.label')}
      className="w-full min-w-0 shrink-0 space-y-[18px] overflow-y-auto border-t border-border p-4 text-body lg:w-[300px] lg:border-l lg:border-t-0"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium">
          {t('projects.experimentHistory.details.entry')}
        </h3>
        <Button
          size="sm"
          variant="quiet"
          onClick={onClose}
          aria-label={t('projects.experimentHistory.details.close')}
        >
          {t('common.actions.close')}
        </Button>
      </div>
      <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1.5 [overflow-wrap:anywhere]">
        <dt className="text-fg-muted">
          {t('projects.experimentHistory.details.when')}
        </dt>
        <dd>
          {new Intl.DateTimeFormat('en-GB', {
            timeZone,
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short',
          }).format(new Date(event.createdAt))}
        </dd>
        <dt className="text-fg-muted">
          {t('projects.experimentHistory.fields.actor')}
        </dt>
        <dd>{actor(event)}</dd>
        <dt className="text-fg-muted">
          {t('projects.experimentHistory.fields.action')}
        </dt>
        <dd>{described.action}</dd>
        <dt className="text-fg-muted">
          {t('projects.experimentHistory.fields.object')}
        </dt>
        <dd>
          {link ? (
            <a className="text-primary-text" href={link.href}>
              {described.subject}
            </a>
          ) : (
            described.subject
          )}
        </dd>
        {described.changes.map((change) => (
          <Fragment key={change.label}>
            <dt className="text-fg-muted">
              {t('projects.experimentHistory.fields.field')}
            </dt>
            <dd>{change.label}</dd>
            <dt className="text-fg-muted">
              {t('projects.experimentHistory.details.oldValue')}
            </dt>
            <dd className="whitespace-pre-wrap">{change.from ?? '—'}</dd>
            <dt className="text-fg-muted">
              {t('projects.experimentHistory.details.newValue')}
            </dt>
            <dd className="whitespace-pre-wrap">{change.to ?? '—'}</dd>
          </Fragment>
        ))}
        {!described.changes.length && (
          <>
            <dt className="text-fg-muted">
              {t('projects.experimentHistory.details.values')}
            </dt>
            <dd>{t('projects.experimentHistory.notCaptured')}</dd>
          </>
        )}
        <dt className="text-fg-muted">
          {t('projects.experimentHistory.fields.reason')}
        </dt>
        <dd>{captured(event, 'reason')}</dd>
        <dt className="text-fg-muted">
          {t('projects.experimentHistory.details.session')}
        </dt>
        <dd className="mono text-label">{captured(event, 'sessionId')}</dd>
        <dt className="text-fg-muted">
          {t('projects.experimentHistory.details.client')}
        </dt>
        <dd className="mono text-label">
          {event.clientId ?? t('projects.experimentHistory.notCaptured')}
        </dd>
      </dl>
      <section aria-label={t('projects.experimentHistory.knockOn.title')}>
        <h3 className="mb-2 font-medium">
          {t('projects.experimentHistory.knockOn.title')}
        </h3>
        {effects.length ? (
          <ul className="space-y-2">
            {effects.map((effect) => {
              const item = describeAuditEvent(effect)
              return (
                <li key={effect.id}>
                  {item.action} {item.subject}
                  {item.changes.map((change) => (
                    <div key={change.label}>
                      {change.label}: {change.from ?? '—'} → {change.to ?? '—'}
                    </div>
                  ))}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-fg-muted">
            {t('projects.experimentHistory.knockOn.none')}
          </p>
        )}
      </section>
      <p className="text-label text-fg-muted">
        {t('projects.experimentHistory.systemWritten')}
      </p>
    </aside>
  )
}
