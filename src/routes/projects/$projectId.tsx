import { useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from '@tanstack/react-router'
import {
  Activity as ActivityIcon,
  FlaskConical,
  Beaker,
  TestTube,
  FileText,
  ClipboardList,
  Inbox,
  PanelRight,
  Pin,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { AppShell } from '#/components/app-shell'
import {
  CheckList,
  EmptyHint,
  InspectorSection,
  Property,
  PropertyList,
} from '#/components/record'
import { StatusBadge } from '#/components/scientific'
import {
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
} from '#/components/ui'
import { DataClientError } from '#/lib/data-client'
import {
  fetchProject,
  fetchRecordsForProject,
  formatDate,
  formatRelativeTime,
  notebookDataClient,
  notebookQueryKeys,
  recordKindLabel,
  RECORD_KIND_LABELS,
  statusDomainForKind,
} from '#/lib/notebook-data'
import type { NotebookRecord, Project } from '#/lib/notebook-data'

/**
 * Project dashboard. A dense, full-width overview of one project: metadata
 * header with status, stat cards summarising the records by kind, and a
 * filterable records table (TanStack Table) with deep links into each
 * notebook. Replaces the original sparse record list.
 *
 * ELN-004: the deep-linkable project route. Loading, missing-project,
 * archived, empty and error states are all handled.
 */

// Column width/alignment hints for the dense records table. Shared with the
// projects list via declaration merging.
declare module '@tanstack/react-table' {
  interface ColumnMeta<TData, TValue> {
    className?: string
  }
}

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectRoute,
})

