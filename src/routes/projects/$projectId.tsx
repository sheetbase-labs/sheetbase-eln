import { formatDate } from '#/lib/format-date'
import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { PageHeader } from '#/components/ui/layout'
import { Button } from '#/components/ui/button'
import { NotFoundNotice } from '#/components/ui/not-found-notice'
import { ProjectListFailure } from '#/components/projects/project-list'
import { Tabs } from '#/components/ui/tabs'
import { Status } from '#/components/ui/status'
import {
  useProjectMilestones,
  useProjectSummary,
} from '#/components/projects/project-data'
import {
  useProjectDatasetCount,
  useProjectRecordCount,
} from '#/components/projects/project-lists'
import { resolveIdentifierParam } from '#/lib/identifier-resolution'
import { FavouriteToggle } from '#/components/favourites/favourite-toggle'
import { FollowToggle } from '#/components/follow/follow-toggle'
import { useRecentViewTracking } from '#/lib/recents'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'
import { useHasCapability } from '#/lib/use-capability'

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
  const canWrite = useHasCapability('record.create')
  const { projectId } = Route.useParams()
  const { project, query } = useProjectSummary(projectId)
  useRecentViewTracking('project', query.isSuccess ? project?.id : null)
  // Header counts share the tabs' queries (same predicate builders), so a tab's
  // count and its list total always agree. The Experiments count is the
  // canonical `project_list_summary.experiment_count` for the same predicate.
  const samplesCount = useProjectRecordCount(project?.id ?? '', 'sample')
  const datasetsCount = useProjectDatasetCount(project?.id ?? '')
  const milestonesQuery = useProjectMilestones(project?.id ?? '')
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
            {/* An archived project never shows in the sidebar, so it is not offered. */}
            <FavouriteToggle
              kind="project"
              objectId={project.archivedAt ? null : project.id}
            />
            <FollowToggle
              kind="project"
              objectId={project.archivedAt ? null : project.id}
            />
            {project.archivedAt || !canWrite ? null : (
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
                label: t('projects.projectShell.tabs.files'),
                link: {
                  to: '/projects/$projectId/files',
                  params,
                  search: {},
                },
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
