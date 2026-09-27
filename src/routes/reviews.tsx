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
  Outlet,
  useRouterState,
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
  XCircle,
} from 'lucide-react'

import { useShell } from '#/components/shell'
import { RegistryComposition } from '#/components/registry/registry-composition'
import type { DataGridField } from '#/components/data-grid'
import type { RegistrySummary } from '#/components/registry/registry-composition'
import { StatusBadge } from '#/components/scientific/status-badge'
import type { StatusVocabulary } from '#/components/scientific/status-badge'
import { Badge, Button } from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import { recordPath } from '#/lib/navigation'
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
import { useUserNames } from '#/lib/user-names'

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
  high: 'text-danger-text',
  medium: 'text-warning-text',
  low: 'text-success-text',
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
  if (search.status)
    filters.push({ fieldId: 'status', operator: 'eq', values: [search.status] })
  if (search.type)
    filters.push({ fieldId: 'type', operator: 'eq', values: [search.type] })
  if (search.assignee)
    filters.push({
      fieldId: 'assignee',
      operator: 'eq',
      values: [search.assignee],
    })
  if (search.overdue)
    filters.push({
      fieldId: 'overdue',
      operator: 'eq',
      values: [search.overdue],
    })
  if (search.q)
    filters.push({
      fieldId: 'search',
      operator: 'contains',
      values: [search.q],
    })
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
    String(query.filters.find((f) => f.fieldId === id)?.values[0] ?? '')
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

