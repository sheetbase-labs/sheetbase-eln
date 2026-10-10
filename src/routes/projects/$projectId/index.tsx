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
import { Status } from '#/components/v3/ui/status'
import {
  Table,
  TableBody,
  TableBox,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/v3/ui/table'
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

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-[26px] overflow-auto px-4 py-[22px] md:px-8">
        <Section title="Milestones" count={milestones.length}>
          {milestones.length ? (
            <TableBox>
              <Table aria-label="Project milestones">
                <TableHeader>
                  <TableRow>
                    <TableHead>Milestone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Evidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {milestones.map((m) => {
                    const tone = milestoneTone(m.status)
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell>
                          <Status tone={tone.tone}>{tone.label}</Status>
                        </TableCell>
                        <TableCell className="mono text-fg-muted">
                          {m.dueAt ? m.dueAt.slice(0, 10) : '—'}
                        </TableCell>
                        <TableCell>
                          {m.linkedRecordId ? (
                            <Link
                              to="/records/$recordId"
                              params={{ recordId: m.linkedRecordId }}
                              className="text-link mono"
                            >
                              {m.linkedRecordIdentifier ?? 'Record'}
                            </Link>
                          ) : (
                            <span className="text-fg-muted">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <EmptyState
              className="py-2"
              title="No milestones yet"
              body="Milestones are the project's deliverables with a target date, linked to the records that evidence them."
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Experiment</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead align="right">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {experiments.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="mono">{e.identifier}</TableCell>
                      <TableCell className="font-medium">{e.title}</TableCell>
                      <TableCell>{userLabel(e.createdByUserId)}</TableCell>
                      <TableCell>
                        <Status tone={statusTone(e.status)}>
                          {statusLabel(e.status)}
                        </Status>
                      </TableCell>
                      <TableCell align="right" className="text-fg-muted">
                        {e.updatedAt.slice(0, 10)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <EmptyState
              className="py-2"
              icon="flask"
              title="No experiments yet"
              body="Experiments you start in this project appear here."
            />
          )}
        </Section>

        <Muted>
          Milestones are the project's study deliverables; authoring them from
          here lands with PROJ-02. Folders, members and settings are on their
          tabs.
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
