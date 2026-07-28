/**
 * REV-006 — Review Inbox route.
 *
 * Lists submitted reviews (`review_submissions`, REV-002) in a TanStack Table
 * driven by the reusable `RegistryComposition`, with filters, saved views and
 * a selected-review inspector. Selection, filters, sort and page are
 * deep-linked through URL search params so a view can be shared/bookmarked
 * and browser back/forward works.
 *
 * Data: submissions are fetched (server-ordered, bounded) and joined to their
 * linked record/project client-side; type/search/assignee filtering and
 * pagination run on the bounded set (see src/lib/reviews.ts). The current
 * step, inbox status, priority and overdue flag are display derivations — no
 * stored columns exist for them yet. Bulk actions are intentionally absent:
 * none are supported until review transitions ship (REV-003+), so the inbox
 * never offers an action it cannot honour.
 */
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import { z } from 'zod'
import { useMemo } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  Eye,
  ExternalLink,
  GitCompare,
  Undo2,
  UserCog,
  XCircle,
} from 'lucide-react'

import { useShell } from '#/components/app-shell'
import { RegistryComposition } from '#/components/registry/registry-composition'
import type { RegistrySummary } from '#/components/registry/registry-composition'
import { StatusBadge } from '#/components/scientific/status-badge'
import type { StatusVocabulary } from '#/components/scientific/status-badge'
import { Badge, Button } from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import {
  formatDate,
  formatRelativeTime,
  recordKindLabel,
} from '#/lib/notebook-data'
import {
  DEFAULT_REVIEW_FILTERS,
  fetchProjectsForReviews,
  fetchRecordsForReviews,
  fetchReviewSubmissions,
  filterReviews,
  MEDIUM_DAYS,
  OVERDUE_DAYS,
  paginateReviews,
  reviewQueryKeys,
  reviewsDataClient,
  sortReviews,
  toReviewItem,
  workflowStepsFor,
} from '#/lib/reviews'
import type {
  ReviewFilterInput,
  ReviewItem,
  ReviewPriority,
  ReviewSubmissionWire,
} from '#/lib/reviews'
import type { RegistryQuery, RegistryFilterValue } from '#/lib/registry'
import { cn } from '#/lib/utils'

// ---------------------------------------------------------------------------
// Deep-linkable search state. The URL is the single source of truth for
// selection, filters, sort and page; `pageSize` is a personal preference and
// is deep-linked too so a shared link reproduces the density the sender saw.
// ---------------------------------------------------------------------------

const reviewsSearchSchema = z.object({
  selected: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  assignee: z.string().optional(),
  overdue: z.string().optional(),
  q: z.string().optional(),
  sort: z.string().optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(0).optional(),
  size: z.number().int().min(1).max(100).optional(),
})

type ReviewsSearch = z.infer<typeof reviewsSearchSchema>

export const Route = createFileRoute('/reviews')({
  validateSearch: reviewsSearchSchema,
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ReviewsRoute,
})

// ---------------------------------------------------------------------------
// Inbox status vocabulary (custom — forwarded to StatusBadge). The shared
// `review` domain vocabulary covers transition states; the inbox maps the
// raw `submitted` state to "Under review" and stays forward-compatible with
// withdrawn / approved / rejected / returned.
// ---------------------------------------------------------------------------

const inboxStatusVocabulary: StatusVocabulary = {
  submitted: { label: 'Under review', tone: 'info', icon: Eye },
  withdrawn: { label: 'Withdrawn', tone: 'neutral', icon: Undo2 },
  approved: { label: 'Approved', tone: 'success', icon: CheckCircle2 },
  rejected: { label: 'Rejected', tone: 'danger', icon: XCircle },
  returned: { label: 'Returned', tone: 'warning', icon: Undo2 },
}

const PRIORITY_META: Record<ReviewPriority, string> = {
  high: 'text-red-600 dark:text-red-400',
  medium: 'text-amber-600 dark:text-amber-400',
  low: 'text-emerald-600 dark:text-emerald-400',
}

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>

