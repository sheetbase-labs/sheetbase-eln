import { useMemo } from 'react'
import { Person } from '#/components/ui/person'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { Section } from '#/components/ui/layout'
import { EmptyState } from '#/components/ui/empty-state'
import { Button } from '#/components/ui/button'
import { Status } from '#/components/ui/status'
import { TableBox } from '#/components/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/inventory/registry-grid'
import type { RegistryColumn } from '#/components/inventory/registry-grid'
import {
  useProjectMilestones,
  useProjectSummary,
} from '#/components/projects/project-data'
import { experimentStatus } from '#/components/experiments/experiments-data'
import {
  fetchRecordsForProject,
  formatDate,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { ObjectLink } from '#/components/ui/object-link'
import { useUserNames } from '#/lib/user-names'
import { now } from '#/lib/clock'
import { daysUntilDate } from '#/lib/calendar-days'
import { formatListDate } from '#/lib/list-date'
import { t } from '#/copy'
import { useHasCapability } from '#/lib/use-capability'

export const Route = createFileRoute('/projects/$projectId/')({
  component: ProjectOverview,
})

interface MilestoneTone {
  tone: 'draft' | 'progress' | 'ok' | 'bad' | 'none'
  label: string
}

function milestoneTone(status: string, dueAt: string | null): MilestoneTone {
  // A milestone past its date that is not delivered is overdue, whatever its
  // workflow status says.
  if (status !== 'delivered' && dueAt) {
    const days = daysUntilDate(dueAt, now())

    if (days !== null && days < 0)
      return { tone: 'bad', label: t('projects.projectOverview.overdue') }
  }

  switch (status) {
    case 'planned':
      return { tone: 'draft', label: t('projects.projectOverview.planned') }
    case 'in_progress':
      return {
        tone: 'progress',
        label: t('projects.projectOverview.inProgress'),
      }
    case 'delivered':
      return { tone: 'ok', label: t('projects.projectOverview.delivered') }
    case 'overdue':
      return { tone: 'bad', label: t('projects.projectOverview.overdue') }
    default:
      return {
        tone: 'none',
        label: status
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
      }
  }
}

function ProjectOverview() {
  const canWrite = useHasCapability('record.create')
  const { projectId } = Route.useParams()
  const { project } = useProjectSummary(projectId)
  const milestonesQuery = useProjectMilestones(projectId)

  const milestones = (milestonesQuery.data ?? []).filter(
    (m) => m.kind === 'milestone',
  )

  const recordsQuery = useQuery({
    queryKey: notebookQueryKeys.records(projectId),
    queryFn: () => fetchRecordsForProject(notebookDataClient, projectId),
  })

  const records = useMemo(() => recordsQuery.data ?? [], [recordsQuery.data])

  const experiments = useMemo(
    () =>
      records
        .filter((r) => r.kind === 'experiment')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5),
    [records],
  )

  const ownerIds = useMemo(
    () => experiments.map((e) => e.createdByUserId),
    [experiments],
  )

  const { userLabel } = useUserNames(ownerIds)

  if (!project) return null

  const experimentColumns: RegistryColumn<(typeof experiments)[number]>[] = [
    {
      id: 'identifier',
      header: t('projects.projectOverview.columns.id'),
      cell: ({ row }) => (
        <ObjectLink
          kind="experiment"
          id={row.original.id}
          identifier={row.original.identifier}
        />
      ),
    },
    {
      id: 'title',
      header: t('projects.projectOverview.columns.experiment'),
      cell: ({ row }) => (
        <ObjectLink kind="experiment" id={row.original.id} mono={false}>
          <span className="font-medium">{row.original.title}</span>
        </ObjectLink>
      ),
    },
    {
      id: 'owner',
      header: t('projects.projectOverview.columns.owner'),
      cell: ({ row }) => (
        <Person
          name={userLabel(row.original.createdByUserId)}
          userId={row.original.createdByUserId}
        />
      ),
    },
    {
      id: 'status',
      header: t('projects.projectOverview.columns.status'),
      cell: ({ row }) => {
        const status = experimentStatus(row.original.status)

        return <Status tone={status.tone}>{status.label}</Status>
      },
    },
    {
      id: 'updated',
      header: t('projects.projectOverview.columns.updated'),
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {formatListDate(row.original.updatedAt, now())}
        </span>
      ),
      meta: {
        ...rightAligned<(typeof experiments)[number]>().meta,
        cellClassName: 'text-right text-fg-muted',
      },
    },
  ]

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[26px] overflow-auto px-4 py-[22px] md:px-8">
      <OverviewMilestones
        projectId={projectId}
        milestones={milestones}
        canWrite={canWrite}
      />

      <Section
        title={t('projects.projectOverview.experiments.title')}
        count={project.experimentCount}
        action={
          <span className="flex items-center gap-3">
            {project.experimentCount ? (
              <Button
                nativeButton={false}
                render={
                  // react-doctor-disable-next-line react-doctor/anchor-has-content -- Button forwards its export-label children to this anchor through Base UI's render prop.
                  <a href={`/api/export/project/${projectId}/eln`} />
                }
              >
                {t('projects.projectOverview.experiments.export')}
              </Button>
            ) : null}
          </span>
        }
      >
        {experiments.length ? (
          <TableBox>
            <RegistryGrid
              label={t('projects.projectOverview.experiments.title')}
              rows={experiments}
              columns={experimentColumns}
              getRowId={(e) => e.id}
              selectable={false}
            />
          </TableBox>
        ) : (
          <EmptyState
            className="py-2"
            icon="flask"
            title={t('projects.projectOverview.experiments.empty.title')}
            description={t('projects.projectOverview.experiments.empty.body')}
            action={
              canWrite ? (
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      to="/experiments/new"
                      search={{ project: projectId }}
                    />
                  }
                >
                  {t('projects.projectOverview.experiments.create')}
                </Button>
              ) : undefined
            }
          />
        )}
      </Section>
    </div>
  )
}