function buildColumns(
  userLabel: (userId: string) => string,
): ColumnDef<ReviewItem, unknown>[] {
  return [
    {
      id: 'entry',
      header: 'Entry',
      accessorFn: (row) => row.recordIdentifier,
      cell: ({ row }) => (
        <div className="min-w-0 py-0.5">
          <p className="truncate text-sm font-medium text-foreground">
            {row.original.recordIdentifier}
          </p>
          <p className="truncate text-xs leading-tight text-muted-foreground">
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
          className="text-xs"
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
      accessorFn: (row) => userLabel(row.submittedByUserId),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {userLabel(row.original.submittedByUserId)}
        </span>
      ),
    },
    {
      id: 'step',
      header: 'Current step',
      accessorFn: (row) => row.currentStep.label,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 py-0.5">
          <StatusBadge
            status={row.original.status}
            vocabulary={inboxStatusVocabulary}
            size="sm"
          />
          <span className="truncate text-xs text-muted-foreground">
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
          <span
            className={cn(
              'text-xs tabular-nums whitespace-nowrap',
              overdue
                ? 'font-semibold text-danger-text'
                : 'text-muted-foreground',
            )}
          >
            {formatDate(item.submittedAt)}
            {!overdue && (
              <span className="ml-1 text-muted-foreground/70">
                {formatRelativeTime(item.submittedAt)}
              </span>
            )}
            {overdue && (
              <span className="ml-1 text-danger-text">· Overdue</span>
            )}
          </span>
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
}

// ---------------------------------------------------------------------------
// Route component.
// ---------------------------------------------------------------------------

export function ReviewsRoute() {
  const isIndex = useRouterState({
    select: (state) =>
      state.location.pathname.replace(/\/$/, '') === '/reviews',
  })
  return isIndex ? <ReviewsInboxRoute /> : <Outlet />
}

function ReviewsInboxRoute() {
  const { context } = Route.useRouteContext()
  const navigate = useNavigate()
  const search = useSearch({ from: '/reviews' })

  const currentUserId = context.user.id

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

  // --- Resolve user IDs → names (server-side; internal.user not PostgREST-exposed) ---

  const userIdsToResolve = useMemo(() => {
    const ids = new Set<string>()
    for (const item of allItems) {
      if (item.submittedByUserId) ids.add(item.submittedByUserId)
      for (const rId of item.assignedReviewerUserIds) ids.add(rId)
    }
    return Array.from(ids)
  }, [allItems])

  const { userLabel } = useUserNames(userIdsToResolve, {
    id: context.user.id,
    name: context.user.name,
  })

  // --- Filter / sort / paginate (client-side over the bounded fetch) ------

  const filters = useMemo<ReviewFilterInput>(
    () => ({
      status: String(
        query.filters.find((f) => f.fieldId === 'status')?.values[0] ??
          DEFAULT_REVIEW_FILTERS.status,
      ),
      type: String(
        query.filters.find((f) => f.fieldId === 'type')?.values[0] ??
          DEFAULT_REVIEW_FILTERS.type,
      ),
      assignee: String(
        query.filters.find((f) => f.fieldId === 'assignee')?.values[0] ??
          DEFAULT_REVIEW_FILTERS.assignee,
      ),
      overdue: String(
        query.filters.find((f) => f.fieldId === 'overdue')?.values[0] ??
          DEFAULT_REVIEW_FILTERS.overdue,
      ),
      search: String(
        query.filters.find((f) => f.fieldId === 'search')?.values[0] ??
          DEFAULT_REVIEW_FILTERS.search,
      ),
    }),
    [query.filters],
  )

  const filteredItems = useMemo(
    () => filterReviews(allItems, filters, currentUserId, userLabel),
    [allItems, filters, currentUserId, userLabel],
  )

  const sortedItems = useMemo(
    () =>
      sortReviews(
        filteredItems,
        query.sorting[0]?.id,
        query.sorting[0]?.desc ?? false,
        userLabel,
      ),
    [filteredItems, query.sorting, userLabel],
  )

  const totalCount = sortedItems.length
  const pageIndex = Math.min(
    query.pageIndex,
    Math.max(0, Math.ceil(totalCount / query.pageSize) - 1),
  )
  const columns = useMemo(() => buildColumns(userLabel), [userLabel])

  const rows = useMemo(
    () => paginateReviews(sortedItems, pageIndex, query.pageSize),
    [sortedItems, pageIndex, query.pageSize],
  )

  // Selected record loaded independently of the current page so the inspector
  // stays populated when the selection is filtered or on another page.
  const selectedRecord = useMemo<ReviewItem | null>(() => {
    if (!selectedId) return null
    return allItems.find((item) => item.id === selectedId) ?? null
  }, [selectedId, allItems])

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
  const fields: DataGridField<ReviewItem>[] = columns.map((column) => {
    const id = String(column.id)
    const definition = filterDefinitions.find(
      (candidate) => candidate.id === id,
    )
    return {
      id,
      label: definition?.label ?? id,
      column,
      groupable: false,
      filter: definition
        ? {
            type: definition.options ? 'select' : 'text',
            placeholder: definition.placeholder,
            operators: [
              {
                value: definition.options ? 'eq' : 'contains',
                label: definition.options ? 'is' : 'contains',
              },
            ],
            options: definition.options,
          }
        : undefined,
    }
  })
  const searchDefinition = filterDefinitions.find(
    (candidate) => candidate.id === 'search',
  )!
  fields.push({
    id: 'search',
    label: searchDefinition.label,
    column: false,
    groupable: false,
    filter: {
      type: 'text',
      placeholder: searchDefinition.placeholder,
      operators: [{ value: 'contains', label: 'contains' }],
    },
  })
  for (const definition of filterDefinitions.filter(
    (candidate) => !fields.some((field) => field.id === candidate.id),
  )) {
    fields.push({
      id: definition.id,
      label: definition.label,
      column: false,
      groupable: false,
      filter: {
        type: 'select',
        placeholder: definition.placeholder,
        operators: [{ value: 'eq', label: 'is' }],
        options: definition.options,
      },
    })
  }

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
    const submitterLabel = userLabel(row.submittedByUserId)
    const overdue = row.isOverdue

    return (
      <ReviewInspector
        row={row}
        steps={steps}
        submitterLabel={submitterLabel}
        overdue={overdue}
        userLabel={userLabel}
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
    fullBleed: true,
    context: shellContext,
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Reviews' }],
  })

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
        <RegistryComposition<ReviewItem>
          registryId="reviews"
          title="Review inbox"
          description="Review submitted work and follow up on outstanding decisions."
          rows={rows}
          totalCount={totalCount}
          fields={fields}
          query={{ ...query, pageIndex }}
          onQueryChange={handleQueryChange}
          getRowId={(row) => row.id}
          selectedId={selectedId}
          selectedRecord={selectedRecord}
          onSelectedIdChange={handleSelectedIdChange}
          summaries={summaries}
          renderInspector={renderInspector}
          loading={loading}
          error={
            submissionsQuery.error ?? recordsQuery.error ?? projectsQuery.error
          }
          permissionDenied={permissionDenied}
          onRetry={() => {
            void submissionsQuery.refetch()
            void recordsQuery.refetch()
            void projectsQuery.refetch()
          }}
          emptyTitle="No reviews yet"
          emptyDescription="Submit an experiment or record for review from its notebook. It will appear here for the assigned reviewers."
          noResultsTitle="No matching reviews"
          actions={
            <Button
              variant="outline"
              size="sm"
              disabled={
                submissionsQuery.isFetching ||
                recordsQuery.isFetching ||
                projectsQuery.isFetching
              }
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
      </div>
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
  userLabel,
  onClose,
}: {
  row: ReviewItem
  steps: { key: string; label: string; required: boolean }[]
  submitterLabel: string
  overdue: boolean
  userLabel: (userId: string) => string
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
            className="rounded-md border border-danger-border bg-danger-wash px-3 py-2 text-xs text-danger-text"
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
            <span className="text-xs text-foreground">{submitterLabel}</span>
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
          <InspectorProp label="Review age">
            <span
              className={cn(
                'text-xs',
                overdue && 'font-semibold text-danger-text',
              )}
            >
              {overdue
                ? 'Overdue (> 14 days)'
                : `Priority rises after ${MEDIUM_DAYS} days`}
            </span>
          </InspectorProp>
        </dl>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Review workflow
          </h3>
          <ol className="space-y-2">
            {steps.map((step, index) => {
              const active = index === 0 && row.status === 'submitted'
              return (
                <li key={step.key} className="flex items-start gap-2">
                  <span
                    className={cn(
                      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
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
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Assignees
          </h3>
          {row.assignedReviewerUserIds.length === 0 ? (
            <p className="text-xs text-muted-foreground">No assignees.</p>
          ) : (
            <ul className="space-y-1">
              {row.assignedReviewerUserIds.map((userId) => {
                const name = userLabel(userId)
                return (
                  <li
                    key={userId}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {name.slice(0, 2).toUpperCase()}
                    </span>
                    <span>{name}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="space-y-2 border-t p-3">
        <div className="flex gap-2">
          <Link
            to="/reviews/$revisionId"
            params={{ revisionId: row.revisionId }}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-medium text-primary-foreground no-underline hover:bg-primary/90"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            Open review
          </Link>
          {openDiffEnabled ? (
            <Link
              to={recordPath(row.recordId)}
              className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs font-medium no-underline hover:bg-muted"
            >
              <GitCompare className="size-3.5" aria-hidden />
              Open record
            </Link>
          ) : (
            <Button variant="outline" size="sm" className="flex-1" disabled>
              <GitCompare className="size-3.5" aria-hidden />
              Open record
            </Button>
          )}
        </div>
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
export { buildColumns as buildReviewColumns }