const TYPE_BADGE_VARIANT: Record<string, BadgeVariant> = {
  experiment: 'info',
  protocol_template: 'violet',
  report: 'info',
  dataset: 'success',
  sample: 'success',
  reagent: 'warning',
  file: 'outline',
  notebook_template: 'violet',
}

const PAGE_SIZE_FALLBACK = 25

// ---------------------------------------------------------------------------
// URL <-> RegistryQuery bridging.
// ---------------------------------------------------------------------------

function queryFromSearch(search: ReviewsSearch): RegistryQuery {
  const filters: RegistryFilterValue[] = []
  if (search.status) filters.push({ id: 'status', value: search.status })
  if (search.type) filters.push({ id: 'type', value: search.type })
  if (search.assignee) filters.push({ id: 'assignee', value: search.assignee })
  if (search.overdue) filters.push({ id: 'overdue', value: search.overdue })
  if (search.q) filters.push({ id: 'search', value: search.q })
  const sorting =
    search.sort !== undefined
      ? [{ id: search.sort, desc: search.dir === 'desc' }]
      : [{ id: 'submitted', desc: true }]
  return {
    pageIndex: search.page ?? 0,
    pageSize: search.size ?? PAGE_SIZE_FALLBACK,
    sorting,
    grouping: [],
    filters,
  }
}

function searchFromQuery(
  query: RegistryQuery,
  selectedId: string | null,
): ReviewsSearch {
  const get = (id: string) =>
    query.filters.find((f) => f.id === id)?.value ?? ''
  return {
    selected: selectedId ?? undefined,
    status: get('status') || undefined,
    type: get('type') || undefined,
    assignee: get('assignee') || undefined,
    overdue: get('overdue') || undefined,
    q: get('search') || undefined,
    sort: query.sorting[0]?.id,
    dir: query.sorting[0]?.desc ? 'desc' : 'asc',
    page: query.pageIndex || undefined,
    size: query.pageSize === PAGE_SIZE_FALLBACK ? undefined : query.pageSize,
  }
}

// ---------------------------------------------------------------------------
// Columns.
// ---------------------------------------------------------------------------

function ownerLabel(
  userId: string,
  currentUserId: string,
  currentName: string,
): string {
  if (userId === currentUserId) return currentName
  if (!userId) return 'Unknown'
  return userId.length <= 10 ? userId : userId.slice(0, 10)
}

/**
 * Summary cards for the inbox header, derived from the full (unfiltered) set.
 * Exported so the inbox's derived counts can be tested without mounting the
 * route's data layer.
 */
export function buildReviewSummaries(
  items: ReviewItem[],
  currentUserId: string,
): RegistrySummary[] {
  const active = items.filter((item) => item.status === 'submitted')
  const overdue = active.filter((item) => item.isOverdue).length
  const mine = active.filter((item) =>
    item.assignedReviewerUserIds.includes(currentUserId),
  ).length
  return [
    {
      label: 'Awaiting review',
      value: active.length,
      hint: 'Submitted, not yet resolved',
    },
    {
      label: 'Overdue',
      value: overdue,
      hint: `Pending > ${OVERDUE_DAYS} days`,
    },
    {
      label: 'My queue',
      value: mine,
      hint: 'Assigned to you',
    },
    {
      label: 'Withdrawn',
      value: items.filter((item) => item.isWithdrawn).length,
      hint: 'No longer active',
    },
  ]
}

