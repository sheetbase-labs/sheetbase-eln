import { createFileRoute } from '@tanstack/react-router'

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
  currentVersion,
  draftVersion,
  usePipelineVersions,
  versionStatus,
} from '#/components/v3/pipelines/pipelines-data'

/** UI port (roadmap-4/ui-app3): the pipeline Overview reads the current
 * version's configuration. Editing steps is deferred; the configuration is
 * shown exactly as stored. */
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

  if (!shown) {
    return (
      <div className="px-4 py-4 md:px-6">
        <EmptyState
          icon="pipeline"
          title="No version yet"
          body="A pipeline needs a draft version with inputs, a transform and an output before it can run."
        />
      </div>
    )
  }

  const config = shown.configuration as ConfigShape
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
            <TableBox>
              <Table aria-label="Pipeline inputs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Required</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config.inputs.map((i) => (
                    <TableRow key={i.name}>
                      <TableCell className="mono">{i.name}</TableCell>
                      <TableCell>{i.required ? 'Yes' : 'No'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <Muted>No inputs declared.</Muted>
          )}
        </Section>

        <Section title="Parameters" count={config.parameters?.length ?? 0}>
          {config.parameters?.length ? (
            <TableBox>
              <Table aria-label="Pipeline parameters">
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Required</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config.parameters.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell className="mono">{p.name}</TableCell>
                      <TableCell>{p.type}</TableCell>
                      <TableCell>{p.required ? 'Yes' : 'No'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableBox>
          ) : (
            <Muted>No parameters declared.</Muted>
          )}
        </Section>

        <Section title="Transform">
          {config.steps?.length ? (
            <div className="flex flex-col gap-3">
              {config.steps.map((s, i) => (
                <div key={`${s.name}-${i}`} className="flex flex-col gap-1">
                  <span className="text-label font-semibold">
                    {i + 1} · {s.name} · {s.language}
                  </span>
                  <pre className="m-0 overflow-auto rounded-md border border-border bg-surface p-3 text-caption">
                    <code>{s.statement}</code>
                  </pre>
                </div>
              ))}
            </div>
          ) : config.transform?.statement ? (
            <pre className="m-0 overflow-auto rounded-md border border-border bg-surface p-3 text-caption">
              <code>{config.transform.statement}</code>
            </pre>
          ) : (
            <Muted>No transform statement.</Muted>
          )}
        </Section>

        <Section title="Output">
          <Muted>
            {config.output?.mode === 'none' || !config.output
              ? 'Keeps nothing.'
              : config.output.mode === 'append'
                ? `Appends to dataset ${config.output.datasetId ?? ''} as ${config.output.datasetLabel ?? ''}.`
                : `Creates a dataset${config.output.datasetName ? ` “${config.output.datasetName}”` : ''} labelled ${config.output.datasetLabel ?? ''}.`}
          </Muted>
        </Section>

        <Section title="Versions" count={list.length}>
          <TableBox>
            <Table aria-label="Pipeline versions">
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Published</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((v) => (
                  <TableRow key={v.id} selected={v.id === shown.id}>
                    <TableCell className="font-medium">v{v.version}</TableCell>
                    <TableCell>
                      <Status tone={versionStatus(v.lifecycle).tone}>
                        {versionStatus(v.lifecycle).label}
                      </Status>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {v.published_at ? v.published_at.slice(0, 10) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableBox>
        </Section>
      </div>
    </div>
  )
}
