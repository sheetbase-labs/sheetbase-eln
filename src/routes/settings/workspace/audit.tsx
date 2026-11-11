import { Person } from '#/components/ui/person'
import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import { Button } from '#/components/ui/button'
import { LoadMore } from '#/components/ui/load-more'
import { Notice } from '#/components/ui/alert'
import { toast } from '#/components/ui/sonner'
import { Input } from '#/components/ui/input'
import { DateField } from '#/components/ui/date-field'
import { Select } from '#/components/ui/select'
import { Muted } from '#/components/ui/layout'
import { RegistryGrid } from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import { SettingsHeader } from '#/components/settings/settings-page'
import {
  AuditIntegrityLine,
  CheckNowButton,
  RetentionDialog,
} from '#/components/settings/audit-retention'
import { TimestampsDialog } from '#/components/settings/audit-timestamps'
import { adminQueryKeys, fetchWorkspaceMembers } from '#/lib/workspace-admin'
import { canManageSettings } from '#/lib/settings-access'
import { useRegulatedLab } from '#/lib/regulated-lab'
import { useUserNames } from '#/lib/user-names'
import {
  ACTION_LABELS,
  auditHistoryQueryKeys,
  fetchAllAuditEvents,
  entityLabel,
  fetchAuditEvents,
  formatChangeValue,
  operationLabel,
} from '#/lib/audit-history'
import type { AuditEventWire } from '#/lib/audit-history'
import { createDataClient } from '#/lib/data-client'
import { formatDate } from '#/lib/format-date'
import { downloadTextFile } from '#/lib/download'
import { parseSearchDay } from '#/lib/search'
import { auditFilterFromSearch } from '#/lib/audit-filter'
import type { AuditSearch } from '#/lib/audit-filter'
import { useSettledValue } from '#/lib/settled-value'
import { t } from '#/copy'

/** UI port (roadmap-4/ui-app3): the audit log reads the append-only change
 * events for the workspace through the permission-aware `api.audit_events`
 * read model. Entries cannot be edited or deleted. The grid pages the
 * descending sequence cursor so scrolling reaches the whole history, and the
 * search filters on the server — the loaded window is never the filter's
 * universe. The export walks the same selection to its end, and says so. */
export const Route = createFileRoute('/settings/workspace/audit')({
  validateSearch: (search): AuditSearch => ({
    record: z.string().min(1).optional().catch(undefined).parse(search.record),
    from: parseSearchDay(search.from),
    to: parseSearchDay(search.to),
  }),
  component: Audit,
})

const dataClient = createDataClient()

/** Entries read per cursor page. The RPC clamps any larger request. */
const PAGE_SIZE = 50

/** How still the search box is before it becomes a server read, so one read
 * covers a burst of keystrokes. A server read waits longer than the 200 ms a
 * route navigation takes. */
const SEARCH_SETTLE_MS = 250

/** How close to the bottom the grid must be before it asks for the next page. */
const LOAD_MORE_THRESHOLD_PX = 240