const columns: ColumnDef<ReviewItem, unknown>[] = [
  {
    id: 'entry',
    header: 'Entry',
    accessorFn: (row) => row.recordIdentifier,
    cell: ({ row }) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">
          {row.original.recordIdentifier}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {row.original.recordTitle}
        </p>
      </div>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    accessorFn: (row) => recordKindLabel(row.recordKind),
    cell: ({ row }) => (
      <Badge
        variant={TYPE_BADGE_VARIANT[row.original.recordKind] ?? 'outline'}
        className="text-[10px]"
      >
        {recordKindLabel(row.original.recordKind)}
      </Badge>
    ),
  },
  {
    id: 'project',
    header: 'Project',
    accessorFn: (row) => row.projectTitle ?? '',
    cell: ({ row }) =>
      row.original.projectTitle ? (
        <span className="truncate text-sm text-foreground">
          {row.original.projectTitle}
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  },
  {
    id: 'submitter',
    header: 'Requested by',
    accessorFn: (row) => row.submittedByUserId,
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.submittedByUserId}
      </span>
    ),
  },
  {
    id: 'step',
    header: 'Current step',
    accessorFn: (row) => row.currentStep.label,
    cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <StatusBadge
          status={row.original.status}
          vocabulary={inboxStatusVocabulary}
          size="sm"
        />
        <span className="text-xs text-muted-foreground">
          {row.original.currentStep.label}
        </span>
      </div>
    ),
  },
  {
    id: 'submitted',
    header: 'Submitted',
    accessorFn: (row) => row.submittedAt,
    cell: ({ row }) => {
      const item = row.original
      const overdue = item.isOverdue
      return (
        <div className="flex flex-col gap-0.5">
          <span
            className={cn(
              'text-xs tabular-nums',
              overdue
                ? 'font-semibold text-red-600 dark:text-red-400'
                : 'text-muted-foreground',
            )}
          >
            {formatDate(item.submittedAt)}
          </span>
          {overdue ? (
            <span className="text-[10px] font-medium text-red-600 dark:text-red-400">
              Overdue
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              {formatRelativeTime(item.submittedAt)}
            </span>
          )}
        </div>
      )
    },
  },
  {
    id: 'priority',
    header: 'Priority',
    accessorFn: (row) => row.priority,
    cell: ({ row }) => {
      const meta = PRIORITY_META[row.original.priority]
      return (
        <span className={cn('text-xs font-semibold capitalize', meta)}>
          {row.original.priority}
        </span>
      )
    },
  },
]

// ---------------------------------------------------------------------------
// Route component.
// ---------------------------------------------------------------------------

