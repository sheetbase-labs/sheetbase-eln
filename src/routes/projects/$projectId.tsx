import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { PageHeader } from '#/components/v3/ui/layout'
import { LinkTabs } from '#/components/v3/projects/search-tabs'
import { Status } from '#/components/v3/ui/status'
import {
  fetchProjectMembers,
  useProjectSummary,
} from '#/components/v3/projects/project-data'

/** UI port (roadmap-4/ui-app3): the project detail frame. Overview and
 * Settings are ported; Folders and Members tabs land with theirs. */
export const Route = createFileRoute('/projects/$projectId')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: ProjectLayout,
})

const metaItemClass = ''

function ProjectLayout() {
  const { projectId } = Route.useParams()
  const { project, query } = useProjectSummary(projectId)
  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => fetchProjectMembers(projectId),
    enabled: Boolean(project),
  })

  if (!project) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          crumbs={
            <Link to="/projects" className="text-link">
              Projects
            </Link>
          }
          title={query.isLoading ? 'Loading project…' : 'Project not found'}
        />
      </div>
    )
  }

  const params = { projectId: project.id }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        crumbs={
          <>
            <Link to="/projects" className="text-link">
              Projects
            </Link>{' '}
            / <span className="mono">{project.displayId ?? project.key}</span>
          </>
        }
        title={project.title}
        meta={
          <>
            <span className="text-fg">
              <Status tone={statusTone(project.status)}>
                {statusLabel(project.status)}
              </Status>
            </span>
            <span className={metaItemClass}>
              {project.clientCode ? `Client ${project.clientCode}` : 'Internal'}
            </span>
            {project.modality ? <span>{project.modality}</span> : null}
            {project.stage ? <span>{project.stage}</span> : null}
            {project.leadName ? <span>Lead {project.leadName}</span> : null}
            {project.startedOn ? (
              <span>Started {project.startedOn}</span>
            ) : null}
          </>
        }
        tabs={
          <LinkTabs
            tabs={[
              {
                label: 'Overview',
                link: {
                  to: '/projects/$projectId',
                  params,
                  activeOptions: { exact: true },
                },
              },
              {
                label: 'Folders',
                link: { to: '/projects/$projectId/folders', params },
              },
              {
                label: 'Members',
                count: membersQuery.data?.length,
                link: { to: '/projects/$projectId/members', params },
              },
              {
                label: 'Settings',
                link: { to: '/projects/$projectId/settings', params },
              },
            ]}
          />
        }
      />
      <div className="flex min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}

export function statusTone(status: string) {
  switch (status) {
    case 'in_review':
      return 'review' as const
    case 'complete':
      return 'ok' as const
    case 'on_hold':
      return 'warn' as const
    case 'archived':
      return 'draft' as const
    default:
      return 'progress' as const
  }
}

export function statusLabel(status: string) {
  switch (status) {
    case 'in_progress':
      return 'In progress'
    case 'in_review':
      return 'In review'
    case 'complete':
      return 'Complete'
    case 'on_hold':
      return 'On hold'
    case 'archived':
      return 'Archived'
    default:
      return 'Active'
  }
}
