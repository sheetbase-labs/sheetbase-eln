import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

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
import {
  fetchWorkspaceGeneral,
  workspaceGeneralQueryKey,
} from '#/lib/workspace-general'
import { cn } from '#/lib/utils'

function actor(event: AuditEventWire) {
  return (
    event.actorName ??
    event.actorUserId ??
    (event.actorCredentialId ? 'API credential' : 'System')
  )
}

function captured(event: AuditEventWire, key: string) {
  return typeof event.payload[key] === 'string'
    ? event.payload[key]
    : 'Not captured'
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
  if (history.isPending || workspace.isPending)
    return (
      <p className="p-6 text-fg-muted" role="status">
        Loading audit trail…
      </p>
    )
  if (history.error || workspace.error || !workspace.data)
    return (
      <div className="p-6">
        <p role="alert">
          Could not load the audit trail and workspace time zone.
        </p>
        <Button
          onClick={() => {
            void history.refetch()
            void workspace.refetch()
          }}
        >
          Retry
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
      timeZone={workspace.data.timezone}
    />
  )
}

export function ExperimentHistoryView({
  recordId,
  identifier,
  events,
  snapshotBefore,
  timeZone,
}: {
  recordId: string
  identifier: string
  events: AuditEventWire[]
  snapshotBefore: number
  timeZone: string
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
        <div
          className="flex flex-wrap gap-0.5"
          role="group"
          aria-label="History category"
        >
          {auditHistoryCategories.map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="quiet"
              aria-pressed={kind === category}
              className={cn(kind === category && 'bg-selection')}
              onClick={() => {
                setCategory(kind)
                setSelectedId(null)
              }}
            >
              <span className="capitalize">{kind}</span>{' '}
              <span className="num text-fg-muted">
                {
                  byActor.filter((event) =>
                    auditEventMatchesCategory(event, kind),
                  ).length
                }
              </span>
            </Button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1 text-label">
          Actor:
          <select
            aria-label="History actor"
            className="rounded border border-border bg-surface p-1 text-fg"
            value={actorId}
            onChange={(event) => {
              setActorId(event.target.value)
              setSelectedId(null)
            }}
          >
            <option value="">anyone ({events.length})</option>
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
          Export audit trail
        </a>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto lg:flex-row lg:overflow-hidden">
        <div className="min-w-0 shrink-0 overflow-auto lg:flex-1">
          <Table aria-label={`Audit trail for ${identifier}`}>
            <TableHeader>
              <TableRow>
                {[
                  'Time',
                  'Actor',
                  'Action',
                  'Object',
                  'Field',
                  'Change',
                  'Reason',
                ].map((label) => (
                  <TableHead key={label}>{label}</TableHead>
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
                            aria-label={`Inspect audit entry ${event.sequence}: ${described.action} ${described.subject}`}
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
                            : 'Not captured'}
                        </TableCell>
                        <TableCell className="max-w-80 whitespace-normal">
                          {captured(event, 'reason') === 'Not captured'
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
                    No {category === 'all' ? 'audit entries' : category} in this
                    selection.
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
          {visible.length} of {events.length} entries
        </span>
        <span>Times in {timeZone}</span>
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
      aria-label="Entry details"
      className="w-full min-w-0 shrink-0 space-y-[18px] overflow-y-auto border-t border-border p-4 text-body lg:w-[300px] lg:border-l lg:border-t-0"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Entry</h3>
        <Button
          size="sm"
          variant="quiet"
          onClick={onClose}
          aria-label="Close entry details"
        >
          Close
        </Button>
      </div>
      <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1.5 [overflow-wrap:anywhere]">
        <dt className="text-fg-muted">When</dt>
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
        <dt className="text-fg-muted">Actor</dt>
        <dd>{actor(event)}</dd>
        <dt className="text-fg-muted">Action</dt>
        <dd>{described.action}</dd>
        <dt className="text-fg-muted">Object</dt>
        <dd>
          {link ? (
            <a className="text-primary" href={link.href}>
              {described.subject}
            </a>
          ) : (
            described.subject
          )}
        </dd>
        {described.changes.map((change) => (
          <Fragment key={change.label}>
            <dt className="text-fg-muted">Field</dt>
            <dd>{change.label}</dd>
            <dt className="text-fg-muted">Old value</dt>
            <dd className="whitespace-pre-wrap">{change.from ?? '—'}</dd>
            <dt className="text-fg-muted">New value</dt>
            <dd className="whitespace-pre-wrap">{change.to ?? '—'}</dd>
          </Fragment>
        ))}
        {!described.changes.length && (
          <>
            <dt className="text-fg-muted">Values</dt>
            <dd>Not captured</dd>
          </>
        )}
        <dt className="text-fg-muted">Reason</dt>
        <dd>{captured(event, 'reason')}</dd>
        <dt className="text-fg-muted">Session</dt>
        <dd className="mono text-label">{captured(event, 'sessionId')}</dd>
        <dt className="text-fg-muted">Client</dt>
        <dd className="mono text-label">{event.clientId ?? 'Not captured'}</dd>
      </dl>
      <section aria-label="Knock-on changes">
        <h3 className="mb-2 font-medium">Knock-on changes</h3>
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
            No explicitly linked knock-on changes recorded.
          </p>
        )}
      </section>
      <p className="text-label text-fg-muted">
        Audit entries are written by the system and can't be edited or deleted.
      </p>
    </aside>
  )
}