function Audit() {
  const { context } = Route.useRouteContext()
  const urlSearch = Route.useSearch()
  const workspaceId = context.workspace?.id ?? ''

  const [filters, setFilters] = useState({
    operation: '',
    actorUserId: '',
    projectId: '',
  })

  const [retentionOpen, setRetentionOpen] = useState(false)
  const [timestampsOpen, setTimestampsOpen] = useState(false)
  const canManage = canManageSettings(context.workspace, 'audit')
  const { regulated } = useRegulatedLab(workspaceId)
  const [exporting, setExporting] = useState(false)

  // The box holds the typed term and the grid reads the settled one.
  const {
    value: q,
    setValue: setQ,
    settled: search,
  } = useSettledValue('', SEARCH_SETTLE_MS)

  const filter = useMemo(
    () => ({
      operation: filters.operation || undefined,
      actorUserId: filters.actorUserId || undefined,
      projectId: filters.projectId || undefined,
      search: search.trim() || undefined,
      ...auditFilterFromSearch(urlSearch),
    }),
    [filters, search, urlSearch],
  )

  const activity = useInfiniteQuery({
    queryKey: auditHistoryQueryKeys.events(filter),
    enabled: Boolean(workspaceId),
    // SAFETY: The first page has no cursor; getNextPageParam supplies only numeric sequence cursors.
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      fetchAuditEvents(dataClient, {
        ...filter,
        limit: PAGE_SIZE,
        beforeSequence: pageParam,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
  })

  const rows = useMemo(
    () => activity.data?.pages.flatMap((page) => page.events) ?? [],
    [activity.data],
  )

  const { recordLabel, projectLabel } = useAuditNames(rows, urlSearch.record)

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

  // The grid scrolls inside this pane, and scroll events do not bubble, so the
  // pane listens in the capture phase and reads the element that scrolled.
  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.target instanceof HTMLElement ? event.target : null

    if (!el) return

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
      toast(t('settings.audit.auditLogCsvToast'), {
        description: t('settings.audit.exportedEntries', {
          count: events.length,
        }),
      })
    } catch (error) {
      // A hand-off the browser refuses, or a read that failed mid-walk, is
      // otherwise silent.
      toast(t('settings.audit.couldExportAuditToast'), {
        description:
          error instanceof Error
            ? error.message
            : t('settings.audit.browserBlockedDownload'),
      })
    } finally {
      setExporting(false)
    }
  }

  const countLabel = auditCountLabel(
    activity.isLoading,
    rows.length,
    activity.hasNextPage,
  )

  const columns = auditColumns({
    search: urlSearch,
    recordLabel,
    projectLabel,
  })

  return (
    <>
      <SettingsHeader
        title={t('settings.audit.auditLog')}
        border={false}
        actions={
          <>
            <Button onClick={() => setRetentionOpen(true)}>
              {t('settings.audit.retentionPolicy')}
            </Button>
            <Button onClick={() => setTimestampsOpen(true)}>
              {t('settings.timestamps.button')}
            </Button>
            {regulated ? (
              <Button render={<Link to="/settings/workspace/validation" />}>
                {t('settings.validation.button')}
              </Button>
            ) : null}
            {canManage ? <CheckNowButton workspaceId={workspaceId} /> : null}
            <Button onClick={() => void activity.refetch()}>
              {t('common.actions.refresh')}
            </Button>
            <Button
              variant="primary"
              disabled={exporting || rows.length === 0}
              onClick={() => void exportCsv()}
            >
              {exporting
                ? t('settings.audit.exporting')
                : t('settings.audit.exportCsvMatches')}
            </Button>
          </>
        }
      >
        {context.workspace?.name ?? 'Workspace'}
        {t('settings.audit.projects2')}
        <AuditIntegrityLine workspaceId={workspaceId} />
      </SettingsHeader>
      <AuditFilters
        filters={filters}
        onChange={setFilters}
        operations={operations}
        term={q}
        onTermChange={setQ}
        recordLabel={recordLabel}
        countLabel={countLabel}
      />
      <div
        className="flex min-h-0 flex-1 flex-col max-md:pb-20"
        onScrollCapture={onScroll}
        data-testid="audit-scroll"
      >
        {/* The grid states its own loading case, so it never renders as a
            header-only shell while the log is being read. A failed read keeps
            the notice below instead of claiming no match. */}
        {rows.length === 0 && !activity.isLoading && !activity.isError ? (
          <div className="px-4 py-4 md:px-6">
            <Muted>{t('settings.audit.auditEntriesMatch')}</Muted>
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <RegistryGrid
              label={t('settings.audit.auditLog')}
              rows={rows}
              columns={columns}
              getRowId={(event) => event.id}
              selectable={false}
              isLoading={activity.isLoading}
            />
          </div>
        )}
        {rows.length > 0 ? (
          <div className="border-t border-border-subtle px-4 py-2 text-fg-muted md:px-6">
            <LoadMore
              label={t('settings.audit.olderAuditEntries')}
              hasMore={activity.hasNextPage}
              loading={activity.isFetchingNextPage}
              error={
                activity.isFetchNextPageError
                  ? t('settings.audit.olderEntriesCould')
                  : undefined
              }
              onLoadMore={() => void activity.fetchNextPage()}
              endLabel={t('settings.audit.endLogEvery')}
            />
          </div>
        ) : null}
        {activity.isError && rows.length === 0 ? (
          <div className="px-4 py-4 md:px-6">
            <Notice
              tone="bad"
              title={t('settings.audit.auditLogCould')}
              action={
                <Button size="sm" onClick={() => void activity.refetch()}>
                  {t('common.actions.tryAgain')}
                </Button>
              }
            >
              {t('settings.audit.logCouldLoaded')}
            </Notice>
          </div>
        ) : null}
      </div>
      {timestampsOpen ? (
        <TimestampsDialog
          workspaceId={workspaceId}
          canManage={canManage}
          onClose={() => setTimestampsOpen(false)}
        />
      ) : null}
      {retentionOpen ? (
        <RetentionDialog
          workspaceId={workspaceId}
          canManage={canManage}
          onClose={() => setRetentionOpen(false)}
        />
      ) : null}
      <div className="border-t border-border-subtle px-4 py-3 md:px-6">
        <Muted>{t('settings.audit.newestFirstScrolling')}</Muted>
      </div>
    </>
  )
}

