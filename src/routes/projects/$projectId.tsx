import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { PageHeader } from '#/components/v3/ui/layout'
import { Button } from '#/components/v3/ui/button'
import { NotFoundNotice } from '#/components/v3/ui/not-found-notice'
import { ProjectListFailure } from '#/components/v3/projects/project-list'
import { Tabs } from '#/components/v3/ui/tabs'
import { Status } from '#/components/v3/ui/status'
import {
  fetchProjectFolders,
  fetchProjectMembers,
  useProjectMilestones,
  useProjectSummary,
} from '#/components/v3/projects/project-data'
import {
  useProjectDatasetCount,
  useProjectRecordCount,
} from '#/components/v3/projects/project-lists'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { useRecentViewTracking } from '#/lib/recents'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** UI port (roadmap-4/ui-app3): the project detail frame. Overview and
 * Settings are ported; Folders and Members tabs land with theirs. */
export const Route = createFileRoute('/projects/$projectId')({
  beforeLoad: async ({ context: rootContext, params, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    await resolveIdentifierParam({
      entity: 'project',
      ref: params.projectId,
      href: location.href,
    })
    return { context }
  },
  component: ProjectLayout,
})

const metaItemClass = ''

function ProjectLayout() {
  const { projectId } = Route.useParams()
  const { project, query } = useProjectSummary(projectId)
  useRecentViewTracking('project', query.isSuccess ? project?.id : null)
  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => fetchProjectMembers(projectId),
    enabled: Boolean(project),
  })
  // Header counts share the tabs' queries (same predicate builders), so a tab's
  // count and its list total always agree. The Experiments count is the
  // canonical `project_list_summary.experiment_count` for the same predicate.
  const samplesCount = useProjectRecordCount(project?.id ?? '', 'sample')
  const datasetsCount = useProjectDatasetCount(project?.id ?? '')
  const milestonesQuery = useProjectMilestones(project?.id ?? '')
  // Same key the Folders tab uses, so the count and that tab's list share one read.
  const foldersQuery = useQuery({
    queryKey: ['project-folders', project?.id ?? ''],
    queryFn: () => fetchProjectFolders(project?.id ?? ''),
    enabled: Boolean(project),
  })

  if (!project) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[{ label: 'Projects', link: { to: '/projects' } }]}
          title={
            query.isLoading
              ? 'Loading project…'
              : query.isError
                ? 'Project could not be loaded'
                : 'Project not found'
          }
        />
        <div className="px-4 py-4 md:px-6">
          {query.isError ? (
            <ProjectListFailure
              error={query.error}
              what="this project"
              onRetry={() => void query.refetch()}
            />
          ) : query.isLoading ? null : (
            <NotFoundNotice
              what="project"
              action={
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link to="/projects" />}
                >
                  Back to Projects
                </Button>
              }
            />
          )}
        </div>
      </div>
    )
  }

  const params = { projectId: project.id }
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        trail={[
          { label: 'Projects', link: { to: '/projects' } },
          { label: project.displayId ?? project.key, mono: true },
        ]}
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
        actions={
          <>
            {project.archivedAt ? null : (
              <Button
                variant="primary"
                nativeButton={false}
                render={
                  <Link
                    to="/experiments/new"
                    search={{ project: project.id }}
                  />
                }
              >
                New experiment
              </Button>
            )}
          </>
        }
        tabs={
          <Tabs
            mode="url"
            label="Project sections"
            items={[
              {
                label: 'Overview',
                link: {
                  to: '/projects/$projectId',
                  params,
                  activeOptions: { exact: true },
                },
              },
              {
                label: 'Milestones',
                count: milestonesQuery.data?.length ?? '—',
                link: { to: '/projects/$projectId/milestones', params },
              },
              {
                label: 'Experiments',
                count: project.experimentCount,
                link: { to: '/projects/$projectId/experiments', params },
              },
              {
                label: 'Samples',
                count: samplesCount.data ?? '—',
                link: { to: '/projects/$projectId/samples', params },
              },
              {
                label: 'Datasets',
                count: datasetsCount.data ?? '—',
                link: { to: '/projects/$projectId/datasets', params },
              },
              {
                label: 'Folders',
                count: foldersQuery.data?.length ?? '—',
                link: { to: '/projects/$projectId/folders', params },
              },
              {
                label: 'Files',
                count: '—',
                link: { to: '/projects/$projectId/files', params },
              },
              {
                label: 'Members',
                count: membersQuery.data?.length ?? '—',
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
