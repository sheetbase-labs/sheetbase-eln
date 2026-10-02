import { useEffect, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { toast } from '#/components/v3/ui/sonner'
import {
  draftVersion,
  usePipelineVersions,
} from '#/components/v3/pipelines/pipelines-data'
import { notebookDataClient } from '#/lib/notebook-data'

/** UI port (RM-125): the pipeline Steps editor. Edits the stored configuration
 * (description, SQL transform, output dataset and inputs), saves it as the
 * draft version — or a new one — and publishes it. */
export const Route = createFileRoute('/pipelines/$pipelineId/steps')({
  beforeLoad: async ({ context: rootContext }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect({ to: '/sign-in' })
    }
    return { context }
  },
  component: PipelineSteps,
})

interface PipelineInput {
  name: string
  required?: boolean
}

interface PipelineConfiguration {
  configVersion?: number
  description?: string | null
  parameters?: unknown[]
  inputs?: PipelineInput[]
  transform?: { language?: string; statement?: string }
  output?: {
    mode?: string
    schemaVersionId?: string
    datasetName?: string
    datasetLabel?: string
    fieldMapping?: unknown
  }
}

function PipelineSteps() {
  const { pipelineId } = Route.useParams()
  const { context } = Route.useRouteContext()
  const workspaceId = context.workspace?.id ?? ''
  const queryClient = useQueryClient()
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []
  const draft = draftVersion(list)
  const current =
    list.find((v) => v.lifecycle === 'published') ?? list.at(0) ?? undefined
  const source = draft ?? current

  const [description, setDescription] = useState('')
  const [statement, setStatement] = useState('')
  const [datasetName, setDatasetName] = useState('')

  const sourceId = source?.id
  const sourceConfig = (source?.configuration ?? {}) as PipelineConfiguration
  useEffect(() => {
    setDescription(sourceConfig.description ?? '')
    setStatement(sourceConfig.transform?.statement ?? '')
    setDatasetName(sourceConfig.output?.datasetName ?? '')
  }, [
    sourceId,
    sourceConfig.description,
    sourceConfig.transform?.statement,
    sourceConfig.output?.datasetName,
  ])

  const inputs = sourceConfig.inputs ?? []

  const buildConfig = (): PipelineConfiguration => ({
    ...sourceConfig,
    configVersion: sourceConfig.configVersion ?? 1,
    description: description.trim() || null,
    inputs,
    transform: {
      language: sourceConfig.transform?.language ?? 'sql',
      statement: statement.trim(),
    },
    output: {
      ...(sourceConfig.output ?? { mode: 'create' }),
      datasetName: datasetName.trim(),
    },
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })

  const saveDraft = useMutation({
    mutationFn: () =>
      draft
        ? notebookDataClient.rpc('update_pipeline_definition_version_draft', {
            p_workspace_id: workspaceId,
            p_version_id: draft.id,
            p_expected_revision: draft.revision,
            p_configuration: buildConfig(),
          })
        : notebookDataClient.rpc('create_pipeline_definition_version', {
            p_workspace_id: workspaceId,
            p_definition_id: pipelineId,
            p_configuration: buildConfig(),
          }),
    onSuccess: () => {
      toast(draft ? 'Draft updated' : 'Draft version created')
      void invalidate()
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : 'Couldn’t save it.'),
  })

  const publish = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('No draft to publish.')
      return notebookDataClient.rpc('publish_pipeline_definition_version', {
        p_workspace_id: workspaceId,
        p_version_id: draft.id,
      })
    },
    onSuccess: () => {
      toast('Version published')
      void invalidate()
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : 'Couldn’t publish it.',
      ),
  })

  if (!source) {
    return (
      <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        <Notice tone="info" title="This pipeline has no version yet">
          A pipeline needs a published version before its steps can be edited.
        </Notice>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-4 md:px-6">
      <div className="flex items-center gap-2">
        <span className="text-label text-fg-muted">
          {draft
            ? `Editing draft v${draft.version}`
            : `Editing published v${source.version} — saving creates a draft`}
        </span>
        <span className="flex-1" />
        {draft ? (
          <Status tone="draft">Draft</Status>
        ) : (
          <Status tone="ok">Published</Status>
        )}
      </div>

      <Section title="Step">
        <div className="flex flex-col gap-4">
          <Field label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field
            label="Transform"
            hint="SQL over the declared inputs. Sheets are read as tables named by the input."
          >
            <textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={6}
              spellCheck={false}
              className="num w-full rounded-md border border-border bg-surface p-2 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            />
          </Field>
        </div>
      </Section>

      <Section title="Inputs" count={inputs.length}>
        {inputs.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {inputs.map((i) => (
              <li key={i.name} className="flex items-center gap-2 text-body">
                <span className="mono">{i.name}</span>
                <span className="text-fg-muted">
                  {i.required ? 'Required' : 'Optional'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-label text-fg-muted">No inputs declared.</p>
        )}
      </Section>

      <Section title="Output">
        <Field label="Dataset name">
          <Input
            value={datasetName}
            onChange={(e) => setDatasetName(e.target.value)}
          />
        </Field>
      </Section>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={saveDraft.isPending || statement.trim().length === 0}
          onClick={() => saveDraft.mutate()}
        >
          {saveDraft.isPending
            ? 'Saving…'
            : draft
              ? 'Save draft'
              : 'Save as draft'}
        </Button>
        {draft ? (
          <Button disabled={publish.isPending} onClick={() => publish.mutate()}>
            {publish.isPending ? 'Publishing…' : 'Publish version'}
          </Button>
        ) : null}
        <Button
          nativeButton={false}
          render={
            <Link to="/pipelines/$pipelineId/runs" params={{ pipelineId }} />
          }
        >
          Pipeline runs
        </Button>
      </div>
    </div>
  )
}