function OverviewMilestones({
  projectId,
  milestones,
  canWrite,
}: {
  projectId: string
  milestones: NonNullable<ReturnType<typeof useProjectMilestones>['data']>
  canWrite: boolean
}) {
  const milestoneColumns: RegistryColumn<(typeof milestones)[number]>[] = [
    {
      id: 'milestone',
      header: t('projects.projectOverview.columns.milestone'),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      id: 'status',
      header: t('projects.projectOverview.columns.status'),
      cell: ({ row }) => {
        const tone = milestoneTone(row.original.status, row.original.dueAt)

        return <Status tone={tone.tone}>{tone.label}</Status>
      },
    },
    {
      id: 'due',
      header: t('projects.projectOverview.columns.due'),
      cell: ({ row }) => (
        <span className="mono text-fg-muted">
          {formatDate(row.original.dueAt)}
        </span>
      ),
    },
    {
      id: 'evidence',
      header: t('projects.projectOverview.columns.evidence'),
      cell: ({ row }) =>
        row.original.linkedRecordId ? (
          <Link
            to="/records/$recordId"
            params={{ recordId: row.original.linkedRecordId }}
            className="text-link"
          >
            <span className="mono">
              {row.original.linkedRecordIdentifier ??
                t('projects.projectOverview.record')}
            </span>
          </Link>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
  ]

  return (
    <Section
      title={t('projects.projectOverview.milestones.title')}
      count={milestones.length}
    >
      {milestones.length ? (
        <TableBox>
          <RegistryGrid
            label={t('projects.projectOverview.milestones.label')}
            rows={milestones}
            columns={
              // An empty Evidence column on every row says nothing.
              milestones.some((milestone) => milestone.linkedRecordId)
                ? milestoneColumns
                : milestoneColumns.filter((column) => column.id !== 'evidence')
            }
            getRowId={(milestone) => milestone.id}
            selectable={false}
          />
        </TableBox>
      ) : (
        <EmptyState
          className="py-2"
          title={t('projects.projectOverview.milestones.empty.title')}
          description={t('projects.projectOverview.milestones.empty.body')}
          action={
            canWrite ? (
              <Button
                nativeButton={false}
                render={
                  <Link
                    to="/projects/$projectId/milestones"
                    params={{ projectId }}
                  />
                }
              >
                {t('projects.projectOverview.milestones.add')}
              </Button>
            ) : undefined
          }
        />
      )}
    </Section>
  )
}
