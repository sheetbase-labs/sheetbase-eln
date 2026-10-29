import { useMemo } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import {
  DescriptionList,
  Inspector,
  InspectorSection,
  Muted,
  Section,
} from '#/components/v3/ui/layout'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Button } from '#/components/v3/ui/button'
import { Status } from '#/components/v3/ui/status'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  fetchProjectActivity,
  fetchProjectMembers,
  useProjectMilestones,
  useProjectSummary,
} from '#/components/v3/projects/project-data'
import { experimentStatus } from '#/components/v3/experiments/experiments-data'
import {
  fetchRecordsForProject,
  formatDate,
  formatRelativeTime,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { useUserNames } from '#/lib/user-names'
import { AddedFields } from '#/components/v3/models/added-fields'
import { describeAuditEvent } from '#/lib/audit-history'
import { now } from '#/lib/clock'
import { daysUntilDate } from '#/lib/calendar-days'
import { formatListDate } from '#/lib/list-date'
import { rich, t } from '#/copy'

export const Route = createFileRoute('/projects/$projectId/')({
  component: ProjectOverview,
})

function milestoneTone(
  status: string,
  dueAt: string | null,
): {
  tone: 'draft' | 'progress' | 'ok' | 'bad' | 'none'
  label: string
} {
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
  const records = recordsQuery.data ?? []
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
  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => fetchProjectMembers(projectId),
    staleTime: 60_000,
  })
  const activityQuery = useQuery({
    queryKey: ['project-activity', projectId],
    queryFn: () => fetchProjectActivity(projectId),
    staleTime: 30_000,
  })
  const allExperiments = records.filter(
    (r) => r.kind === 'experiment' && !r.archivedAt,
  )
  const inReview = allExperiments.filter((r) => r.status === 'in_review')
  const approved = allExperiments.filter((r) => r.status === 'approved')
  const memberSummary = membersQuery.data?.length
    ? `${membersQuery.data
        .slice(0, 3)
        .map((m) => m.name)
        .join(', ')}${
        membersQuery.data.length > 3 ? ` +${membersQuery.data.length - 3}` : ''
      }`
    : '—'

  if (!project) return null

  const details: [string, React.ReactNode][] = [
    [
      t('projects.projectOverview.details.id'),
      <span className="mono">{project.displayId ?? project.key}</span>,
    ],
    [
      t('projects.projectOverview.details.client'),
      project.clientCode ?? t('projects.projectOverview.details.internal'),
    ],
    [t('projects.projectOverview.details.modality'), project.modality ?? '—'],
    [t('projects.projectOverview.details.stage'), project.stage ?? '—'],
    [t('projects.projectOverview.details.lead'), project.leadName ?? '—'],
    [t('projects.projectOverview.details.members'), memberSummary],
    [t('projects.projectOverview.details.started'), project.startedOn ?? '—'],
    ...(project.agreementReference
      ? ([
          [
            t('projects.projectOverview.details.agreement'),
            <span className="mono">{project.agreementReference}</span>,
          ],
        ] as [string, React.ReactNode][])
      : []),
  ]

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
      cell: ({ row }) => userLabel(row.original.createdByUserId),
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
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-[26px] overflow-auto px-4 py-[22px] md:px-8">
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
                  milestones.some((m) => m.linkedRecordId)
                    ? milestoneColumns
                    : milestoneColumns.filter((c) => c.id !== 'evidence')
                }
                getRowId={(m) => m.id}
                selectable={false}
              />
            </TableBox>
          ) : (
            <EmptyState
              className="py-2"
              title={t('projects.projectOverview.milestones.empty.title')}
              description={t('projects.projectOverview.milestones.empty.body')}
              action={
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
              }
            />
          )}
        </Section>

        <Section
          title={t('projects.projectOverview.experiments.title')}
          count={project.experimentCount}
          action={
            <span className="flex items-center gap-3">
              <span className="text-label text-fg-muted">
                {t('projects.projectOverview.experiments.inProject', {
                  count: project.experimentCount,
                })}
              </span>
              {project.experimentCount ? (
                <Button
                  nativeButton={false}
                  render={<a href={`/api/export/project/${projectId}/eln`} />}
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
              }
            />
          )}
        </Section>

        <Muted>{t('projects.projectOverview.note')}</Muted>
      </div>

      <Inspector
        aria-label={t('projects.projectOverview.inspector')}
        className="w-[320px]"
      >
        <InspectorSection title={t('projects.projectOverview.detailsTitle')}>
          <DescriptionList labelWidth={112} items={details} />
        </InspectorSection>
        <AddedFields
          modelKey="project"
          objectId={project.id}
          labelWidth={112}
        />
        <InspectorSection title={t('projects.projectOverview.review.title')}>
          <div className="flex flex-col gap-1 text-label">
            <span>
              {t('projects.projectOverview.review.approved', {
                approved: approved.length,
                count: allExperiments.length,
              })}
            </span>
            {inReview.length ? (
              <span>
                {rich('projects.projectOverview.review.awaiting', {
                  waiting: inReview.length,
                  links: inReview.slice(0, 3).map((r, n) => (
                    <span key={r.id}>
                      {n ? ', ' : ''}
                      <ObjectLink
                        kind="experiment"
                        id={r.id}
                        identifier={r.identifier}
                      />
                    </span>
                  )),
                })}
              </span>
            ) : (
              <span className="text-fg-muted">
                {t('projects.projectOverview.review.nothing')}
              </span>
            )}
          </div>
        </InspectorSection>
        <InspectorSection title={t('projects.projectOverview.activity.title')}>
          <div className="flex flex-col gap-2 text-label">
            {(activityQuery.data ?? []).map((event) => {
              const description = describeAuditEvent(event)
              return (
                <div key={event.id} className="flex gap-2 break-words">
                  <time
                    className="shrink-0 text-fg-muted"
                    dateTime={event.createdAt}
                    title={formatDate(event.createdAt)}
                  >
                    {formatRelativeTime(event.createdAt)}
                  </time>
                  <span>
                    {t('projects.projectOverview.activity.line', {
                      actor:
                        event.currentActorName ??
                        t('projects.projectOverview.activity.system'),
                      action: description.action,
                      subject: event.currentRecord
                        ? `${event.currentRecord.identifier} · ${event.currentRecord.title}`
                        : description.subject,
                    })}
                  </span>
                </div>
              )
            })}
            {!activityQuery.data?.length ? (
              <span className="text-fg-muted">
                {activityQuery.isLoading
                  ? t('projects.projectOverview.activity.loading')
                  : t('projects.projectOverview.activity.empty')}
              </span>
            ) : null}
          </div>
        </InspectorSection>
      </Inspector>
    </>
  )
}
