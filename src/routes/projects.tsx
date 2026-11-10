import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { z } from 'zod'

import { ProjectsPage } from '#/components/projects/projects-page'
import type {
  NewProjectInput,
  ProjectsSearch,
  ProjectRow,
} from '#/components/projects/projects-page'
import { createClientOrganisation } from '#/lib/client-sharing'
import { createDataClient, DataClientError } from '#/lib/data-client'
import { toast } from '#/components/ui/sonner'
import {
  createProject,
  fetchWorkspaceMemberIdentities,
  withReadDeadline,
  workspaceMemberQueryKeys,
} from '#/components/projects/project-data'
import { hasCapability } from '#/lib/capability'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { requireBuiltInModel } from '#/lib/built-in-models'
import { saveNewObjectFields } from '#/lib/model-subtypes'
import { t } from '#/copy'

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
      return {
        tone: 'progress',
        label: t('projects.projectsRoute.status.inProgress'),
      }
    case 'in_review':
      return {
        tone: 'review',
        label: t('projects.projectsRoute.status.inReview'),
      }
    case 'complete':
      return { tone: 'ok', label: t('projects.projectsRoute.status.complete') }
    case 'on_hold':
      return { tone: 'warn', label: t('projects.projectsRoute.status.onHold') }
    case 'archived':
      return {
        tone: 'draft',
        label: t('projects.projectsRoute.status.archived'),
      }
    default:
      return {
        tone: 'progress',
        label: t('projects.projectsRoute.status.active'),
      }
  }
}

// react-doctor-disable-next-line react-doctor/only-export-components -- The wire-to-row mapping is exported so its own test covers the field mapping without rendering the route.
export function toProjectRow(row: ProjectSummaryWire): ProjectRow {
  return {
    uuid: row.id,
    id: row.display_id ?? row.key,
    name: row.title,
    client: row.client_code ?? t('projects.projectsRoute.internal'),
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

const PROJECT_MODEL = requireBuiltInModel('project')

/** The create intent the address bar may carry as `?new`. */
const createIntent = z.object({ new: z.unknown() })

/** One free-text filter value; anything else in the address bar is dropped. */
const filterText = z.string().optional().catch(undefined)

/**
 * The list's addressable state. A value the address bar carries that is not
 * one of the named alternatives reads as absent, as it always has.
 */
const projectsSearchSchema = z.object({
  tab: z
    .enum(['mine', 'inprogress', 'inreview', 'archived', 'all'])
    .optional()
    .catch(undefined),
  q: filterText,
  archived: z.enum(['include', 'exclude']).optional().catch(undefined),
  stage: filterText,
  client: filterText,
  modality: filterText,
  fields: filterText,
  sort: z.enum(['id', 'name', 'updated']).optional().catch(undefined),
  group: z.enum(['stage', 'lead', 'none']).optional().catch(undefined),
  new: z
    .union([z.literal(true), z.literal('true')])
    .transform(() => true as const)
    .optional()
    .catch(undefined),
})

export const Route = createFileRoute('/projects')({
  validateSearch: (search): ProjectsSearch =>
    projectsSearchSchema.parse(search),
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth

    if (!context) {
      throw redirect(signInRedirect(location))
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
  const matchSearch = Route.useSearch()

  // Coming back to /projects within the router's cache window renders this page
  // once with the *previous* visit's search ("?new=true", from the create that
  // just landed), before the URL's own empty search replaces it. The page opens
  // its New project dialog from that first render and never closes it again,
  // so only believe a create intent the address bar itself carries.
  const urlAsksForNew = useRouterState({
    select: (state) => {
      const intent = createIntent.safeParse(state.location.search)

      return intent.success && Boolean(intent.data.new)
    },
  })

  const search = urlAsksForNew
    ? matchSearch
    : { ...matchSearch, new: undefined }

  /** The filter controls hand their patch back here; nothing calls it on render. */
  const onSearchChange = (patch: Partial<ProjectsSearch>) => {
    // react-doctor-disable-next-line react-doctor/tanstack-start-no-navigate-in-render -- Only the list's filter controls call this, from their change handlers.
    void navigate({
      to: '/projects',
      search: (s) => ({ ...s, ...patch }),
      replace: true,
    })
  }

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
        t('projects.projectsRoute.projectList'),
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

  const workspaceId = context.workspace?.id

  const create = useMutation({
    // A project for a client that does not exist yet creates the client first,
    // so a workspace's first client project can be set up from this dialog.
    mutationFn: async (input: NewProjectInput) => {
      const { newClientName, customFields, typeKey, ...details } = input
      let clientId = details.clientId

      if (newClientName) {
        const client = await createClientOrganisation(dataClient, {
          workspaceId: workspaceId ?? '',
          name: newClientName,
        })

        void queryClient.invalidateQueries({
          queryKey: ['clients', workspaceId],
        })
        clientId = client.id
      }

      const created = await createProject({ ...details, clientId })
      await saveNewObjectFields(
        dataClient,
        PROJECT_MODEL,
        created.id,
        typeKey ?? null,
        customFields ?? {},
      )

      return created
    },
    // The dialog closes and the row appears, but nothing said the write landed.
    // Same feedback the bulk archive/restore already gives.
    onSuccess: (_created, input) => {
      void queryClient.invalidateQueries({ queryKey: PROJECTS_KEY })
      toast(t('projects.projectsRoute.created', { title: input.title }))
    },
  })

  // Land on the new project, not back on the list it was created from. This is
  // an effect on the created project rather than a navigate in `onSuccess`:
  // the router keeps this page on screen while the project loads, and
  // navigating before the success state has rendered froze it with the New
  // project dialog still open, which a quick click on Projects then revealed.
  const createdId = create.data?.id
  useEffect(() => {
    if (createdId)
      void navigate({
        to: '/projects/$projectId',
        params: { projectId: createdId },
      })
  }, [createdId, navigate])

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
      loading={query.isPending}
      error={
        query.error
          ? query.error instanceof DataClientError
            ? query.error.message
            : t('projects.projectsRoute.loadFailed')
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
      setSearch={onSearchChange}
      onCreate={(input) => create.mutate(input)}
      creating={create.isPending}
      createdProjectId={create.data?.id ?? null}
      createError={
        create.error instanceof DataClientError
          ? create.error.message
          : create.error
            ? t('projects.projectsRoute.createFailed')
            : null
      }
      clientOptions={clientOptions}
      canCreateClient={
        context.workspace?.role === 'owner' ||
        context.workspace?.role === 'admin'
      }
      memberOptions={(members.data ?? []).map((member) => ({
        id: member.user_id,
        label: member.name,
      }))}
    />
  )
}
