import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Notice } from '#/components/v3/ui/alert'
import { toast } from '#/components/v3/ui/sonner'
import { Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { Muted } from '#/components/v3/ui/layout'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
import { SettingsHeader } from '#/components/v3/settings/settings-page'
import {
  ACTION_LABELS,
  auditHistoryQueryKeys,
  fetchAllAuditEvents,
  fetchAuditEvents,
} from '#/lib/audit-history'
import type { AuditEventWire } from '#/lib/audit-history'
import { createDataClient } from '#/lib/data-client'
import { downloadTextFile } from '#/lib/download'

/** UI port (roadmap-4/ui-app3): the audit log reads the append-only change
 * events for the workspace through the permission-aware `api.audit_events`
 * read model. Entries cannot be edited or deleted. The grid pages the
 * descending sequence cursor so scrolling reaches the whole history, and the
 * search filters on the server — the loaded window is never the filter's
 * universe. The export walks the same selection to its end, and says so. */
export const Route = createFileRoute('/settings/audit')({
  component: Audit,
})

const dataClient = createDataClient()

/** Entries read per cursor page. The RPC clamps any larger request. */
const PAGE_SIZE = 50

/** How still the search box is before it becomes a server read, so one read
 * covers a burst of keystrokes. */
const SEARCH_SETTLE_MS = 250

/** How close to the bottom the grid must be before it asks for the next page. */
const LOAD_MORE_THRESHOLD_PX = 240

/** Hold a typed search term still for a moment. Seeded with the initial term
 * so the first read is immediate rather than waiting out the first delay. */
function useSettledSearch(term: string): string {
  const [settled, setSettled] = useState(term)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(term), SEARCH_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [term])
  return settled
}