function ReviewsRoute() {
  const { context } = Route.useRouteContext()
  const navigate = useNavigate()
  const search = useSearch({ from: '/reviews' })

  const currentUserId = context.user.id
  const currentUserName = context.user.name
  const workspaceId = context.workspace?.id ?? 'workspace'

  const query = useMemo(() => queryFromSearch(search), [search])
  const selectedId = search.selected ?? null

  // --- Data queries -------------------------------------------------------

  const submissionsQuery = useQuery({
    queryKey: reviewQueryKeys.submissions(),
    queryFn: () => fetchReviewSubmissions(reviewsDataClient),
  })

  const recordIds = useMemo(() => {
    const subs = submissionsQuery.data ?? []
    const ids = new Set<string>()
    for (const s of subs) ids.add(s.record_id)
    return Array.from(ids)
  }, [submissionsQuery.data])

  const recordsQuery = useQuery({
    queryKey: reviewQueryKeys.recordsForReviews(recordIds),
    queryFn: () => fetchRecordsForReviews(reviewsDataClient, recordIds),
    enabled: recordIds.length > 0,
  })

  const projectsQuery = useQuery({
    queryKey: reviewQueryKeys.projectsForReviews(),
    queryFn: () => fetchProjectsForReviews(reviewsDataClient),
  })

  // --- Join submissions -> records -> projects ----------------------------

  const allItems = useMemo<ReviewItem[]>(() => {
    const subs = submissionsQuery.data ?? []
    const recordMap = new Map((recordsQuery.data ?? []).map((r) => [r.id, r]))
    const projectMap = projectsQuery.data ?? new Map()
    return subs.map((submission: ReviewSubmissionWire) => {
      const record = recordMap.get(submission.record_id)
      const project = record?.project_id
        ? projectMap.get(record.project_id)
        : undefined
      return toReviewItem(
        submission,
        record,
        project?.title ?? null,
        project?.key ?? null,
      )
    })
  }, [submissionsQuery.data, recordsQuery.data, projectsQuery.data])

  // --- Filter / sort / paginate (client-side over the bounded fetch) ------

  const filters = useMemo<ReviewFilterInput>(
    () => ({
      status:
        query.filters.find((f) => f.id === 'status')?.value ??
        DEFAULT_REVIEW_FILTERS.status,
      type:
        query.filters.find((f) => f.id === 'type')?.value ??
        DEFAULT_REVIEW_FILTERS.type,
      assignee:
        query.filters.find((f) => f.id === 'assignee')?.value ??
        DEFAULT_REVIEW_FILTERS.assignee,
      overdue:
        query.filters.find((f) => f.id === 'overdue')?.value ??
        DEFAULT_REVIEW_FILTERS.overdue,
      search:
        query.filters.find((f) => f.id === 'search')?.value ??
        DEFAULT_REVIEW_FILTERS.search,
    }),
    [query.filters],
  )

  const filteredItems = useMemo(
    () => filterReviews(allItems, filters, currentUserId),
    [allItems, filters, currentUserId],
  )

  const sortedItems = useMemo(
    () =>
      sortReviews(
        filteredItems,
        query.sorting[0]?.id,
        query.sorting[0]?.desc ?? false,
      ),
    [filteredItems, query.sorting],
  )

  const totalCount = sortedItems.length
  const pageIndex = Math.min(
    query.pageIndex,
    Math.max(0, Math.ceil(totalCount / query.pageSize) - 1),
  )
  const rows = useMemo(
    () => paginateReviews(sortedItems, pageIndex, query.pageSize),
    [sortedItems, pageIndex, query.pageSize],
  )

  // Selected record loaded independently of the current page so the inspector
  // stays populated when the selection is filtered or on another page.
  const selectedRecord = useMemo<ReviewItem | null>(() => {
    if (!selectedId) return null
    return sortedItems.find((item) => item.id === selectedId) ?? null
  }, [selectedId, sortedItems])

  // --- Error / permission state -------------------------------------------

  const permissionDenied =
    (submissionsQuery.error instanceof DataClientError &&
      (submissionsQuery.error.code === 'permission_denied' ||
        submissionsQuery.error.code === 'unauthenticated')) ||
    (recordsQuery.error instanceof DataClientError &&
      recordsQuery.error.code === 'permission_denied')

  // --- Summary cards (derived from the full, unfiltered set) --------------

  const summaries: RegistrySummary[] = useMemo(
    () => buildReviewSummaries(allItems, currentUserId),
    [allItems, currentUserId],
  )

  // --- Query change handlers (URL is source of truth) ---------------------

  function handleQueryChange(next: RegistryQuery) {
    void navigate({
      to: '/reviews',
      search: searchFromQuery(next, selectedId),
      replace: true,
    })
  }

  function handleSelectedIdChange(id: string | null) {
    void navigate({
      to: '/reviews',
      search: searchFromQuery(query, id),
      replace: true,
    })
  }

  // --- Filter definitions for the composition toolbar ---------------------

  const filterDefinitions = [
    {
      id: 'status',
      label: 'Status',
      placeholder: 'All statuses',
      options: [
        { value: 'submitted', label: 'Under review' },
        { value: 'withdrawn', label: 'Withdrawn' },
        { value: 'approved', label: 'Approved' },
        { value: 'rejected', label: 'Rejected' },
        { value: 'returned', label: 'Returned' },
      ],
    },
    {
      id: 'type',
      label: 'Type',
      placeholder: 'All types',
      options: [
        { value: 'experiment', label: 'Experiments' },
        { value: 'protocol_template', label: 'Protocols' },
        { value: 'report', label: 'Reports' },
        { value: 'dataset', label: 'Datasets' },
      ],
    },
    {
      id: 'assignee',
      label: 'Assignee',
      placeholder: 'Everyone',
      options: [{ value: 'mine', label: 'My queue' }],
    },
    {
      id: 'overdue',
      label: 'Overdue',
      placeholder: 'Any age',
      options: [{ value: 'overdue', label: 'Overdue only' }],
    },
    {
      id: 'search',
      label: 'Search',
      placeholder: 'Identifier, title, submitter…',
    },
  ]

  // --- Inspector ----------------------------------------------------------

  function renderInspector(row: ReviewItem | null): ReactNode {
    if (!row) {
      return (
        <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-6 text-center">
          <ClipboardList className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold">No review selected</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Select a row to inspect the submission, workflow and assignees.
          </p>
        </div>
      )
    }

    const steps = workflowStepsFor(row.workflowDefinitionKey)
    const submitterLabel = ownerLabel(
      row.submittedByUserId,
      currentUserId,
      currentUserName,
    )
    const overdue = row.isOverdue

    return (
      <ReviewInspector
        row={row}
        steps={steps}
        submitterLabel={submitterLabel}
        overdue={overdue}
        onClose={() => handleSelectedIdChange(null)}
      />
    )
  }

  // --- Render -------------------------------------------------------------

  const loading =
    submissionsQuery.isLoading ||
    (recordIds.length > 0 && recordsQuery.isLoading)

  const shellContext = {
    workspace: context.workspace ? { name: context.workspace.name } : null,
    user: {
      name: context.user.name,
      email: context.user.email,
      role: context.workspace?.role,
    },
  }

  useShell({
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Reviews' }],
  })

  return (
    <>
      <RegistryComposition<ReviewItem>
        registryId="reviews"
        workspaceId={workspaceId}
        userId={currentUserId}
        title="Review inbox"
        description="Central queue for items requiring scientific or QA review."
        rows={rows}
        totalCount={totalCount}
        columns={columns}
        query={query}
        onQueryChange={handleQueryChange}
        getRowId={(row) => row.id}
        selectedId={selectedId}
        selectedRecord={selectedRecord}
        onSelectedIdChange={handleSelectedIdChange}
        summaries={summaries}
        filterDefinitions={filterDefinitions}
        renderInspector={renderInspector}
        loading={loading}
        error={submissionsQuery.error ?? recordsQuery.error}
        permissionDenied={permissionDenied}
        onRetry={() => {
          void submissionsQuery.refetch()
          void recordsQuery.refetch()
        }}
        emptyTitle="No reviews yet"
        noResultsTitle="No matching reviews"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void submissionsQuery.refetch()
              void recordsQuery.refetch()
              void projectsQuery.refetch()
            }}
          >
            Refresh
          </Button>
        }
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Inspector — details, workflow stepper and honest action buttons.
// ---------------------------------------------------------------------------

