import { createFileRoute, Link } from '@tanstack/react-router'

import {
  PipelineSteps,
  TemporaryArtefact,
} from '#/components/v3/pipelines/pipeline-code'
import { ProjectListFailure } from '#/components/v3/projects/project-list'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { buttonVariants } from '#/components/v3/ui/button'
import { Muted, Section } from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
import { formatNotebookDateTime } from '#/lib/notebook-data'
import { useDisplayTimeZone } from '#/lib/display-time-zone'
import {
  currentVersion,
  draftVersion,
  usePipelineVersions,
  versionStatus,
} from '#/components/v3/pipelines/pipelines-data'

/** UI port (roadmap-4/ui-app3): the pipeline Overview reads the current
 * version's configuration. Editing steps is deferred to the Steps tab; the
 * configuration is shown exactly as stored. R5-SHELL-06 presents that
 * configuration properly: code names its language and stays text, temporary
 * stores are marked with the rule that ends them, and step navigation is the
 * already-linkable `/pipelines/$pipelineId/steps` route. */
export const Route = createFileRoute('/pipelines/$pipelineId/')({
  component: PipelineOverview,
})

interface ConfigShape {
  description?: string
  parameters?: { name: string; type: string; required?: boolean }[]
  inputs?: { name: string; required?: boolean }[]
  transform?: { language?: string; statement?: string }
  steps?: { name: string; language: string; statement: string }[]
  output?: {
    mode?: string
    datasetName?: string
    datasetLabel?: string
    datasetId?: string
  }
}

