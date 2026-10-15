import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'

import { ProjectsPage } from '#/components/v3/projects/projects-page'
import type {
  ProjectsSearch,
  ProjectRow,
} from '#/components/v3/projects/projects-page'
import { createDataClient, DataClientError } from '#/lib/data-client'
import { toast } from '#/components/v3/ui/sonner'
import {
  createProject,
  fetchWorkspaceMemberIdentities,
  withReadDeadline,
  workspaceMemberQueryKeys,
} from '#/components/v3/projects/project-data'
import { hasCapability } from '#/lib/capability'

/** UI port (roadmap-4/ui-app3): the Projects list from sheetbase-app-3, wired
 * to the real `project_list_summary` / `create_project` RPCs. The old ELN list
 * and its shell header are gone; this route renders inside app-3's shell. */

interface ProjectSummaryWire {
  id: string
  key: string
  title: string
  status: string
  display_id?: string | null
  client_code?: string | null
  client_name?: string | null
  stage?: string | null
  modality?: string | null
  lead_user_id?: string | null
  lead_name?: string | null
  started_on?: string | null
  revision: string
  archived_at: string | null
  updated_at: string
  experiment_count?: number
}

interface ClientWire {
  id: string
  code: string
  name: string
}

const dataClient = createDataClient()
const PROJECTS_KEY = ['projects'] as const

function statusOf(status: string): ProjectRow['status'] {
  switch (status) {
    case 'in_progress':
      return { tone: 'progress', label: 'In progress' }
    case 'in_review':
      return { tone: 'review', label: 'In review' }
    case 'complete':
      return { tone: 'ok', label: 'Complete' }
    case 'on_hold':
      return { tone: 'warn', label: 'On hold' }
    case 'archived':
      return { tone: 'draft', label: 'Archived' }
    default:
      return { tone: 'progress', label: 'Active' }
  }
}

export function toProjectRow(row: ProjectSummaryWire): ProjectRow {
  return {
    uuid: row.id,
    id: row.display_id ?? row.key,
    name: row.title,
    client: row.client_code ?? 'Internal',
    modality: row.modality ?? '—',
    stage: row.stage ?? '—',
    lead: row.lead_name ?? '—',
    leadUserId: row.lead_user_id ?? null,
    started: row.started_on ?? undefined,
    revision: row.revision,
    experiments: Number(row.experiment_count ?? 0),
    status: statusOf(row.status),
    archived: row.archived_at != null,
    updated: Date.parse(row.updated_at) || 0,
  }
}

export const Route = createFileRoute('/projects')({
  validateSearch: (search: Record<string, unknown>): ProjectsSearch => {
    const tab = search.tab
    return {
      tab:
        tab === 'mine' ||
        tab === 'inprogress' ||
        tab === 'inreview' ||
        tab === 'archived' ||
        tab === 'all'
          ? tab
          : undefined,
      q: typeof search.q === 'string' ? search.q : undefined,
      archived:
        search.archived === 'include' || search.archived === 'exclude'
          ? search.archived
          : undefined,
      stage: typeof search.stage === 'string' ? search.stage : undefined,
      client: typeof search.client === 'string' ? search.client : undefined,
      modality:
        typeof search.modality === 'string' ? search.modality : undefined,
      fields: typeof search.fields === 'string' ? search.fields : undefined,
      sort:
        search.sort === 'id' ||
        search.sort === 'name' ||
        search.sort === 'updated'
          ? search.sort
          : undefined,
      group:
        search.group === 'stage' ||
        search.group === 'lead' ||
        search.group === 'none'
          ? search.group
          : undefined,
      new: search.new === true || search.new === 'true' || undefined,
    }
  },
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ProjectsRoute,
})

function ProjectsRoute() {
  const isIndex = useRouterState({
    select: (state) => state.location.pathname === '/projects',
  })
  return isIndex ? <ProjectsIndexRoute /> : <Outlet />
}

function ProjectsIndexRoute() {
  const { context } = Route.useRouteContext()
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: [...PROJECTS_KEY, context.workspace?.id],
    // A stalled data layer used to leave this page on "Loading projects…"
    // forever and the header asserting a count of 0. One silent retry covers a
    // blip; the deadline turns an unanswered read into a stated failure the
    // page can offer a retry for.
    retry: 1,
    queryFn: () =>
      withReadDeadline(
        (async () => {
          const rows: ProjectSummaryWire[] = []
          for (;;) {
            const page = await dataClient.list<ProjectSummaryWire>(
              'rpc/project_list_summary',
              `?order=updated_at.desc,id.asc&limit=200&offset=${rows.length}`,
            )
            rows.push(...page)
            if (page.length < 200) break
          }
          return rows
        })(),
        'The project list',
      ),
  })

  const clientsQuery = useQuery({
    queryKey: ['clients', context.workspace?.id],
    queryFn: () =>
      dataClient.list<ClientWire>(
        'clients',
        '?select=id,code,name&order=code.asc',
      ),
  })

  const create = useMutation({
    mutationFn: createProject,
    // The dialog closes and the row appears, but nothing said the write landed.
    // Same feedback the bulk archive/restore already gives.
    onSuccess: (_created, input) => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
      toast(`Project “${input.title}” created`)
      void navigate({
        to: '/projects',
        search: (s) => ({ ...s, new: undefined }),
      })
    },
  })

  const members = useQuery({
    queryKey: [...workspaceMemberQueryKeys.identities, context.workspace?.id],
    queryFn: fetchWorkspaceMemberIdentities,
  })

  const projects = useMemo(
    () => (query.data ?? []).map(toProjectRow),
    [query.data],
  )
  const clientOptions = (clientsQuery.data ?? []).map((c) => ({
    id: c.id,
    label: `${c.code} · ${c.name}`,
  }))

  return (
    <ProjectsPage
      projects={projects}
      me={context.user.name}
      meId={context.user.id}
      canCreate={hasCapability(context.workspace?.role, 'record.create')}
      loading={query.isLoading}
      error={
        query.error
          ? query.error instanceof DataClientError
            ? query.error.message
            : 'Projects could not be loaded. Try again.'
          : null
      }
      onRetry={() => void query.refetch()}
      onOpenProject={(p) =>
        void navigate({
          to: '/projects/$projectId',
          params: { projectId: p.uuid },
        })
      }
      search={search}
      setSearch={(patch) =>
        void navigate({
          to: '/projects',
          search: (s) => ({ ...s, ...patch }),
          replace: true,
        })
      }
      onCreate={(input) => create.mutate(input)}
      creating={create.isPending}
      createdProjectId={create.data?.id ?? null}
      createError={
        create.error instanceof DataClientError
          ? create.error.message
          : create.error
            ? 'Could not create the project.'
            : null
      }
      clientOptions={clientOptions}
      memberOptions={(members.data ?? []).map((member) => ({
        id: member.user_id,
        label: member.name,
      }))}
    />
  )
}
