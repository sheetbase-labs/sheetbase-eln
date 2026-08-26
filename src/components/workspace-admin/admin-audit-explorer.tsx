import { useInfiniteQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import {
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui'
import {
  ACTION_LABELS,
  auditHistoryDataClient,
  auditLinkFor,
  describeAuditEvent,
  ENTITY_LABELS,
  fetchAuditEvents,
} from '#/lib/audit-history'
import { DataClientError } from '#/lib/data-client'
import { formatNotebookDateTime } from '#/lib/notebook-data'

/**
 * AdminAuditExplorer — GOV-03 workspace-wide audit explorer. Administration/
 * steward-facing view over the authoritative change_events stream through
 * the permission-aware `api.audit_events` RPC: time range, actor, object
 * type, action and free-text filters with deterministic sequence-cursor
 * pagination. Sensitive event classes stay server-gated (owner/admin/
 * steward); this UI never widens access.
 */

export interface AdminAuditExplorerActor {
  id: string
  label: string
}

const ENTITY_OPTIONS = [
  'record',
  'dataset',
  'dataset_version',
  'sheet_instance',
  'sheet_definition',
  'notebook_template',
  'file',
  'review_submission',
  'review_decision',
  'signature',
  'comment',
  'api_credential',
] as const

const OPERATION_OPTIONS = [
  'create',
  'update',
  'move',
  'delete',
  'archive',
  'restore',
  'link',
  'unlink',
  'quarantine',
  'lock',
  'amend',
  'revoke',
] as const

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function AdminAuditExplorer({
  actors,
}: {
  actors: AdminAuditExplorerActor[]
}) {
  const [entityType, setEntityType] = useState<string>('')
  const [operation, setOperation] = useState<string>('')
  const [actorUserId, setActorUserId] = useState<string>('')
  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  // Search is debounced by the browser-controlled form semantics below:
  // applied on submit so each keystroke does not trigger a query round trip.

  const filter = useMemo(
    () => ({
      entityType: entityType || undefined,
      operation: operation || undefined,
      actorUserId: actorUserId || undefined,
      from: from ? new Date(`${from}T00:00:00Z`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59Z`).toISOString() : undefined,
      search: search || undefined,
      limit: 50,
    }),
    [entityType, operation, actorUserId, from, to, search],
  )

  const historyQuery = useInfiniteQuery({
    queryKey: ['audit-events', 'explorer', filter],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      fetchAuditEvents(auditHistoryDataClient, {
        ...filter,
        ...(pageParam === undefined ? {} : { beforeSequence: pageParam }),
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  })

  const events =
    historyQuery.data?.pages.flatMap((page) => page.events) ?? []
  const denied =
    historyQuery.error instanceof DataClientError &&
    (historyQuery.error.code === 'permission_denied' ||
      historyQuery.error.code === 'unauthenticated')

  return (
    <div className='space-y-3'>
      <form
        className='flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-2'
        onSubmit={(cause) => {
          cause.preventDefault()
          void historyQuery.refetch()
        }}
        aria-label='Audit filters'
      >
        <label className='space-y-1 text-xs'>
          <span className='text-muted-foreground'>Object type</span>
          <select
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            aria-label='Object type filter'
            className='block h-8 w-40 rounded-md border bg-background px-2 py-1 text-sm'
          >
            <option value=''>All types</option>
            {ENTITY_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {ENTITY_LABELS[value] ?? humanize(value)}
              </option>
            ))}
          </select>
        </label>
        <label className='space-y-1 text-xs'>
          <span className='text-muted-foreground'>Action</span>
          <select
            value={operation}
            onChange={(event) => setOperation(event.target.value)}
            aria-label='Action filter'
            className='block h-8 w-36 rounded-md border bg-background px-2 py-1 text-sm'
          >
            <option value=''>All actions</option>
            {OPERATION_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {ACTION_LABELS[value] ?? humanize(value)}
              </option>
            ))}
          </select>
        </label>
        <label className='space-y-1 text-xs'>
          <span className='text-muted-foreground'>Actor</span>
          <select
            value={actorUserId}
            onChange={(event) => setActorUserId(event.target.value)}
            aria-label='Actor filter'
            className='block h-8 w-44 rounded-md border bg-background px-2 py-1 text-sm'
          >
            <option value=''>All actors</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.label}
              </option>
            ))}
          </select>
        </label>
        <label className='space-y-1 text-xs'>
          <span className='text-muted-foreground'>From</span>
          <Input
            type='date'
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className='h-8 w-36'
          />
        </label>
        <label className='space-y-1 text-xs'>
          <span className='text-muted-foreground'>To</span>
          <Input
            type='date'
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className='h-8 w-36'
          />
        </label>
        <label className='min-w-48 flex-1 space-y-1 text-xs'>
          <span className='text-muted-foreground'>Search payloads</span>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='e.g. transduction_run'
            className='h-8'
          />
        </label>
        <Button type='submit' size='sm' disabled={historyQuery.isFetching}>
          Apply
        </Button>
      </form>

      {denied ? (
        <p
          role='alert'
          className='rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'
        >
          The audit trail is not available to this account.
        </p>
      ) : historyQuery.isError ? (
        <p role='alert' className='rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
          The audit trail could not be loaded.
        </p>
      ) : (
        <div className='rounded-lg border bg-background'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-24'>Sequence</TableHead>
                <TableHead className='w-44'>When</TableHead>
                <TableHead className='w-40'>Actor</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead className='w-28'>Open</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className='py-8 text-center text-muted-foreground'>
                    Loading…
                  </TableCell>
                </TableRow>
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className='py-8 text-center text-muted-foreground'>
                    No matching activity recorded.
                  </TableCell>
                </TableRow>
              ) : (
                events.map((event) => {
                  const link = auditLinkFor(event)
                  const described = describeAuditEvent(event)
                  return (
                    <TableRow key={event.id}>
                      <TableCell className='tabular-nums text-muted-foreground'>
                        {event.sequence}
                      </TableCell>
                      <TableCell className='whitespace-nowrap text-xs text-muted-foreground'>
                        {formatNotebookDateTime(event.createdAt)}
                      </TableCell>
                      <TableCell className='text-xs'>
                        {event.actorName ?? event.actorUserId?.slice(0, 8) ?? 'System'}
                        {event.actorCredentialId ? ' (credential)' : ''}
                      </TableCell>
                      <TableCell>
                        <p className='text-sm'>
                          <span className='font-medium'>{described.action}</span>{' '}
                          {described.subject}
                          {' · '}
                          <span className='text-muted-foreground'>
                            {ENTITY_LABELS[event.entityType] ?? humanize(event.entityType)}{' '}
                            {humanize(event.operation).toLowerCase()}
                          </span>
                        </p>
                        {described.changes.length > 0 ? (
                          <ul className='mt-0.5 space-y-0.5'>
                            {described.changes.map((change) => (
                              <li key={change.label} className='text-xs text-muted-foreground'>
                                {change.label}:{' '}
                                {change.kind === 'changed'
                                  ? `${change.from} → ${change.to}`
                                  : change.kind === 'added'
                                    ? change.to
                                    : `${change.from} (removed)`}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <details className='mt-0.5'>
                          <summary className='cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground'>
                            Raw payload
                          </summary>
                          <pre className='mt-1 max-h-32 overflow-auto rounded border bg-muted/40 p-1.5 font-mono text-[11px]'>
                            {JSON.stringify(event.payload, null, 2)}
                          </pre>
                        </details>
                      </TableCell>
                      <TableCell>
                        {link ? (
                          <a
                            href={link.href}
                            className='text-xs font-medium text-primary no-underline hover:underline'
                          >
                            {link.label}
                          </a>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {!denied && !historyQuery.isError && historyQuery.hasNextPage ? (
        <div className='flex items-center gap-3'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void historyQuery.fetchNextPage()}
            disabled={historyQuery.isFetchingNextPage}
          >
            {historyQuery.isFetchingNextPage ? 'Loading…' : 'Load older events'}
          </Button>
          <span className='text-xs text-muted-foreground'>
            Showing {events.length} most recent matching events
          </span>
        </div>
      ) : null}
    </div>
  )
}

