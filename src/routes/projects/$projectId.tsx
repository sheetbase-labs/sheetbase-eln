import { formatDate } from '#/lib/format-date'
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
import { projectSheetsKey } from '#/components/v3/projects/project-sheets'
import { fetchProjectSheets } from '#/lib/sheet-instance-data'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { useRecentViewTracking } from '#/lib/recents'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'

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

  // Same key the Sheets tab reads, so the count and the list share one fetch.
  const sheetsQuery = useQuery({
    queryKey: projectSheetsKey(project?.id ?? '', false),
    queryFn: () => fetchProjectSheets(project?.id ?? ''),
    enabled: Boolean(project),
  })

  if (!project) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          trail={[
            {
              label: t('projects.projectShell.projects'),
              link: { to: '/projects' },
            },
          ]}
          title={
            query.isLoading
              ? t('projects.projectShell.loading')
              : query.isError
                ? t('projects.projectShell.loadFailed')
                : t('projects.projectShell.notFound')
          }
        />
        <div className="px-4 py-4 md:px-6">
          {query.isError ? (
            <ProjectListFailure
              error={query.error}
              what={t('projects.projectShell.thisProject')}
              onRetry={() => void query.refetch()}
            />
          ) : query.isLoading ? null : (
            <NotFoundNotice
              what={t('projects.projectShell.project')}
              action={
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link to="/projects" />}
                >
                  {t('projects.projectShell.backToProjects')}
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
          {
            label: t('projects.projectShell.projects'),
            link: { to: '/projects' },
          },
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
              {project.clientCode
                ? t('projects.projectShell.client', {
                    code: project.clientCode,
                  })
                : t('projects.projectShell.internal')}
            </span>
            {project.modality ? <span>{project.modality}</span> : null}
            {project.stage ? <span>{project.stage}</span> : null}
            {project.leadName ? (
              <span>
                {t('projects.projectShell.lead', { name: project.leadName })}
              </span>
            ) : null}
            {project.startedOn ? (
              <span>
                {t('projects.projectShell.started', {
                  date: formatDate(project.startedOn),
                })}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            <FavouriteToggle kind="project" objectId={project.id} />
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
                {t('projects.projectShell.newExperiment')}
              </Button>
            )}
          </>
        }
        tabs={
          <Tabs
            mode="url"
            label={t('projects.projectShell.sections')}
            items={[
              {
                label: t('projects.projectShell.tabs.overview'),
                link: {
                  to: '/projects/$projectId',
                  params,
                  activeOptions: { exact: true },
                },
              },
              {
                label: t('projects.projectShell.tabs.milestones'),
                count:
                  milestonesQuery.data?.filter((m) => m.kind === 'milestone')
                    .length ?? '—',
                link: { to: '/projects/$projectId/milestones', params },
              },
              {
                label: t('projects.projectShell.tabs.experiments'),
                count: project.experimentCount,
                link: { to: '/projects/$projectId/experiments', params },
              },
              {
                label: t('projects.projectShell.tabs.samples'),
                count: samplesCount.data ?? '—',
                link: { to: '/projects/$projectId/samples', params },
              },
              {
                label: t('projects.projectShell.tabs.datasets'),
                count: datasetsCount.data ?? '—',
                link: { to: '/projects/$projectId/datasets', params },
              },
              {
                label: t('projects.projectShell.tabs.sheets'),
                count: sheetsQuery.data?.length ?? '—',
                link: { to: '/projects/$projectId/sheets', params },
              },
              {
                label: t('projects.projectShell.tabs.folders'),
                count: foldersQuery.data?.length ?? '—',
                link: { to: '/projects/$projectId/folders', params },
              },
              {
                label: t('projects.projectShell.tabs.files'),
                count: '—',
                link: { to: '/projects/$projectId/files', params },
              },
              {
                label: t('projects.projectShell.tabs.members'),
                count: membersQuery.data?.length ?? '—',
                link: { to: '/projects/$projectId/members', params },
              },
              {
                label: t('projects.projectShell.tabs.settings'),
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
      return t('projects.projectsRoute.status.inProgress')
    case 'in_review':
      return t('projects.projectsRoute.status.inReview')
    case 'complete':
      return t('projects.projectsRoute.status.complete')
    case 'on_hold':
      return t('projects.projectsRoute.status.onHold')
    case 'archived':
      return t('projects.projectsRoute.status.archived')
    default:
      return t('projects.projectsRoute.status.active')
  }
}
