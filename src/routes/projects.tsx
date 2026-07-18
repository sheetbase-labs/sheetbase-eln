import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'

import { createDataClient, DataClientError } from '#/lib/data-client'

/**
 * API-004: the first authenticated project vertical slice. Reads projects
 * through the same-origin /api/db boundary using TanStack Query, and creates
 * projects through the create_project RPC (server-side key generation).
 * Loading, empty, error, validation and permission states are all handled.
 */

// Wire shape from PostgREST (snake_case). Mapped at the call site.
interface ProjectWire {
  id: string
  workspace_id: string
  key: string
  title: string
  status: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

interface Project {
  id: string
  key: string
  title: string
  status: string
  createdAt: string
}

function toProject(row: ProjectWire): Project {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
  }
}

// Route guard: redirect unauthenticated users to sign-in. Reuses the
// existing getCurrentContext pattern so the guard is consistent with /.
const getProjectContext = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { getRequestHeaders } = await import('@tanstack/react-start/server')
    const { getCurrentContext } = await import('#/lib/current-user')
    return getCurrentContext(getRequestHeaders())
  },
)

export const Route = createFileRoute('/projects')({
  beforeLoad: async () => {
    const context = await getProjectContext()
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ProjectsRoute,
})

const dataClient = createDataClient()

const PROJECTS_KEY = ['projects'] as const

function ProjectsRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: async () => {
      const rows = await dataClient.list<ProjectWire>(
        'projects',
        '?order=created_at.desc',
      )
      return rows.map(toProject)
    },
  })

  const [title, setTitle] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: async (newTitle: string) => {
      // Server-side key generation; the RPC returns the created row.
      const row = await dataClient.rpc<ProjectWire>('create_project', {
        p_title: newTitle,
      })
      return toProject(row)
    },
    onMutate: async (newTitle) => {
      // No optimistic add: the server assigns the key, so we cannot
      // fabricate a correct local row. Rollback on error is trivial (no
      // change was made), and the canonical row arrives on success.
      void newTitle
      await queryClient.cancelQueries({ queryKey: PROJECTS_KEY })
    },
    onSuccess: (created) => {
      queryClient.setQueryData<Project[]>(PROJECTS_KEY, (prev) =>
        prev ? [created, ...prev] : [created],
      )
      setTitle('')
      setValidationError(null)
    },
    onError: (error) => {
      if (error instanceof DataClientError) {
        // Map known proxy/upstream error codes to actionable messages.
        if (error.code === 'unauthenticated') {
          setValidationError('Your session expired. Sign in again.')
        } else if (error.code === 'no_workspace') {
          setValidationError('Your workspace is not set up yet.')
        } else if (error.code === 'workspace_mismatch') {
          setValidationError('The request targeted the wrong workspace.')
        } else if (error.status >= 500) {
          setValidationError(
            'The data service is unavailable. Try again shortly.',
          )
        } else {
          setValidationError(error.message)
        }
      } else {
        setValidationError('Could not create the project. Try again.')
      }
    },
  })

  const projects = query.data ?? []
  const isLoading = query.isLoading
  const isPendingCreate = createMutation.isPending

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      setValidationError('Give the project a title first.')
      return
    }
    createMutation.mutate(trimmed)
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <header className="space-y-1">
        <p className="text-sm font-medium text-muted-foreground">
          {context.workspace?.name ?? 'Sheetbase'}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
      </header>

      <CreateProjectForm
        title={title}
        onTitleChange={setTitle}
        onSubmit={handleSubmit}
        isPending={isPendingCreate}
        validationError={validationError}
      />

      <ProjectList
        projects={projects}
        isLoading={isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
      />
    </main>
  )
}

export function CreateProjectForm({
  title,
  onTitleChange,
  onSubmit,
  isPending,
  validationError,
}: {
  title: string
  onTitleChange: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  isPending: boolean
  validationError: string | null
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-2" noValidate>
      <label htmlFor="project-title" className="sr-only">
        Project title
      </label>
      <input
        id="project-title"
        type="text"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="New project title"
        aria-invalid={validationError ? true : undefined}
        aria-describedby={validationError ? 'project-title-error' : undefined}
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        disabled={isPending}
      />
      {validationError ? (
        <p
          id="project-title-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {validationError}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isPending || title.trim() === ''}
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {isPending ? 'Creating…' : 'Create project'}
      </button>
    </form>
  )
}

export function ProjectList({
  projects,
  isLoading,
  error,
  onRetry,
}: {
  projects: Project[]
  isLoading: boolean
  error: unknown
  onRetry: () => void
}) {
  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground" aria-busy="true">
        Loading projects…
      </p>
    )
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          Could not load projects.
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

  if (projects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No projects yet. Create your first one above.
      </p>
    )
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {projects.map((project) => (
        <li key={project.id} className="flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{project.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {project.key}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {new Date(project.createdAt).toLocaleDateString()}
          </span>
        </li>
      ))}
    </ul>
  )
}
