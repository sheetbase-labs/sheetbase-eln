import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createFileRoute,
  Outlet,
  redirect,
  useRouterState,
  useNavigate,
} from '@tanstack/react-router'
import { FolderPlus } from 'lucide-react'
import { useState } from 'react'

import { useShell } from '#/components/app-shell'
import { ProjectList } from '#/components/projects/project-list'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  PageHeader,
} from '#/components/ui'
import { createDataClient, DataClientError } from '#/lib/data-client'
import { fetchMyPendingReviews } from '#/lib/dashboard-data'

/** Project registry backed by the caller-scoped summary RPC. Creation opens
 * the canonical project route so its empty state can guide the first experiment.
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
  record_count?: number
  experiment_count?: number
  last_activity_at?: string | null
}

interface Project {
  id: string
  key: string
  title: string
  status: string
  createdAt: string
  updatedAt: string | null
  recordCount?: number
  experimentCount?: number
  lastActivityAt?: string | null
}

function toProject(row: ProjectWire): Project {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recordCount:
      row.record_count === undefined ? undefined : Number(row.record_count),
    experimentCount:
      row.experiment_count === undefined
        ? undefined
        : Number(row.experiment_count),
    lastActivityAt: row.last_activity_at,
  }
}

export const Route = createFileRoute('/projects')({
  staticData: { shellFullBleed: true },
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
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
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/projects',
  })
  return isIndex ? <ProjectsIndexRoute /> : <Outlet />
}

function ProjectsIndexRoute() {
  const { context } = Route.useRouteContext()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const query = useQuery({
    queryKey: [...PROJECTS_KEY, context.workspace?.id],
    queryFn: async () => {
      const rows: ProjectWire[] = []
      // Explicit pages avoid silently truncating workspaces at PostgREST's cap.
      for (;;) {
        const page = await dataClient.list<ProjectWire>(
          'rpc/project_list_summary',
          `?order=created_at.desc,id.asc&limit=200&offset=${rows.length}`,
        )
        rows.push(...page)
        if (page.length < 200) break
      }
      return rows.map(toProject)
    },
  })

  const [title, setTitle] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

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
      void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
      void navigate({
        to: '/projects/$projectId',
        params: { projectId: created.id },
      })
      setTitle('')
      setValidationError(null)
      setCreateOpen(false)
    },
    onError: (error) => {
      if (error instanceof DataClientError) {
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

  // Pending reviews assigned to the current user, counted per project — feeds
  // the "N awaiting you" column and the header stat line.
  const myReviewsQuery = useQuery({
    queryKey: ['projects', 'my-pending-reviews', context.user.id],
    queryFn: () => fetchMyPendingReviews(dataClient, context.user.id),
  })
  const pendingReviews = myReviewsQuery.data ?? []
  const reviewsByProject = new Map<string, number>()
  for (const review of pendingReviews) {
    if (!review.projectId) continue
    reviewsByProject.set(
      review.projectId,
      (reviewsByProject.get(review.projectId) ?? 0) + 1,
    )
  }

  const activeCount = projects.filter((p) => p.status === 'active').length
  const archivedCount = projects.filter((p) => p.status === 'archived').length
  const headerMeta = isLoading
    ? 'Loading workspace projects…'
    : [
        `${projects.length} project${projects.length === 1 ? '' : 's'}`,
        `${activeCount} active`,
        pendingReviews.length > 0
          ? `${pendingReviews.length} awaiting review`
          : null,
        archivedCount > 0 ? `${archivedCount} archived` : null,
      ]
        .filter(Boolean)
        .join(' · ')

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      setValidationError('Give the project a title first.')
      return
    }
    createMutation.mutate(trimmed)
  }

  useShell({
    context: {
      workspace: context.workspace ? { name: context.workspace.name } : null,
      user: { name: context.user.name, email: context.user.email },
    },
    breadcrumbs: [{ label: 'Home', to: '/' }, { label: 'Projects' }],
    primaryAction: (
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!isPendingCreate) {
            setCreateOpen(open)
            setValidationError(null)
          }
        }}
      >
        <DialogTrigger asChild>
          <Button size="sm">
            <FolderPlus className="size-4" />
            New project
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Create a project in {context.workspace?.name ?? 'your workspace'},
              then add your first experiment. We’ll open the project when it’s
              ready.
            </DialogDescription>
          </DialogHeader>
          <CreateProjectForm
            title={title}
            onTitleChange={(value) => {
              setTitle(value)
              setValidationError(null)
            }}
            onSubmit={handleSubmit}
            isPending={isPendingCreate}
            validationError={validationError}
          />
        </DialogContent>
      </Dialog>
    ),
  })

  return (
    <>
      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        <PageHeader title="Projects" description={headerMeta} />

        <ProjectList
          projects={projects}
          isLoading={isLoading}
          error={query.error}
          onRetry={() => query.refetch()}
          recordCounts={Object.fromEntries(
            projects
              .filter((p) => p.recordCount !== undefined)
              .map((p) => [p.id, p.recordCount!]),
          )}
          reviewsByProject={reviewsByProject}
        />
      </div>
    </>
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
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <label htmlFor="project-title" className="block text-sm font-medium">
        Project title
      </label>
      <Input
        id="project-title"
        type="text"
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="e.g. Lentivector stability study"
        autoFocus
        aria-invalid={validationError ? true : undefined}
        aria-describedby={
          validationError
            ? 'project-title-hint project-title-error'
            : 'project-title-hint'
        }
        disabled={isPending}
      />
      <p id="project-title-hint" className="text-sm text-muted-foreground">
        Choose a name your team will recognise.
      </p>
      {validationError ? (
        <p
          id="project-title-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {validationError}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="submit"
          disabled={isPending || title.trim() === ''}
          className="w-full sm:w-auto"
        >
          {isPending ? 'Creating…' : 'Create project'}
        </Button>
      </DialogFooter>
    </form>
  )
}
