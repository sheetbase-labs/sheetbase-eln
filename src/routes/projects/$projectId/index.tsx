import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
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
import { useProjectSummary } from '#/components/v3/projects/project-data'
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

function ProjectOverview() {
  const { projectId } = Route.useParams()
  const { project } = useProjectSummary(projectId)
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

  if (!project) return null

  const details: [string, React.ReactNode][] = [
    ['ID', <span className="mono">{project.displayId ?? project.key}</span>],
    ['Client', project.clientCode ?? 'Internal'],
    ['Modality', project.modality ?? '—'],
    ['Stage', project.stage ?? '—'],
    ['Lead', project.leadName ?? '—'],
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
        <Section title="Milestones">
          <EmptyState
            className="py-2"
            title="No milestones yet"
            body="Milestones group the experiments that count as evidence. The capability that stores them is not built yet."
          />
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
          Folder organisation, members and per-project governance arrive with
          their capability tasks.
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
