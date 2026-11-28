import {
  RecordBodySkeleton,
  TitleSkeleton,
} from '#/components/ui/page-skeleton'
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useMatchRoute,
} from '@tanstack/react-router'

import { PageHeader } from '#/components/ui/layout'
import { Button } from '#/components/ui/button'
import { NotFoundNotice } from '#/components/ui/not-found-notice'
import { ProjectListFailure } from '#/components/projects/project-list'
import type { TabsProps } from '#/components/ui/tabs'
import { RecordPage } from '#/components/record-page/record-page'
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
import { useRecentViewTracking } from '#/lib/recents'
import { signInRedirect } from '#/lib/sign-in-redirect'
import { t } from '#/copy'
import { useHasCapability } from '#/lib/use-capability'
import { statusLabel, statusTone } from './-project-status'
import { projectFacts } from './-project-facts'
import { ProjectSidePanel } from './-project-side'

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

function ProjectLayout() {
  const canWrite = useHasCapability('record.create')
  const { projectId } = Route.useParams()
  const { project, query } = useProjectSummary(projectId)
  const matchRoute = useMatchRoute()

  useRecentViewTracking('project', query.isSuccess ? project?.id : null)

  // Header counts share the tabs' queries (same predicate builders), so a tab's
  // count and its list total always agree. The Experiments count is the
  // canonical `project_list_summary.experiment_count` for the same predicate.
  const id = project?.id ?? ''
  const samplesCount = useProjectRecordCount(id, 'sample')
  const datasetsCount = useProjectDatasetCount(id)
  const milestonesQuery = useProjectMilestones(id)

  if (!project) return <ProjectUnavailable query={query} />

  const params = { projectId: project.id }
  // An archived project never shows in the sidebar or a follow list.
  const live = !project.archivedAt
  const onOverview = Boolean(matchRoute({ to: '/projects/$projectId', params }))

  return (
    <RecordPage
      recordId={live ? project.id : null}
      followKind="project"
      trail={[
        {
          label: t('projects.projectShell.projects'),
          link: { to: '/projects' },
        },
        { label: project.displayId ?? project.key, mono: true },
      ]}
      title={project.title}
      identifier={project.displayId ?? project.key}
      status={{
        tone: statusTone(project.status),
        label: statusLabel(project.status),
      }}
      facts={projectFacts(project)}
      actions={
        <ProjectActions
          projectId={project.id}
          live={live}
          canWrite={canWrite}
        />
      }
      tabs={projectTabs({
        params,
        milestones: milestoneCount(milestonesQuery.data),
        experiments: project.experimentCount,
        samples: samplesCount.data ?? '—',
        datasets: datasetsCount.data ?? '—',
      })}
      sideLabel={t('projects.projectOverview.inspector')}
      side={onOverview ? <ProjectSidePanel project={project} /> : null}
      fill
    >
      <Outlet />
    </RecordPage>
  )
}

/** Favourite, and New experiment for a live project someone can add to. */
function ProjectActions({
  projectId,
  live,
  canWrite,
}: {
  projectId: string
  live: boolean
  canWrite: boolean
}) {
  return (
    <>
      <FavouriteToggle kind="project" objectId={live ? projectId : null} />
      {live && canWrite ? (
        <Button
          variant="primary"
          nativeButton={false}
          render={
            <Link to="/experiments/new" search={{ project: projectId }} />
          }
        >
          {t('projects.projectShell.newExperiment')}
        </Button>
      ) : null}
    </>
  )
}

/** How many milestones the project has, once they have loaded. */
function milestoneCount(
  items: readonly { kind: string }[] | undefined,
): number | string {
  return items?.filter((m) => m.kind === 'milestone').length ?? '—'
}

/** The project's sections, Overview first and Settings at the far end. */
function projectTabs({
  params,
  milestones,
  experiments,
  samples,
  datasets,
}: {
  params: { projectId: string }
  milestones: number | string
  experiments: number
  samples: number | string
  datasets: number | string
}): TabsProps {
  return {
    mode: 'url',
    label: t('projects.projectShell.sections'),
    items: [
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
        count: milestones,
        link: { to: '/projects/$projectId/milestones', params },
      },
      {
        label: t('projects.projectShell.tabs.experiments'),
        count: experiments,
        link: { to: '/projects/$projectId/experiments', params },
      },
      {
        label: t('projects.projectShell.tabs.samples'),
        count: samples,
        link: { to: '/projects/$projectId/samples', params },
      },
      {
        label: t('projects.projectShell.tabs.datasets'),
        count: datasets,
        link: { to: '/projects/$projectId/datasets', params },
      },
      {
        label: t('projects.projectShell.tabs.files'),
        link: { to: '/projects/$projectId/files', params, search: {} },
      },
      {
        label: t('projects.projectShell.tabs.settings'),
        link: { to: '/projects/$projectId/settings', params },
        end: true,
      },
    ],
  }
}

function ProjectUnavailable({
  query,
}: Pick<ReturnType<typeof useProjectSummary>, 'query'>) {
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
          query.isLoading ? (
            <TitleSkeleton label={t('projects.projectShell.loading')} />
          ) : query.isError ? (
            t('projects.projectShell.loadFailed')
          ) : (
            t('projects.projectShell.notFound')
          )
        }
      />
      <div className="px-4 py-4 md:px-6">
        {query.isError ? (
          <ProjectListFailure
            error={query.error}
            what={t('projects.projectShell.thisProject')}
            onRetry={() => void query.refetch()}
          />
        ) : query.isLoading ? (
          <RecordBodySkeleton />
        ) : (
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