function Audit() {
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const [q, setQ] = useState('')
  const [operation, setOperation] = useState<string>('')
  const [exporting, setExporting] = useState(false)
  const search = useSettledSearch(q)

  const filter = useMemo(
    () => ({
      operation: operation || undefined,
      search: search.trim() || undefined,
    }),
    [operation, search],
  )

  const activity = useInfiniteQuery({
    queryKey: auditHistoryQueryKeys.events(filter),
    enabled: Boolean(workspaceId),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      fetchAuditEvents(dataClient, {
        ...filter,
        limit: PAGE_SIZE,
        ...(pageParam === undefined ? {} : { beforeSequence: pageParam }),
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  })

  const rows = useMemo(
    () => activity.data?.pages.flatMap((page) => page.events) ?? [],
    [activity.data],
  )

  // The filter lists the operation vocabulary the log can hold — the same set
  // the database's change_events CHECK constrains and the history renders via
  // ACTION_LABELS — unioned with anything an event carries that the catalogue
  // does not name yet. Building it from the loaded page alone would leave an
  // operation that has not happened recently unfilterable.
  const operations = useMemo(
    () =>
      [
        ...new Set([
          ...Object.keys(ACTION_LABELS),
          ...rows.map((r) => r.operation),
        ]),
      ].sort(),
    [rows],
  )

  const loadOlder = () => {
    // A failed next page keeps the retry with the message below instead of
    // retrying on every scroll tick.
    if (!activity.hasNextPage || activity.isFetchingNextPage) return
    if (activity.isFetchNextPageError) return
    void activity.fetchNextPage()
  }

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (
      el.scrollHeight - el.scrollTop - el.clientHeight >
      LOAD_MORE_THRESHOLD_PX
    )
      return
    loadOlder()
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const events = await fetchAllAuditEvents(dataClient, filter)
      downloadTextFile('audit-log.csv', buildAuditCsv(events), 'text/csv')
      toast('audit-log.csv exported', {
        description: `${events.length} ${
          events.length === 1 ? 'entry' : 'entries'
        } — every entry matching the current search.`,
      })
    } catch (error) {
      // A hand-off the browser refuses, or a read that failed mid-walk, is
      // otherwise silent.
      toast('Could not export the audit log', {
        description:
          error instanceof Error
            ? error.message
            : 'The browser blocked the download.',
      })
    } finally {
      setExporting(false)
    }
  }

  const countLabel = activity.isLoading
    ? 'Loading…'
    : rows.length === 0
      ? 'No entries'
      : activity.hasNextPage
        ? `${rows.length} entries loaded — older entries available`
        : `${rows.length} entries`

  const bodyRows: React.ReactNode[] = rows.map((r) => (
    <TableRow key={r.id}>
      <TableCell className="text-fg-muted">
        {r.createdAt.slice(0, 19).replace('T', ' ')}
      </TableCell>
      <TableCell>{actorLabel(r)}</TableCell>
      <TableCell>{r.operation}</TableCell>
      <TableCell>{r.entityType}</TableCell>
      <TableCell className="max-w-[240px] whitespace-normal text-fg-muted">
        {describeChange(r.payload)}
      </TableCell>
      <TableCell className="max-w-[160px] whitespace-normal text-fg-muted">
        {reasonOf(r.payload)}
      </TableCell>
      <TableCell className="mono text-[11px]">{r.recordId ?? '—'}</TableCell>
      <TableCell className="mono text-[11px] text-fg-muted">
        {r.projectId ? r.projectId.slice(0, 8) : '—'}
      </TableCell>
    </TableRow>
  ))

  // The end of the body states the tail of the read: a page arriving, a page
  // that failed, or that the history is exhausted. It sits inside the body so
  // the scroll trigger and the keyboard path share one control.
  if (rows.length > 0 && activity.hasNextPage) {
    bodyRows.push(
      <TableRow key="__more">
        <TableCell colSpan={8} className="text-fg-muted">
          {activity.isFetchNextPageError ? (
            <span className="flex items-center gap-2">
              Older entries could not be loaded.
              <Button size="sm" onClick={() => void activity.fetchNextPage()}>
                Retry
              </Button>
            </span>
          ) : activity.isFetchingNextPage ? (
            'Loading older entries…'
          ) : (
            'Scroll for older entries'
          )}
        </TableCell>
      </TableRow>,
    )
  }
  if (rows.length > 0 && !activity.hasNextPage) {
    bodyRows.push(
      <TableRow key="__end">
        <TableCell colSpan={8} className="text-fg-muted">
          End of the log — every matching entry is loaded.
        </TableCell>
      </TableRow>,
    )
  }

  return (
    <>
      <SettingsHeader
        title={
          <>
            Audit log{' '}
            <span className="ml-1 font-sans text-label font-normal text-fg-muted">
              {context.workspace?.name ?? 'Workspace'} · all projects
            </span>
          </>
        }
        border={false}
        actions={
          <>
            <Button onClick={() => void activity.refetch()}>Refresh</Button>
            <Button
              variant="primary"
              disabled={exporting || rows.length === 0}
              onClick={() => void exportCsv()}
            >
              {exporting ? 'Exporting…' : 'Export CSV of all matches'}
            </Button>
          </>
        }
      >
        Entries can’t be edited or deleted; each carries the actor, the object
        and the change.
      </SettingsHeader>
      <div
        role="toolbar"
        className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 md:px-6"
      >
        <Select
          aria-label="Operation"
          size="sm"
          value={operation}
          onChange={(e) => setOperation(e.target.value)}
        >
          <option value="">All operations</option>
          {operations.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
        <label className="block w-[240px]">
          <span className="sr-only">Search audit log</span>
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search operation, entity or value"
            className="h-[26px] text-label"
          />
        </label>
        <span className="flex-1" />
        <span className="num whitespace-nowrap text-label text-fg-muted">
          {countLabel}
        </span>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto"
        onScroll={onScroll}
        data-testid="audit-scroll"
      >
        <Table aria-label="Audit log" className="max-xl:min-w-[1000px]">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Record</TableHead>
              <TableHead>Project</TableHead>
            </TableRow>
          </TableHeader>
          {/* The body states its own loading and empty case, so the table never
              renders as a header-only shell while the log is being read. A
              failed read keeps the notice below instead of claiming no match. */}
          <TableBody
            loading={activity.isLoading}
            colSpan={8}
            empty={
              activity.isError
                ? undefined
                : 'No audit entries match — clear the search and the operation filter to see the whole log.'
            }
          >
            {bodyRows}
          </TableBody>
        </Table>
        {activity.isError && rows.length === 0 ? (
          <div className="px-4 py-4 md:px-6">
            <Notice
              tone="bad"
              title="The audit log could not be read."
              action={
                <Button size="sm" onClick={() => void activity.refetch()}>
                  Retry
                </Button>
              }
            >
              Nothing is missing from the log; this read failed. Refresh to see
              the entries again.
            </Notice>
          </div>
        ) : null}
      </div>
      <div className="border-t border-border-subtle px-4 py-3 md:px-6">
        <Muted>
          Newest first. Scrolling loads older entries until the log is
          exhausted; the export covers every entry matching the current search.
        </Muted>
      </div>
    </>
  )
}

/** The actor as the read model names them, with the same fallbacks the history
 * timeline uses: a credential-authored event, then the raw id, then system. */
function actorLabel(event: AuditEventWire): string {
  if (event.actorCredentialId) return 'API credential'
  if (event.actorName) return event.actorName
  if (event.actorUserId) return event.actorUserId.slice(0, 8)
  return 'system'
}

/** The whole selection as CSV, in the columns the grid shows. */
function buildAuditCsv(events: AuditEventWire[]): string {
  const header = [
    'when',
    'sequence',
    'actor',
    'operation',
    'entity',
    'record',
    'project',
  ]
  const lines = events.map((r) =>
    [
      r.createdAt,
      String(r.sequence),
      actorLabel(r),
      r.operation,
      r.entityType,
      r.recordId ?? '',
      r.projectId ?? '',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  )
  return [header.join(','), ...lines].join('\n')
}

/** The first field-level change in an event payload, with its count. */
function describeChange(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || !('changes' in payload))
    return '—'
  const changes = payload.changes
  if (!changes || typeof changes !== 'object') return '—'
  const entries = Object.entries(changes)
  if (entries.length === 0) return '—'
  const [field, raw] = entries[0]
  const pair = raw && typeof raw === 'object' ? raw : {}
  const from = 'from' in pair && pair.from != null ? String(pair.from) : '∅'
  const to = 'to' in pair && pair.to != null ? String(pair.to) : '∅'
  const extra = entries.length > 1 ? ` (+${entries.length - 1})` : ''
  return `${field}: ${from} → ${to}${extra}`
}

/** The reason recorded on an event, when the operation needs one. */
function reasonOf(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'reason' in payload) {
    const reason = payload.reason
    if (typeof reason === 'string' && reason.trim()) return reason
  }
  return '—'
}
