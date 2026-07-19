import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { FlaskConical, Folder } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import { StatusBadge } from '#/components/scientific'
import {
  fetchProject,
  fetchRecordsForProject,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import type { NotebookRecord, Project } from '#/lib/notebook-data'
import { DataClientError } from '#/lib/data-client'

/**
 * ELN-004: the deep-linkable project route. Loads the project and its
 * notebook-backed records (experiments, protocol templates, reports) and
 * lists them with deep links into the experiment notebook route. Loading,
 * missing-project, archived, empty and error states are all handled.
 */

const getProjectContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext } = await import('#/lib/current-user')
    return getCurrentContext(getRequestHeaders())
  },
)

export const Route = createFileRoute('/projects/$projectId')({
  beforeLoad: async () => {
    const context = await getProjectContext()
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ProjectRoute,
})

function ProjectRoute() {
  const { context } = Route.useRouteContext()
  const { projectId } = Route.useParams()

  const projectQuery = useQuery({
    queryKey: notebookQueryKeys.project(projectId),
    queryFn: () => fetchProject(notebookDataClient, projectId),
  })
  const recordsQuery = useQuery({
    queryKey: notebookQueryKeys.records(projectId),
    queryFn: () => fetchRecordsForProject(notebookDataClient, projectId),
  })

  const project = projectQuery.data ?? null
  const records = recordsQuery.data ?? []

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
        <p className="text-sm text-muted-foreground" aria-busy="true">
          Loading project…
        </p>
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
      <div className="max-w-4xl space-y-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-[0.14em]">
              Project
            </span>
            <span className="font-mono tabular-nums">{project.key}</span>
            {isArchived ? (
              <StatusBadge domain="dataset" status="deprecated" />
            ) : null}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {project.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {records.length === 0
              ? 'No notebook records yet.'
              : `${records.length} record${records.length === 1 ? '' : 's'}`}
          </p>
        </header>

        <RecordListSection
          projectId={project.id}
          records={records}
          isLoading={recordsQuery.isLoading}
          error={recordsQuery.error}
          onRetry={() => recordsQuery.refetch()}
        />
      </div>
    </AppShell>
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
    <div className="space-y-2">
      <p role="alert" className="text-sm text-destructive">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm font-medium"
      >
        Try again
      </button>
    </div>
  )
}

export function ProjectUnavailableState() {
  return (
    <div className="max-w-md space-y-2 rounded-md border border-border bg-muted/30 p-6">
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
  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        Loading records…
      </p>
    )
  }
  if (error) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          Could not load records.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm font-medium"
        >
          Try again
        </button>
      </div>
    )
  }
  if (records.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-6 text-center">
        <p className="text-sm font-medium text-foreground">
          No notebook records yet
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Experiments, protocol templates and reports created in this project
          will appear here. The first notebook comes with a useful starting
          canvas — not a blank page.
        </p>
      </div>
    )
  }
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {records.map((record) => (
        <li key={record.id}>
          <Link
            to="/projects/$projectId/experiments/$recordId"
            params={{ projectId, recordId: record.id }}
            className="flex items-center gap-3 p-3 no-underline transition-colors hover:bg-muted/40"
          >
            <RecordKindIcon kind={record.kind} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {record.title}
              </p>
              <p className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                {record.identifier}
              </p>
            </div>
            <StatusBadge domain="experiment" status={record.status} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

function RecordKindIcon({ kind }: { kind: string }) {
  const Icon = kind === 'protocol_template' ? Folder : FlaskConical
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
      <Icon className="size-4" />
    </span>
  )
}

// Re-exported for tests and the notebook route's breadcrumb composition.
export type { Project }
