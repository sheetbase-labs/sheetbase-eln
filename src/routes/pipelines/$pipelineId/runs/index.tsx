import { createFileRoute, Link } from '@tanstack/react-router'

import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { buttonVariants } from '#/components/v3/ui/button'
import { ProjectListFailure } from '#/components/v3/projects/project-list'
import { Muted, Section } from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import { triggerLabel } from '#/lib/pipeline-schedule-form'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import {
  RegistryGrid,
  rightAligned,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import {
  runDuration,
  runStatus,
  useDefinitionRuns,
  useRunNumbers,
  usePipelineVersions,
} from '#/components/v3/pipelines/pipelines-data'

/** UI port (roadmap-4/ui-app3): the pipeline's runs, newest first, across
 * every version. */
export const Route = createFileRoute('/pipelines/$pipelineId/runs/')({
  component: PipelineRuns,
})

function PipelineRuns() {
  // Re-render when the person's time zone is applied or changed.
  useDisplayTimeZone()
  const { pipelineId } = Route.useParams()
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []
  const runs = useDefinitionRuns(list)
  const rows = runs.data ?? []
  const numbers = useRunNumbers(list)
  const versionLabel = (versionId: string) => {
    const v = list.find((x) => x.id === versionId)
    return v ? `v${v.version}` : '—'
  }

  const columns: RegistryColumn<(typeof rows)[number]>[] = [
    {
      id: 'run',
      header: 'Run',
      cell: ({ row }) => (
        <Link
          to="/pipelines/$pipelineId/runs/$runId"
          params={{ pipelineId, runId: row.original.id }}
        >
          <span className="mono">
            {numbers.data?.has(row.original.id)
              ? `#${numbers.data.get(row.original.id)}`
              : row.original.id.slice(0, 8)}
          </span>
        </Link>
      ),
    },
    {
      id: 'version',
      header: 'Version',
      cell: ({ row }) => versionLabel(row.original.definition_version_id),
    },
    {
      id: 'trigger',
      header: 'Trigger',
      cell: ({ row }) => triggerLabel(row.original.trigger_kind),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = runStatus(row.original.status)
        return <Status tone={status.tone}>{status.label}</Status>
      },
    },
    {
      id: 'started',
      header: 'Started',
      cell: ({ row }) => (
        <span className="text-fg-muted">
          {formatNotebookDateTime(row.original.started_at, { zone: true })}
        </span>
      ),
    },
    {
      id: 'took',
      header: 'Took',
      cell: ({ row }) => runDuration(row.original),
      meta: rightAligned<(typeof rows)[number]>().meta,
    },
  ]

  if (
    versions.isLoading ||
    runs.isLoading ||
    versions.isError ||
    runs.isError
  ) {
    return (
      <div className="px-4 py-4 md:px-6">
        {versions.isError || runs.isError ? (
          <ProjectListFailure
            error={versions.error ?? runs.error}
            what="pipeline runs"
            onRetry={() => {
              void versions.refetch()
              void runs.refetch()
            }}
          />
        ) : (
          <Muted>Loading execution history…</Muted>
        )}
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-4 py-[18px] md:px-6">
      <Section title="Execution history" count={rows.length}>
        <Muted>
          All versions, newest first. Open a run to inspect its result, log and
          pinned input snapshots.
        </Muted>
        {rows.length ? (
          <TableBox>
            <RegistryGrid
              label="Pipeline runs"
              rows={rows}
              columns={columns}
              getRowId={(r) => r.id}
              selectable={false}
            />
          </TableBox>
        ) : (
          <EmptyState
            title="No runs yet"
            description={
              list.some((v) => v.lifecycle === 'published')
                ? 'Use Run now to start the published version. Add a trigger only if it should run automatically.'
                : 'Create and publish a version before starting a run.'
            }
            className="py-4"
            action={
              !list.some((v) => v.lifecycle === 'published') ? (
                <Link
                  to="/pipelines/$pipelineId/steps"
                  params={{ pipelineId }}
                  className={buttonVariants({ variant: 'primary' })}
                >
                  Configure steps
                </Link>
              ) : undefined
            }
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