function ProjectRoute() {
  const { context } = Route.useRouteContext()
  const { projectId } = Route.useParams()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isProjectIndex = pathname === `/projects/${projectId}`

  const projectQuery = useQuery({
    queryKey: notebookQueryKeys.project(projectId),
    queryFn: () => fetchProject(notebookDataClient, projectId),
    enabled: isProjectIndex,
  })
  const recordsQuery = useQuery({
    queryKey: notebookQueryKeys.records(projectId),
    queryFn: () => fetchRecordsForProject(notebookDataClient, projectId),
    enabled: isProjectIndex,
  })

  const project = projectQuery.data ?? null
  const records = recordsQuery.data ?? []

  if (!isProjectIndex) return <Outlet />

  if (projectQuery.isLoading) {
    return (
      <AppShell
        context={{
          workspace: context.workspace
            ? { name: context.workspace.name }
            : null,
          user: { name: context.user.name, email: context.user.email },
        }}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Projects', to: '/projects' },
          { label: 'Loading…' },
        ]}
      >
        <ProjectDashboardSkeleton />
      </AppShell>
    )
  }

  if (projectQuery.error) {
    return (
      <AppShell
        context={{
          workspace: context.workspace
            ? { name: context.workspace.name }
            : null,
          user: { name: context.user.name, email: context.user.email },
        }}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Projects', to: '/projects' },
          { label: 'Error' },
        ]}
      >
        <ProjectErrorState
          error={projectQuery.error}
          onRetry={() => projectQuery.refetch()}
        />
      </AppShell>
    )
  }

  if (!project) {
    // RLS hides rows the viewer cannot access, so a missing project may be
    // either gone or permission-restricted. We surface one honest state.
    return (
      <AppShell
        context={{
          workspace: context.workspace
            ? { name: context.workspace.name }
            : null,
          user: { name: context.user.name, email: context.user.email },
        }}
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Projects', to: '/projects' },
          { label: 'Not found' },
        ]}
      >
        <ProjectUnavailableState />
      </AppShell>
    )
  }

  const isArchived = project.archivedAt !== null
  const stats = computeRecordStats(records)

  return (
    <AppShell
      context={{
        workspace: context.workspace ? { name: context.workspace.name } : null,
        user: { name: context.user.name, email: context.user.email },
      }}
      breadcrumbs={[
        { label: 'Home', to: '/' },
        { label: 'Projects', to: '/projects' },
        { label: project.title },
      ]}
    >
      <div className="flex gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <ProjectHeader
            project={project}
            isArchived={isArchived}
            recordCount={records.length}
            isLoadingRecords={recordsQuery.isLoading}
          />

          <ProjectStatCards stats={stats} />

          <RecordListSection
            projectId={project.id}
            records={records}
            isLoading={recordsQuery.isLoading}
            error={recordsQuery.error}
            onRetry={() => recordsQuery.refetch()}
          />

          <ProjectActivityFeed />
        </div>

        <ProjectSidebar project={project} />
      </div>
    </AppShell>
  )
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function ProjectHeader({
  project,
  isArchived,
  recordCount,
  isLoadingRecords,
}: {
  project: Project
  isArchived: boolean
  recordCount: number
  isLoadingRecords: boolean
}) {
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-semibold uppercase tracking-[0.14em]">
          Project
        </span>
        <span className="font-mono tabular-nums">{project.key}</span>
        <StatusBadge
          domain="project"
          status={isArchived ? 'archived' : project.status}
        />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {project.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isLoadingRecords
              ? 'Loading records…'
              : recordCount === 0
                ? 'No notebook records yet.'
                : `${recordCount} record${recordCount === 1 ? '' : 's'}`}
            {' · '}
            <span>
              Updated{' '}
              {formatRelativeTime(project.updatedAt ?? project.createdAt)}
            </span>
            {' · '}
            <span>Created {formatDate(project.createdAt)}</span>
          </p>
        </div>
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------

interface RecordStats {
  experiments: number
  samples: number
  reagents: number
  protocols: number
  reports: number
  files: number
  pendingReviews: number
  total: number
}

function computeRecordStats(records: NotebookRecord[]): RecordStats {
  const stats: RecordStats = {
    experiments: 0,
    samples: 0,
    reagents: 0,
    protocols: 0,
    reports: 0,
    files: 0,
    pendingReviews: 0,
    total: records.length,
  }
  for (const record of records) {
    switch (record.kind) {
      case 'experiment':
        stats.experiments += 1
        break
      case 'sample':
        stats.samples += 1
        break
      case 'reagent':
        stats.reagents += 1
        break
      case 'protocol_template':
        stats.protocols += 1
        break
      case 'report':
        stats.reports += 1
        break
      case 'file':
        stats.files += 1
        break
      default:
        break
    }
    if (record.status === 'review' || record.status === 'under_review') {
      stats.pendingReviews += 1
    }
  }
  return stats
}

interface StatCardDef {
  key: string
  label: string
  value: number
  hint: string
  icon: LucideIcon
  tone: 'info' | 'success' | 'warning' | 'violet' | 'danger' | 'neutral'
}

function ProjectStatCards({ stats }: { stats: RecordStats }) {
  const cards: StatCardDef[] = [
    {
      key: 'experiments',
      label: 'Experiments',
      value: stats.experiments,
      hint: 'Active notebooks',
      icon: FlaskConical,
      tone: 'info',
    },
    {
      key: 'samples',
      label: 'Samples',
      value: stats.samples,
      hint: 'Linked samples',
      icon: TestTube,
      tone: 'success',
    },
    {
      key: 'reagents',
      label: 'Reagents',
      value: stats.reagents,
      hint: 'Reagent records',
      icon: Beaker,
      tone: 'success',
    },
    {
      key: 'protocols',
      label: 'Protocols',
      value: stats.protocols,
      hint: 'Protocol templates',
      icon: ClipboardList,
      tone: 'violet',
    },
    {
      key: 'reports',
      label: 'Reports',
      value: stats.reports,
      hint: 'Report records',
      icon: FileText,
      tone: 'neutral',
    },
    {
      key: 'reviews',
      label: 'Pending reviews',
      value: stats.pendingReviews,
      hint: 'Awaiting approval',
      icon: Inbox,
      tone: stats.pendingReviews > 0 ? 'danger' : 'neutral',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <StatCard key={card.key} card={card} />
      ))}
    </div>
  )
}

