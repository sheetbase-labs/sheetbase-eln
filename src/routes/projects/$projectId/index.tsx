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
  fetchProjectMembers,
  useProjectMilestones,
  useProjectSummary,
} from '#/components/v3/projects/project-data'
import { statusLabel, statusTone } from '../$projectId'
import {
  fetchRecordsForProject,
  notebookDataClient,
  notebookQueryKeys,
} from '#/lib/notebook-data'
import { ObjectLink } from '#/components/v3/ui/object-link'
import { useUserNames } from '#/lib/user-names'

export const Route = createFileRoute('/projects/$projectId/')({
  component: ProjectOverview,
})

function milestoneTone(status: string): {
  tone: 'draft' | 'progress' | 'ok' | 'bad' | 'none'
  label: string
} {
  switch (status) {
    case 'planned':
      return { tone: 'draft', label: 'Planned' }
    case 'in_progress':
      return { tone: 'progress', label: 'In progress' }
    case 'delivered':
      return { tone: 'ok', label: 'Delivered' }
    case 'overdue':
      return { tone: 'bad', label: 'Overdue' }
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
  const milestones = milestonesQuery.data ?? []
  const recordsQuery = useQuery({
    queryKey: notebookQueryKeys.records(projectId),
    queryFn: () => fetchRecordsForProject(notebookDataClient, projectId),
  })
  const records = recordsQuery.data ?? []
  const experiments = useMemo(
    () => records.filter((r) => r.kind === 'experiment').slice(0, 5),
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
    ['ID', <span className="mono">{project.displayId ?? project.key}</span>],
    ['Client', project.clientCode ?? 'Internal'],
    ['Modality', project.modality ?? '—'],
    ['Stage', project.stage ?? '—'],
    ['Lead', project.leadName ?? '—'],
    ['Members', memberSummary],
    ['Started', project.startedOn ?? '—'],
    ...(project.agreementReference
      ? ([
          [
            'Agreement',
            <span className="mono">{project.agreementReference}</span>,
          ],
        ] as [string, React.ReactNode][])
      : []),
  ]

  const milestoneColumns: RegistryColumn<(typeof milestones)[number]>[] = [
    {
      id: 'milestone',
      header: 'Milestone',
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const tone = milestoneTone(row.original.status)
        return <Status tone={tone.tone}>{tone.label}</Status>
      },
    },
    {
      id: 'due',
      header: 'Due',
      cell: ({ row }) => (
        <span className="mono text-fg-muted">
          {row.original.dueAt ? row.original.dueAt.slice(0, 10) : '—'}
        </span>
      ),
    },
    {
      id: 'evidence',
      header: 'Evidence',
      cell: ({ row }) =>
        row.original.linkedRecordId ? (
          <Link
            to="/records/$recordId"
            params={{ recordId: row.original.linkedRecordId }}
            className="text-link"
          >
            <span className="mono">
              {row.original.linkedRecordIdentifier ?? 'Record'}
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
      header: 'ID',
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
      header: 'Experiment',
      cell: ({ row }) => (
        <ObjectLink kind="experiment" id={row.original.id} mono={false}>
          <span className="font-medium">{row.original.title}</span>
        </ObjectLink>
      ),
    },
    {
      id: 'owner',
      header: 'Owner',
      cell: ({ row }) => userLabel(row.original.createdByUserId),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Status tone={statusTone(row.original.status)}>
          {statusLabel(row.original.status)}
        </Status>
      ),
    },
    {
      id: 'updated',
      header: 'Updated',
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {row.original.updatedAt.slice(0, 10)}
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
        <Section title="Milestones" count={milestones.length}>
          {milestones.length ? (
            <TableBox>
              <RegistryGrid
                label="Project milestones"
                rows={milestones}
                columns={milestoneColumns}
                getRowId={(m) => m.id}
                selectable={false}
              />
            </TableBox>
          ) : (
            <EmptyState
              className="py-2"
              title="No milestones yet"
              description="Milestones are the project's deliverables with a target date, linked to the records that evidence them."
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
                  Add a milestone
                </Button>
              }
            />
          )}
        </Section>

        <Section
          title="Recent experiments"
          count={project.experimentCount}
          action={
            <span className="text-label text-fg-muted">
              {project.experimentCount} in this project
            </span>
          }
        >
          {experiments.length ? (
            <TableBox>
              <RegistryGrid
                label="Recent experiments"
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
              title="No experiments yet"
              description="Experiments you start in this project appear here."
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
                  Create an experiment
                </Button>
              }
            />
          )}
        </Section>

        <Muted>
          Milestones are the project's study deliverables with a target date.
          Add and schedule them on the Milestones tab. Folders, members and
          settings are on their tabs.
        </Muted>
      </div>

      <Inspector aria-label="Project details" className="w-[320px] gap-0 p-0">
        <InspectorSection title="Details">
          <DescriptionList labelWidth={112} items={details} />
        </InspectorSection>
      </Inspector>
    </>
  )
}
