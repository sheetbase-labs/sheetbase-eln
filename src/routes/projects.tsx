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
        search.archived === true || search.archived === 'true' || undefined,
      stage: typeof search.stage === 'string' ? search.stage : undefined,
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
    queryFn: async () => {
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
    },
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
    mutationFn: async (input: {
      title: string
      clientId?: string
      stage?: string
    }) =>
      dataClient.rpc('create_project', {
        p_title: input.title,
        p_client_id: input.clientId ?? null,
        p_stage: input.stage ?? null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
      void navigate({
        to: '/projects',
        search: (s) => ({ ...s, new: undefined }),
      })
    },
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
      createError={
        create.error instanceof DataClientError
          ? create.error.message
          : create.error
            ? 'Could not create the project.'
            : null
      }
      clientOptions={clientOptions}
    />
  )
}