function PipelineOverview() {
  useDisplayTimeZone()
  const { pipelineId } = Route.useParams()
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []
  const version = currentVersion(list)
  const draft = draftVersion(list)
  const shown = draft ?? version
  const { rowSelection, onRowSelectionChange } = useRowFocus(
    shown?.id ?? null,
    () => {},
  )

  if (versions.isLoading || versions.isError) {
    return (
      <div className="px-4 py-4 md:px-6">
        {versions.isError ? (
          <ProjectListFailure
            error={versions.error}
            what="pipeline versions"
            onRetry={() => void versions.refetch()}
          />
        ) : (
          <Muted>Loading pipeline versions…</Muted>
        )}
      </div>
    )
  }

  if (!shown) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          title="Create your first version"
          description="Configure SQL or Python steps, try the draft, then publish it when ready. Dataset inputs and dataset output are optional."
          action={
            <Link
              to="/pipelines/$pipelineId/steps"
              params={{ pipelineId }}
              className={buttonVariants({ variant: 'primary' })}
            >
              Configure steps
            </Link>
          }
        />
        <Muted>
          Prefer local Python files or notebooks? The Steps tab explains how to
          save them to a draft with the SDK or CLI.
        </Muted>
      </div>
    )
  }

  type ConfigInput = NonNullable<ConfigShape['inputs']>[number]
  type ConfigParameter = NonNullable<ConfigShape['parameters']>[number]

  const inputColumns: RegistryColumn<ConfigInput>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => <span className="mono">{row.original.name}</span>,
    },
    {
      id: 'required',
      header: 'Required',
      cell: ({ row }) => (row.original.required ? 'Yes' : 'No'),
    },
  ]

  const parameterColumns: RegistryColumn<ConfigParameter>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => <span className="mono">{row.original.name}</span>,
    },
    { id: 'type', header: 'Type', cell: ({ row }) => row.original.type },
    {
      id: 'required',
      header: 'Required',
      cell: ({ row }) => (row.original.required ? 'Yes' : 'No'),
    },
  ]

  const versionColumns: RegistryColumn<(typeof list)[number]>[] = [
    {
      id: 'version',
      header: 'Version',
      cell: ({ row }) => (
        <span className="font-medium">v{row.original.version}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = versionStatus(row.original.lifecycle)
        return <Status tone={status.tone}>{status.label}</Status>
      },
    },
    {
      id: 'published',
      header: 'Published',
      cell: ({ row }) =>
        row.original.published_at
          ? formatNotebookDateTime(row.original.published_at, { zone: true })
          : '—',
      meta: { cellClassName: 'text-fg-muted' },
    },
  ]

  const config = shown.configuration as ConfigShape
  // R5-SHELL-06: what the run keeps, and where a person can act on its
  // retention. Only an append output has a dataset to link to; a create output
  // makes its dataset at run time.
  const output = config.output
  const keepsArtefact = Boolean(output && output.mode !== 'none')
  const keptDatasetId = output?.mode === 'append' ? output.datasetId : undefined
  return (
    <div className="@container/overview min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <div className="flex flex-col gap-5">
        <Section
          title="Configuration"
          className="border-b border-border pb-4"
          count={
            <span className="flex items-center gap-2">
              <Status tone={versionStatus(shown.lifecycle).tone}>
                {versionStatus(shown.lifecycle).label} v{shown.version}
              </Status>
            </span>
          }
        >
          <Muted>
            {draft && version?.lifecycle === 'published'
              ? `Showing draft v${draft.version}. Runs still use published v${version.version}. `
              : ''}
            {shown.published_at
              ? `Published ${formatNotebookDateTime(shown.published_at, { zone: true })}. `
              : 'Not published. '}
            New runs pin the exact input snapshots they used.
          </Muted>
        </Section>

        <div className="grid min-w-0 grid-cols-1 gap-6 @min-[900px]/overview:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Section
              title="Execution order"
              count={
                (config.transform?.statement &&
                config.transform.language !== 'none'
                  ? 1
                  : 0) + (config.steps?.length ?? 0)
              }
            >
              <Muted>
                The transform runs first. Further steps receive the preceding
                result as <code>previous</code>.
              </Muted>
              <PipelineSteps
                pipelineId={pipelineId}
                steps={config.steps ?? []}
                transform={
                  config.transform?.statement &&
                  config.transform.language !== 'none'
                    ? {
                        name: 'Transform',
                        language: config.transform.language ?? 'sql',
                        statement: config.transform.statement,
                      }
                    : undefined
                }
              />
            </Section>
            <Section title="Version history" count={list.length}>
              <TableBox>
                <RegistryGrid
                  label="Pipeline versions"
                  rows={list}
                  columns={versionColumns}
                  getRowId={(v) => v.id}
                  selectable={false}
                  rowSelection={rowSelection}
                  onRowSelectionChange={onRowSelectionChange}
                />
              </TableBox>
            </Section>
          </div>
          <div className="flex min-w-0 flex-col gap-5 @min-[900px]/overview:border-l @min-[900px]/overview:border-border @min-[900px]/overview:pl-5">
            <Section title="Inputs" count={config.inputs?.length ?? 0}>
              {config.inputs?.length ? (
                <div className="flex flex-col gap-2">
                  <TableBox>
                    <RegistryGrid
                      label="Pipeline inputs"
                      rows={config.inputs}
                      columns={inputColumns}
                      getRowId={(i) => i.name}
                      selectable={false}
                    />
                  </TableBox>
                  <div className="flex flex-wrap items-center gap-2">
                    <TemporaryArtefact>Temporary tables</TemporaryArtefact>
                    <Muted className="text-caption">
                      Each run works on a copy of the exact dataset version; the
                      dataset itself is never changed. The copy is discarded
                      when the run ends.
                    </Muted>
                  </div>
                </div>
              ) : (
                <Muted>No inputs declared.</Muted>
              )}
            </Section>

            <Section title="Parameters" count={config.parameters?.length ?? 0}>
              {config.parameters?.length ? (
                <TableBox>
                  <RegistryGrid
                    label="Pipeline parameters"
                    rows={config.parameters}
                    columns={parameterColumns}
                    getRowId={(p) => p.name}
                    selectable={false}
                  />
                </TableBox>
              ) : (
                <Muted>No parameters declared.</Muted>
              )}
            </Section>

            <Section title="Output">
              <div className="flex flex-col gap-1.5">
                <Muted>
                  {!output || output.mode === 'none'
                    ? 'Preview only. No dataset snapshot is written.'
                    : output.mode === 'append'
                      ? `Appends to dataset ${output.datasetId ?? ''} as ${output.datasetLabel ?? ''}.`
                      : `Creates a dataset${output.datasetName ? ` “${output.datasetName}”` : ''} labelled ${output.datasetLabel ?? ''}.`}
                </Muted>
                {keepsArtefact ? (
                  <>
                    <Muted className="text-caption">
                      Kept as a dataset snapshot, with the run as its source.
                      The workspace retention policy decides when its rows can
                      be removed: a snapshot on an active dataset, cited by a
                      signed record or kept by hand is not removed. The
                      dataset’s snapshots page states the exact dates.
                    </Muted>
                    {keptDatasetId ? (
                      <Link
                        to="/datasets/$datasetId/snapshots"
                        params={{ datasetId: keptDatasetId }}
                        className="text-link self-start text-label"
                      >
                        Snapshots and retention
                      </Link>
                    ) : null}
                  </>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <TemporaryArtefact>Nothing kept</TemporaryArtefact>
                    <Muted className="text-caption">
                      Intermediate step tables are dropped when the run ends.
                    </Muted>
                  </div>
                )}
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}