export function ReviewInspector({
  row,
  steps,
  submitterLabel,
  overdue,
  onClose,
}: {
  row: ReviewItem
  steps: { key: string; label: string; required: boolean }[]
  submitterLabel: string
  overdue: boolean
  onClose: () => void
}) {
  const priorityMeta = PRIORITY_META[row.priority]
  const openDiffEnabled = Boolean(row.projectId)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2 border-b p-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <ClipboardList
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="truncate font-mono text-xs text-muted-foreground">
              {row.recordIdentifier}
            </span>
          </div>
          <p className="truncate text-sm font-semibold text-foreground">
            {row.recordTitle}
          </p>
          <StatusBadge
            status={row.status}
            vocabulary={inboxStatusVocabulary}
            size="sm"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close inspector"
        >
          <XCircle className="size-4" aria-hidden />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3 text-sm">
        {row.isWithdrawn ? (
          <div
            role="status"
            className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          >
            This review was withdrawn. No further actions are available.
          </div>
        ) : null}

        {overdue ? (
          <div
            role="status"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            <Clock className="mr-1 inline size-3.5" aria-hidden />
            Overdue — pending for more than {OVERDUE_DAYS} days.
          </div>
        ) : null}

        <dl className="space-y-1.5">
          <InspectorProp label="Type">
            {recordKindLabel(row.recordKind)}
          </InspectorProp>
          <InspectorProp label="Project">
            {row.projectTitle ?? '—'}
          </InspectorProp>
          <InspectorProp label="Requested by">
            <span
              className={cn(
                'text-xs',
                row.submittedByUserId.length > 10 && 'font-mono',
              )}
            >
              {submitterLabel}
            </span>
          </InspectorProp>
          <InspectorProp label="Submitted">
            {formatDate(row.submittedAt)}
          </InspectorProp>
          <InspectorProp label="Workflow">
            {row.workflowDefinitionKey} v{row.workflowDefinitionVersion}
          </InspectorProp>
          <InspectorProp label="Current step">
            {row.currentStep.label}
          </InspectorProp>
          <InspectorProp label="Priority">
            <span className={cn('font-semibold capitalize', priorityMeta)}>
              {row.priority}
            </span>
          </InspectorProp>
          <InspectorProp label="Due heuristic">
            <span
              className={cn(
                'text-xs',
                overdue && 'font-semibold text-red-600 dark:text-red-400',
              )}
            >
              {overdue
                ? 'Overdue (> 14 days)'
                : `Priority rises after ${MEDIUM_DAYS} days`}
            </span>
          </InspectorProp>
        </dl>

        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Review workflow
          </h3>
          <ol className="space-y-2">
            {steps.map((step, index) => {
              const active = index === 0 && row.status === 'submitted'
              return (
                <li key={step.key} className="flex items-start gap-2">
                  <span
                    className={cn(
                      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-muted text-muted-foreground',
                    )}
                    aria-current={active ? 'step' : undefined}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {step.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {active ? 'In progress' : 'Pending'}
                      {row.assignedReviewerUserIds.length > 0
                        ? ` · ${row.assignedReviewerUserIds.length} assignee${row.assignedReviewerUserIds.length === 1 ? '' : 's'}`
                        : ''}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>

        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Assignees
          </h3>
          {row.assignedReviewerUserIds.length === 0 ? (
            <p className="text-xs text-muted-foreground">No assignees.</p>
          ) : (
            <ul className="space-y-1">
              {row.assignedReviewerUserIds.map((userId) => (
                <li
                  key={userId}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">
                    {userId.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="font-mono">{userId}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="space-y-2 border-t p-3">
        <Link
          to="/reviews/$revisionId"
          params={{ revisionId: row.revisionId }}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary text-sm font-medium text-primary-foreground no-underline hover:bg-primary/90"
        >
          <ExternalLink className="size-4" aria-hidden />
          Open review workspace
        </Link>
        {openDiffEnabled ? (
          <Link
            to="/projects/$projectId/experiments/$recordId"
            params={{ projectId: row.projectId!, recordId: row.recordId }}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border text-sm font-medium no-underline hover:bg-muted"
          >
            <GitCompare className="size-4" aria-hidden />
            Open record
          </Link>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled>
            <GitCompare className="size-4" aria-hidden />
            Open record
          </Button>
        )}
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" disabled>
            <CheckCircle2 className="size-3.5" aria-hidden />
            Approve
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Undo2 className="size-3.5" aria-hidden />
            Changes
          </Button>
          <Button variant="outline" size="sm" disabled>
            <UserCog className="size-3.5" aria-hidden />
            Reassign
          </Button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground">
          Approve, request changes and reassign arrive with review transitions.
        </p>
      </div>
    </div>
  )
}

function InspectorProp({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{children}</dd>
    </div>
  )
}

// Re-export so tests can drive the column model without importing the route.
export { columns as reviewColumns }