function auditCountLabel(loading: boolean, count: number, hasMore: boolean) {
  if (loading) return 'Loading…'

  if (count === 0) return 'No entries'

  return hasMore
    ? `${count} entries loaded — older entries available`
    : `${count} entries`
}

function AuditFilters({
  filters,
  onChange,
  operations,
  term,
  onTermChange,
  recordLabel,
  countLabel,
}: {
  filters: { operation: string; actorUserId: string; projectId: string }
  onChange: (filters: {
    operation: string
    actorUserId: string
    projectId: string
  }) => void
  operations: string[]
  term: string
  onTermChange: (term: string) => void
  recordLabel: (id: string) => string
  countLabel: string
}) {
  const { context } = Route.useRouteContext()
  const urlSearch = Route.useSearch()
  const navigate = Route.useNavigate()
  const workspaceId = context.workspace?.id ?? ''

  const setUrl = (patch: Partial<AuditSearch>) =>
    void navigate({
      to: '/settings/workspace/audit',
      search: (s) => ({ ...s, ...patch }),
    })

  // Filter choices cover the workspace, not only the loaded event window.
  const members = useQuery({
    queryKey: adminQueryKeys.members(workspaceId),
    queryFn: () => fetchWorkspaceMembers(dataClient, workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })

  const memberIds = useMemo(
    () => (members.data ?? []).map((m) => m.userId),
    [members.data],
  )

  const memberNames = useUserNames(memberIds, context.user)

  const projectList = useQuery({
    queryKey: ['audit-project-filter', workspaceId],
    queryFn: () =>
      dataClient.list<{ id: string; title: string }>(
        'projects',
        '?select=id,title&order=title.asc',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })

  return (
    <div
      role="toolbar"
      className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 md:px-6"
    >
      <Select
        aria-label={t('settings.audit.operationAria')}
        size="sm"
        value={filters.operation}
        onChange={(e) => onChange({ ...filters, operation: e.target.value })}
      >
        <option value="">{t('settings.audit.operations')}</option>
        {operations.map((o) => (
          <option key={o} value={o}>
            {operationLabel(o)}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('settings.audit.actor')}
        size="sm"
        value={filters.actorUserId}
        onChange={(e) => onChange({ ...filters, actorUserId: e.target.value })}
      >
        <option value="">{t('settings.audit.anyone')}</option>
        {(members.data ?? []).map((m) => (
          <option key={m.userId} value={m.userId}>
            {memberNames.userLabel(m.userId)}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('settings.audit.project')}
        size="sm"
        value={filters.projectId}
        onChange={(e) => onChange({ ...filters, projectId: e.target.value })}
      >
        <option value="">{t('settings.audit.projects3')}</option>
        {(projectList.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </Select>
      <label className="block w-[240px]">
        <span className="sr-only">{t('settings.audit.searchAuditLog')}</span>
        <Input
          type="search"
          value={term}
          onChange={(e) => onTermChange(e.target.value)}
          placeholder={t('settings.audit.searchOperationEntityPlaceholder')}
          className="h-[26px] text-label"
        />
      </label>
      <span className="flex items-center gap-1.5 text-label text-fg-muted">
        {t('settings.audit.from')}
        <DateField
          label={t('settings.audit.from')}
          value={urlSearch.from}
          max={urlSearch.to}
          onChange={(day) => setUrl({ from: parseSearchDay(day) })}
        />
      </span>
      <span className="flex items-center gap-1.5 text-label text-fg-muted">
        {t('settings.audit.to')}
        <DateField
          label={t('settings.audit.to')}
          value={urlSearch.to}
          min={urlSearch.from}
          onChange={(day) => setUrl({ to: parseSearchDay(day) })}
        />
      </span>
      {urlSearch.record ? (
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-label">
          {t('settings.audit.record')}
          <span className="mono">{recordLabel(urlSearch.record)}</span>
          <Button
            size="sm"
            variant="quiet"
            aria-label={t('settings.audit.clearRecordFilterAria')}
            onClick={() => setUrl({ record: undefined })}
          >
            {t('common.actions.clear')}
          </Button>
        </span>
      ) : null}
      <span className="flex-1" />
      <span className="num whitespace-nowrap text-label text-fg-muted">
        {countLabel}
      </span>
    </div>
  )
}

// Resolve only the loaded window and selected record. Chunking preserves the
// proxy's bounded query length without fetching the whole record catalogue.
function useAuditNames(rows: AuditEventWire[], record: string | undefined) {
  const recordIds = useMemo(
    () => [
      ...new Set(
        [record, ...rows.map((r) => r.recordId)].filter((id): id is string =>
          Boolean(id),
        ),
      ),
    ],
    [rows, record],
  )

  const projectIds = useMemo(
    () => [...new Set(rows.flatMap((r) => (r.projectId ? [r.projectId] : [])))],
    [rows],
  )

  const names = useQuery({
    queryKey: ['audit-names', recordIds, projectIds],
    enabled: recordIds.length > 0 || projectIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const listByIds = async <T,>(
        resource: string,
        ids: string[],
        select: string,
      ): Promise<T[]> => {
        const chunks: string[][] = []

        for (let i = 0; i < ids.length; i += 12)
          chunks.push(ids.slice(i, i + 12))

        return (
          await Promise.all(
            chunks.map((chunk) =>
              dataClient.list<T>(
                resource,
                `?id=in.(${chunk.join(',')})&select=${select}`,
              ),
            ),
          )
        ).flat()
      }

      const [records, projects] = await Promise.all([
        listByIds<{ id: string; identifier: string }>(
          'records',
          recordIds,
          'id,identifier',
        ),
        listByIds<{ id: string; title: string }>(
          'projects',
          projectIds,
          'id,title',
        ),
      ])

      return {
        records: new Map(records.map((r) => [r.id, r.identifier])),
        projects: new Map(projects.map((p) => [p.id, p.title])),
      }
    },
  })

  return {
    recordLabel: (id: string) => names.data?.records.get(id) ?? id.slice(0, 8),
    projectLabel: (id: string) =>
      names.data?.projects.get(id) ?? id.slice(0, 8),
  }
}

/** The log's columns: when, who, what, and where it happened. */
function auditColumns({
  search,
  recordLabel,
  projectLabel,
}: {
  search: AuditSearch
  recordLabel: (id: string) => string
  projectLabel: (id: string) => string
}): RegistryColumn<AuditEventWire>[] {
  return [
    {
      id: 'when',
      header: t('settings.audit.when'),
      accessorFn: (r) => r.createdAt,
      cell: ({ row }) => (
        <span className="text-fg-muted" title={row.original.createdAt}>
          {formatDate(row.original.createdAt, { time: true })}
        </span>
      ),
    },
    {
      id: 'actor',
      header: t('settings.audit.actor'),
      accessorFn: (r) => actorLabel(r),
      cell: ({ row }) => {
        const r = row.original

        return r.actorUserId && !r.actorCredentialId ? (
          <Person userId={r.actorUserId} name={actorLabel(r)} />
        ) : (
          actorLabel(r)
        )
      },
    },
    {
      id: 'operation',
      header: t('settings.audit.operationAria'),
      accessorFn: (r) => operationLabel(r.operation),
    },
    {
      id: 'entity',
      header: t('settings.audit.entity'),
      accessorFn: (r) => entityLabel(r.entityType),
    },
    {
      id: 'change',
      header: t('settings.audit.change'),
      enableSorting: false,
      cell: ({ row }) => {
        const text = describeChange(row.original.payload)

        return (
          <span
            className="block max-w-[24rem] truncate text-fg-muted"
            title={text}
          >
            {text}
          </span>
        )
      },
    },
    {
      id: 'reason',
      header: t('settings.audit.reason'),
      enableSorting: false,
      cell: ({ row }) => {
        const text = reasonOf(row.original.payload)

        return (
          <span
            className="block max-w-[16rem] truncate text-fg-muted"
            title={text}
          >
            {text}
          </span>
        )
      },
    },
    {
      id: 'record',
      header: t('settings.audit.record'),
      accessorFn: (r) => (r.recordId ? recordLabel(r.recordId) : undefined),
      cell: ({ row }) => {
        const r = row.original

        return r.recordId ? (
          <Link
            to="/settings/workspace/audit"
            search={{ ...search, record: r.recordId }}
            title={t('settings.audit.showOnlyRecord')}
            className="mono text-[11px]"
          >
            {recordLabel(r.recordId)}
          </Link>
        ) : (
          '—'
        )
      },
    },
    {
      id: 'project',
      header: t('settings.audit.project'),
      accessorFn: (r) => (r.projectId ? projectLabel(r.projectId) : undefined),
      cell: ({ row }) => {
        const r = row.original

        return r.projectId ? (
          <Link
            to="/projects/$projectId"
            params={{ projectId: r.projectId }}
            title={t('settings.audit.openProject')}
          >
            {projectLabel(r.projectId)}
          </Link>
        ) : (
          <span className="text-fg-muted">—</span>
        )
      },
    },
  ]
}

/** The actor as the read model names them, with the same fallbacks the history
 * timeline uses: a credential-authored event, then the raw id, then system. */
function actorLabel(event: AuditEventWire): string {
  if (event.actorCredentialId) return t('settings.audit.apiCredential')

  if (event.actorName) return event.actorName

  if (event.actorUserId) return event.actorUserId.slice(0, 8)

  return 'System'
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
function describeChange(payload: AuditEventWire['payload']): string {
  const parsed = z
    .object({ changes: z.record(z.string(), z.unknown()) })
    .safeParse(payload)

  if (!parsed.success) return '—'

  const changes = parsed.data.changes
  const entries = Object.entries(changes)

  if (entries.length === 0) return '—'
  const [field, raw] = entries[0]

  const pair = z
    .object({ from: z.unknown().optional(), to: z.unknown().optional() })
    .safeParse(raw)

  const from =
    pair.success && pair.data.from != null
      ? formatChangeValue(pair.data.from)
      : '∅'

  const to =
    pair.success && pair.data.to != null ? formatChangeValue(pair.data.to) : '∅'

  const extra = entries.length > 1 ? ` (+${entries.length - 1})` : ''

  return `${field}: ${from} → ${to}${extra}`
}

/** The reason recorded on an event, when the operation needs one. */
function reasonOf(payload: AuditEventWire['payload']): string {
  const parsed = z.object({ reason: z.string() }).safeParse(payload)

  if (parsed.success && parsed.data.reason.trim()) return parsed.data.reason

  return '—'
}
