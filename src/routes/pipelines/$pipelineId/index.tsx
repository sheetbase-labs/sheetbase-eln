import { createFileRoute, Link } from '@tanstack/react-router'

import {
  PipelineSteps,
  TemporaryArtefact,
  TemporaryResultNote,
} from '#/components/v3/pipelines/pipeline-code'
import { CodeBlock } from '#/components/v3/ui/code-block'
import { Status } from '#/components/v3/ui/status'
import { EmptyState } from '#/components/v3/ui/empty-state'
import { Muted, Section } from '#/components/v3/ui/layout'
import { TableBox } from '#/components/v3/ui/table'
import {
  RegistryGrid,
  useRowFocus,
} from '#/components/v3/inventory/registry-grid'
import type { RegistryColumn } from '#/components/v3/inventory/registry-grid'
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

  if (!shown) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="pipeline"
          title="No version yet"
          description="A pipeline needs a draft version with inputs, a transform and an output before it can run."
        />
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
          ? row.original.published_at.slice(0, 10)
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
    <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <div className="flex flex-col gap-5">
        <Section
          title="Version"
          count={
            <span className="flex items-center gap-2">
              <Status tone={versionStatus(shown.lifecycle).tone}>
                {versionStatus(shown.lifecycle).label} v{shown.version}
              </Status>
            </span>
          }
        >
          <Muted>
            {shown.published_at
              ? `Published ${shown.published_at.slice(0, 10)}. `
              : 'Not published. '}
            New runs pin the exact input snapshots they used.
          </Muted>
        </Section>

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
                  Each run pins the exact dataset version and copies it into a
                  session temp table; the dataset itself is never changed. The
                  table is dropped when the run ends.
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

        <Section title="Transform">
          {config.steps?.length ? (
            <PipelineSteps pipelineId={pipelineId} steps={config.steps} />
          ) : config.transform?.statement ? (
            <div className="flex flex-col gap-1.5">
              <CodeBlock
                code={config.transform.statement}
                language={config.transform.language}
                label="Transform statement"
              />
              <TemporaryResultNote />
            </div>
          ) : (
            <Muted>No transform statement.</Muted>
          )}
        </Section>

        <Section title="Output">
          <div className="flex flex-col gap-1.5">
            <Muted>
              {!output || output.mode === 'none'
                ? 'Keeps nothing.'
                : output.mode === 'append'
                  ? `Appends to dataset ${output.datasetId ?? ''} as ${output.datasetLabel ?? ''}.`
                  : `Creates a dataset${output.datasetName ? ` “${output.datasetName}”` : ''} labelled ${output.datasetLabel ?? ''}.`}
            </Muted>
            {keepsArtefact ? (
              <>
                <Muted className="text-caption">
                  Kept as a dataset snapshot, with the run as its source. The
                  workspace retention policy decides when its rows can be
                  removed: a snapshot on an active dataset, cited by a signed
                  record or kept by hand is not removed. The dataset’s snapshots
                  page states the exact dates.
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
                  No dataset snapshot is written, so every step table is dropped
                  when the run ends.
                </Muted>
              </div>
            )}
          </div>
        </Section>

        <Section title="Versions" count={list.length}>
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
    </div>
  )
}