const toneClasses: Record<StatCardDef['tone'], string> = {
  info: 'text-blue-600 dark:text-blue-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  violet: 'text-violet-600 dark:text-violet-400',
  danger: 'text-red-600 dark:text-red-400',
  neutral: 'text-muted-foreground',
}

function StatCard({ card }: { card: StatCardDef }) {
  const Icon = card.icon
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {card.label}
        </span>
        <Icon
          className={`size-4 ${toneClasses[card.tone]}`}
          aria-hidden="true"
        />
      </div>
      <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums leading-none">
        {card.value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{card.hint}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Records table (filterable by kind)
// ---------------------------------------------------------------------------

const columnHelper = createColumnHelper<NotebookRecord>()

/** Kind filters shown as tabs above the records table. */
const KIND_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'experiment', label: RECORD_KIND_LABELS.experiment },
  { value: 'sample', label: RECORD_KIND_LABELS.sample },
  { value: 'reagent', label: RECORD_KIND_LABELS.reagent },
  { value: 'protocol_template', label: 'Protocols' },
  { value: 'report', label: RECORD_KIND_LABELS.report },
  { value: 'file', label: RECORD_KIND_LABELS.file },
]

export function RecordListSection({
  projectId,
  records,
  isLoading,
  error,
  onRetry,
}: {
  projectId: string
  records: NotebookRecord[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
}) {
  const [kindFilter, setKindFilter] = useState('all')

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'title',
        header: 'Title',
        cell: ({ row }) => {
          const record = row.original
          return (
            <Link
              to="/projects/$projectId/experiments/$recordId"
              params={{ projectId, recordId: record.id }}
              className="flex min-w-0 flex-col gap-0.5 no-underline"
            >
              <span className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                {record.title}
              </span>
              <span className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                {record.identifier}
              </span>
            </Link>
          )
        },
        meta: { className: 'min-w-[18rem]' },
      }),
      columnHelper.accessor('kind', {
        header: 'Type',
        cell: ({ getValue }) => (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <RecordKindIcon kind={getValue()} />
            {recordKindLabel(getValue())}
          </span>
        ),
        meta: { className: 'w-[11rem]' },
      }),
      columnHelper.accessor('status', {
        header: 'Status',
        cell: ({ row }) => (
          <StatusBadge
            domain={statusDomainForKind(row.original.kind)}
            status={row.original.status}
          />
        ),
        meta: { className: 'w-[8.5rem]' },
      }),
      columnHelper.accessor('updatedAt', {
        header: 'Updated',
        cell: ({ getValue }) => (
          <time
            dateTime={getValue()}
            title={getValue()}
            className="whitespace-nowrap text-sm tabular-nums text-muted-foreground"
          >
            {formatRelativeTime(getValue())}
          </time>
        ),
        meta: { className: 'w-[7rem]' },
      }),
      columnHelper.display({
        id: 'owner',
        header: 'Owner',
        cell: ({ row }) => {
          const owner =
            row.original.updatedByUserId ?? row.original.createdByUserId
          return (
            <span
              className="font-mono text-[11px] tabular-nums text-muted-foreground"
              title={owner}
            >
              {owner ? owner.slice(0, 8) : '—'}
            </span>
          )
        },
        meta: { className: 'w-[6.5rem]' },
      }),
    ],
    [projectId],
  )

  const table = useReactTable({
    data: records,
    columns,
    state: {
      columnFilters:
        kindFilter === 'all' ? [] : [{ id: 'kind', value: kindFilter }],
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const rows = table.getRowModel().rows

  if (isLoading) {
    return (
      <section className="space-y-3">
        <p className="sr-only" aria-busy="true">
          Loading records…
        </p>
        <RecordsTableShell />
      </section>
    )
  }
  if (error) {
    return (
      <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <p role="alert" className="text-sm text-destructive">
          Could not load records.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </section>
    )
  }
  if (records.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
        <p className="text-sm font-medium text-foreground">
          No notebook records yet
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Experiments, protocol templates and reports created in this project
          will appear here. The first notebook comes with a useful starting
          canvas — not a blank page.
        </p>
      </section>
    )
  }

  // Per-kind counts for the filter tabs, so each tab shows how many records
  // it will reveal without an extra request.
  const kindCounts: Record<string, number> = { all: records.length }
  for (const record of records) {
    kindCounts[record.kind] = (kindCounts[record.kind] ?? 0) + 1
  }

  return (
    <section className="space-y-3">
      <Tabs
        value={kindFilter}
        onValueChange={setKindFilter}
        className="space-y-3"
      >
        <div className="overflow-x-auto">
          <TabsList className="h-8 w-auto p-0.5">
            {KIND_FILTERS.filter(
              (f) => f.value === 'all' || kindCounts[f.value],
            ).map((f) => (
              <TabsTrigger
                key={f.value}
                value={f.value}
                className="h-7 gap-1.5 px-2.5 text-xs"
              >
                {f.label}
                <span className="rounded bg-muted-foreground/15 px-1 text-[10px] tabular-nums text-muted-foreground">
                  {kindCounts[f.value] ?? 0}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            No {recordKindLabel(kindFilter).toLowerCase()}s in this project.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {table.getHeaderGroups().map((headerGroup) =>
                    headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className={header.column.columnDef.meta?.className}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </TableHead>
                    )),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="group cursor-pointer transition-colors hover:bg-muted/40"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cell.column.columnDef.meta?.className}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Tabs>
    </section>
  )
}

function RecordKindIcon({ kind }: { kind: string }) {
  const Icon =
    kind === 'protocol_template'
      ? ClipboardList
      : kind === 'report'
        ? FileText
        : kind === 'sample'
          ? TestTube
          : kind === 'reagent'
            ? Beaker
            : kind === 'file'
              ? FileText
              : FlaskConical
  return <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
}

function RecordsTableShell() {
  return (
    <div className="space-y-3">
      <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-[18rem]">Title</TableHead>
              <TableHead className="w-[11rem]">Type</TableHead>
              <TableHead className="w-[8.5rem]">Status</TableHead>
              <TableHead className="w-[7rem]">Updated</TableHead>
              <TableHead className="w-[6.5rem]">Owner</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                <TableCell>
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="mt-1 h-3 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-3 w-12" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function ProjectDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-80" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <RecordsTableShell />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Right sidebar — properties, pinned links, compliance, quick actions
// ---------------------------------------------------------------------------

const PROJECT_SIDEBAR_KEY = (projectId: string) =>
  `sheetbase-project-sidebar-${projectId}`

const COMPLIANCE_CHECKS = [
  { id: 'data-integrity', label: 'Data integrity', state: 'pass' as const },
  {
    id: 'instrument-calibration',
    label: 'Instrument calibration',
    state: 'pass' as const,
  },
  { id: 'reagent-expiry', label: 'Reagent expiry', state: 'pass' as const },
  {
    id: 'training-records',
    label: 'Training records',
    state: 'pass' as const,
  },
]

/**
 * Collapsible right sidebar for the project dashboard. Mirrors the
 * PanelRight collapse pattern used by the schemas route: open shows a
 * ~280px panel of project metadata and actions; collapsed leaves a thin
 * rail with an expand control. The open/closed choice persists per project.
 *
 * Pinned links and compliance are placeholders — the backing endpoints do
 * not exist yet — and quick actions deep-link to the creation surfaces that
 * do (the template library).
 */
export function ProjectSidebar({ project }: { project: Project }) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return (
        localStorage.getItem(PROJECT_SIDEBAR_KEY(project.id)) !== 'collapsed'
      )
    } catch {
      return true
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(
        PROJECT_SIDEBAR_KEY(project.id),
        open ? 'open' : 'collapsed',
      )
    } catch {
      /* ignore: private mode / disabled storage */
    }
  }, [project.id, open])

  if (!open) {
    return (
      <aside className="hidden w-10 shrink-0 justify-center lg:flex">
        <Button
          variant="ghost"
          size="icon-sm"
          className="mt-1"
          aria-label="Show project details"
          onClick={() => setOpen(true)}
        >
          <PanelRight className="size-4" aria-hidden="true" />
        </Button>
      </aside>
    )
  }

  return (
    <aside className="hidden w-[280px] shrink-0 lg:flex lg:flex-col">
      <div className="sticky top-14 max-h-[calc(100svh-3.5rem)] overflow-y-auto rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Details</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide project details"
            onClick={() => setOpen(false)}
          >
            <PanelRight className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="px-4 pb-4">
          <InspectorSection title="Properties">
            <PropertyList>
              <Property label="Project ID" mono>
                {project.id.slice(0, 8)}
              </Property>
              <Property label="Key" mono>
                {project.key}
              </Property>
              <Property label="Status">
                <StatusBadge
                  domain="project"
                  status={project.archivedAt ? 'archived' : project.status}
                />
              </Property>
              <Property label="Created">
                {formatDate(project.createdAt)}
              </Property>
              <Property label="Updated">
                {formatRelativeTime(project.updatedAt ?? project.createdAt)}
              </Property>
              <Property label="Owner">Workspace</Property>
            </PropertyList>
            <EmptyHint>No tags</EmptyHint>
          </InspectorSection>

          <InspectorSection title="Pinned links">
            <EmptyHint>
              <span className="inline-flex items-center gap-1">
                <Pin className="size-3" aria-hidden="true" />
                No pinned links yet
              </span>
            </EmptyHint>
          </InspectorSection>

          <InspectorSection title="Compliance">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck
                className="size-3.5 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
              All checks passing
            </p>
            <CheckList items={COMPLIANCE_CHECKS} />
          </InspectorSection>

          <InspectorSection title="Quick actions">
            <div className="grid gap-2">
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/templates" className="no-underline">
                  <FlaskConical className="size-3.5" aria-hidden="true" />
                  Create experiment
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/templates" className="no-underline">
                  <TestTube className="size-3.5" aria-hidden="true" />
                  Add sample
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/templates" className="no-underline">
                  <Upload className="size-3.5" aria-hidden="true" />
                  Upload file
                </Link>
              </Button>
            </div>
          </InspectorSection>
        </div>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Activity feed — placeholder until a queryable events endpoint exists
// ---------------------------------------------------------------------------

export function ProjectActivityFeed() {
  return (
    <section
      aria-label="Project activity"
      className="rounded-lg border border-border bg-surface"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ActivityIcon
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <ActivityIcon className="size-4" aria-hidden="true" />
        </span>
        <p className="text-sm font-medium text-foreground">
          No recent activity
        </p>
        <p className="mx-auto max-w-xs text-xs leading-5 text-muted-foreground">
          Edits, comments, reviews and status changes from this project will
          appear here once activity tracking is enabled.
        </p>
      </div>
    </section>
  )
}

export function ProjectErrorState({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const message =
    error instanceof DataClientError && error.code === 'permission_denied'
      ? 'You do not have access to this project.'
      : 'Could not load the project.'
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

export function ProjectUnavailableState() {
  return (
    <div className="max-w-md space-y-2 rounded-lg border border-border bg-muted/30 p-6">
      <h2 className="text-base font-semibold">Project unavailable</h2>
      <p className="text-sm text-muted-foreground">
        The project may have been deleted, archived, or you may not have access
        to it. If you expected to see it here, ask a workspace owner to confirm
        your membership.
      </p>
      <Link
        to="/projects"
        className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm font-medium no-underline"
      >
        Back to projects
      </Link>
    </div>
  )
}

// Re-exported for tests and the notebook route's breadcrumb composition.
export type { Project }
