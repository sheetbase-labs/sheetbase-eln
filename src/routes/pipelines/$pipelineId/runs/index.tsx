import { createFileRoute, Link } from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted, Section } from '#/components/v3/ui/layout'
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
  runDuration,
  runStatus,
  useDefinitionRuns,
  usePipelineVersions,
} from '#/components/v3/pipelines/pipelines-data'

/** UI port (roadmap-4/ui-app3): the pipeline's runs, newest first, across
 * every version. */
export const Route = createFileRoute('/pipelines/$pipelineId/runs/')({
  component: PipelineRuns,
})

function PipelineRuns() {
  const { pipelineId } = Route.useParams()
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []
  const runs = useDefinitionRuns(list)
  const rows = runs.data ?? []
  const versionLabel = (versionId: string) => {
    const v = list.find((x) => x.id === versionId)
    return v ? `v${v.version}` : '—'
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-[18px] md:px-6">
      <Section title="Runs" count={rows.length}>
        {rows.length ? (
          <TableBox>
            <Table aria-label="Pipeline runs">
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead align="right">Took</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="mono">
                      <Link
                        to="/pipelines/$pipelineId/runs/$runId"
                        params={{ pipelineId, runId: r.id }}
                      >
                        {r.id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {versionLabel(r.definition_version_id)}
                    </TableCell>
                    <TableCell>{r.trigger_kind}</TableCell>
                    <TableCell>
                      <Status tone={runStatus(r.status).tone}>
                        {runStatus(r.status).label}
                      </Status>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {r.started_at.slice(0, 16).replace('T', ' ')}
                    </TableCell>
                    <TableCell align="right">{runDuration(r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        ) : (
          <EmptyState
            icon="play"
            title="No runs yet"
            body="Press Run now, or turn on a trigger in Triggers."
            className="py-4"
          />
        )}
      </Section>
      <Muted className="mt-4">
        Each run records the version and the exact input snapshots it used, so a
        result can always be traced back.
      </Muted>
    </div>
  )
}
