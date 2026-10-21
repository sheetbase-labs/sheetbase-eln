import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { toast } from '#/components/v3/ui/sonner'
import { ParametersEditor } from '#/components/v3/pipelines/parameters-editor'
import { StepsEditor } from '#/components/v3/pipelines/steps-editor'
import { InputsEditor } from '#/components/v3/pipelines/inputs-editor'
import { OutputEditor } from '#/components/v3/pipelines/output-editor'
import type {
  OutputDraft,
  OutputMode,
} from '#/components/v3/pipelines/output-editor'
import {
  draftVersion,
  useDefinitionRuns,
  usePipelineDefinition,
  usePipelineVersions,
  useWorkspaceMemberNames,
} from '#/components/v3/pipelines/pipelines-data'
import { validatePipelineConfig } from '#/lib/pipelines/config'
import { readResultPreview } from '#/lib/pipelines/result-preview'
import type {
  PipelineInput,
  PipelineParameter,
  PipelineStep,
} from '#/lib/pipelines/config'
import { notebookDataClient } from '#/lib/notebook-data'
import { signInRedirect } from '#/lib/sign-in-redirect'

/** UI port (RM-125): the pipeline Steps editor. Edits the stored configuration
 * — description, declared inputs, the transform and the output — saves it as
 * the draft version (or creates the first one), and publishes it. Output targets
 * (the Dataset Schema Version a create output builds from, the Dataset an append
 * output extends) are chosen here from what the workspace has, with the Dataset
 * Version label every kept output needs. */
export const Route = createFileRoute('/pipelines/$pipelineId/steps')({
  beforeLoad: async ({ context: rootContext, location }) => {
    const context = rootContext.auth
    if (!context) {
      throw redirect(signInRedirect(location))
    }
    return { context }
  },
  component: PipelineSteps,
})

interface PipelineConfiguration {
  configVersion?: number
  description?: string | null
  parameters?: PipelineParameter[]
  steps?: PipelineStep[]
  inputs?: PipelineInput[]
  transform?: { language?: string; statement?: string }
  output?: {
    mode?: OutputMode
    schemaVersionId?: string
    datasetId?: string
    datasetName?: string
    datasetLabel?: string
    fieldMapping?: Record<string, string> | null
  }
}

/** The configuration keys this page edits; other errors are the server's to report. */
const EDITED_CONFIG_FIELDS = [
  'description',
  'parameters',
  'steps',
  'inputs',
  'transform',
  'output',
] as const

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
  const [inputs, setInputs] = useState<PipelineInput[]>([])
  const [parameters, setParameters] = useState<PipelineParameter[]>([])
  const [extraSteps, setExtraSteps] = useState<PipelineStep[]>([])
  const members = useWorkspaceMemberNames()
  const [outputMode, setOutputMode] = useState<OutputMode>('none')
  const [schemaVersionId, setSchemaVersionId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [datasetLabel, setDatasetLabel] = useState('')
  const [fieldMapping, setFieldMapping] = useState<Record<
    string,
    string
  > | null>(null)
  const definition = usePipelineDefinition(pipelineId)
  const runs = useDefinitionRuns(list)
  const transformRef = useRef<HTMLTextAreaElement>(null)

  const sourceId = source?.id
  const sourceConfig = (source?.configuration ?? {}) as PipelineConfiguration
  useEffect(() => {
    setDescription(sourceConfig.description ?? '')
    setStatement(sourceConfig.transform?.statement ?? '')
    setDatasetName(sourceConfig.output?.datasetName ?? '')
    setInputs(sourceConfig.inputs ?? [])
    setParameters(sourceConfig.parameters ?? [])
    setExtraSteps(sourceConfig.steps ?? [])
    setOutputMode(sourceConfig.output?.mode ?? 'none')
    setSchemaVersionId(sourceConfig.output?.schemaVersionId ?? '')
    setDatasetId(sourceConfig.output?.datasetId ?? '')
    setDatasetLabel(sourceConfig.output?.datasetLabel ?? '')
    setFieldMapping(sourceConfig.output?.fieldMapping ?? null)
  }, [
    sourceId,
    sourceConfig.description,
    sourceConfig.transform?.statement,
    sourceConfig.output?.datasetName,
    sourceConfig.output?.mode,
    sourceConfig.output?.schemaVersionId,
    sourceConfig.output?.datasetId,
    sourceConfig.output?.datasetLabel,
    sourceConfig.output?.fieldMapping,
    sourceConfig.inputs,
    sourceConfig.parameters,
    sourceConfig.steps,
  ])

  const builtConfig = useMemo<PipelineConfiguration>(
    () => ({
      ...sourceConfig,
      configVersion: sourceConfig.configVersion ?? 1,
      description: description.trim() || null,
      parameters,
      ...(extraSteps.length ? { steps: extraSteps } : { steps: undefined }),
      inputs,
      transform: {
        language: sourceConfig.transform?.language ?? 'sql',
        statement: statement.trim(),
      },
      output: {
        ...(sourceConfig.output ?? {}),
        mode: outputMode,
        datasetName: datasetName.trim(),
        schemaVersionId:
          outputMode === 'create' ? schemaVersionId || undefined : undefined,
        datasetId: outputMode === 'append' ? datasetId || undefined : undefined,
        datasetLabel: datasetLabel.trim() || undefined,
        fieldMapping: outputMode === 'none' ? undefined : fieldMapping,
      },
    }),
    [
      sourceConfig,
      description,
      parameters,
      extraSteps,
      inputs,
      outputMode,
      statement,
      datasetName,
      schemaVersionId,
      datasetId,
      datasetLabel,
      fieldMapping,
    ],
  )

  // The shared contract validator mirrors `api.pipeline_config_errors`, so a
  // configuration the server would refuse is named here instead of after the
  // round-trip. Only the keys this page edits are shown; the server stays
  // authoritative for the rest.
  const configErrors = useMemo(
    () =>
      validatePipelineConfig(builtConfig).filter((error) =>
        EDITED_CONFIG_FIELDS.some(
          (field) =>
            error.field === field || error.field.startsWith(`${field}.`),
        ),
      ),
    [builtConfig],
  )

  const outputDraft: OutputDraft = {
    mode: outputMode,
    datasetName,
    schemaVersionId,
    datasetId,
    datasetLabel,
    fieldMapping,
  }
  const updateOutput = (patch: Partial<OutputDraft>) => {
    if (patch.mode !== undefined) {
      setOutputMode(patch.mode)
      // A new dataset starts with the pipeline's own name and a label to match.
      if (patch.mode !== 'none' && !datasetLabel.trim()) {
        setDatasetLabel(definition.data?.name ?? '')
      }
      if (patch.mode === 'create' && !datasetName.trim()) {
        setDatasetName(definition.data?.name ?? '')
      }
    }
    if (patch.datasetName !== undefined) setDatasetName(patch.datasetName)
    if (patch.schemaVersionId !== undefined)
      setSchemaVersionId(patch.schemaVersionId)
    if (patch.datasetId !== undefined) setDatasetId(patch.datasetId)
    if (patch.datasetLabel !== undefined) setDatasetLabel(patch.datasetLabel)
    if (patch.fieldMapping !== undefined) setFieldMapping(patch.fieldMapping)
  }
  // Errors the contract reports for the output, shown beside their control.
  const outputErrors = useMemo(() => {
    const byField: Record<string, string> = {}
    for (const error of configErrors) {
      if (error.field.startsWith('output.')) {
        byField[error.field.slice('output.'.length)] ??= error.message
      }
    }
    return byField
  }, [configErrors])
  // The columns of the newest successful run: suggestions and a fit check.
  const lastResultColumns = useMemo(() => {
    for (const run of runs.data ?? []) {
      if (run.status !== 'succeeded') continue
      const preview = readResultPreview(run.result)
      if (preview) return preview.columns
    }
    return []
  }, [runs.data])
  // Put a column reference into the SQL where the cursor is.
  const insertIntoTransform = (text: string) => {
    const el = transformRef.current
    const start = el?.selectionStart ?? statement.length
    const end = el?.selectionEnd ?? statement.length
    setStatement(statement.slice(0, start) + text + statement.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + text.length, start + text.length)
    })
  }

  const canSave = statement.trim().length > 0 && configErrors.length === 0

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })

  const saveDraft = useMutation({
    mutationFn: () =>
      draft
        ? notebookDataClient.rpc('update_pipeline_definition_version_draft', {
            p_workspace_id: workspaceId,
            p_version_id: draft.id,
            p_expected_revision: draft.revision,
            p_configuration: builtConfig,
          })
        : notebookDataClient.rpc('create_pipeline_definition_version', {
            p_workspace_id: workspaceId,
            p_definition_id: pipelineId,
            p_configuration: builtConfig,
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

  if (versions.isLoading) {
    return (
      <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        <p className="m-0 text-label text-fg-muted">Loading versions…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-4 md:px-6">
      <div className="flex items-center gap-2">
        <span className="text-label text-fg-muted">
          {draft
            ? `Editing draft v${draft.version}`
            : source
              ? `Editing published v${source.version} — saving creates a draft`
              : 'No version yet — saving creates the first draft (v1)'}
        </span>
        <span className="flex-1" />
        {draft ? (
          <Status tone="draft">Draft</Status>
        ) : source ? (
          <Status tone="ok">Published</Status>
        ) : (
          <Status tone="none">No version</Status>
        )}
      </div>

      <Section title="Inputs" count={inputs.length}>
        <InputsEditor
          inputs={inputs}
          onChange={setInputs}
          onInsert={insertIntoTransform}
        />
      </Section>

      <Section title="Parameters" count={parameters.length}>
        <ParametersEditor parameters={parameters} onChange={setParameters} />
      </Section>

      <Section title="Transform">
        <div className="flex flex-col gap-4">
          <Field label="Description" hint="What this pipeline is for.">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field
            label="SQL"
            hint={
              inputs.some((input) => input.name)
                ? `Read ${inputs
                    .filter((input) => input.name)
                    .map((input) => input.name)
                    .join(
                      ', ',
                    )} as tables. Write {{name}} where a parameter goes. The last SELECT is the result.`
                : 'Add an input to read a table. Write {{name}} where a parameter goes. The last SELECT is the result.'
            }
          >
            <textarea
              ref={transformRef}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={6}
              spellCheck={false}
              className="num w-full rounded-md border border-border bg-surface p-2 text-body text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
            />
          </Field>
        </div>
      </Section>

      <Section title="Further steps" count={extraSteps.length}>
        <StepsEditor
          steps={extraSteps}
          members={members.data ?? {}}
          onChange={setExtraSteps}
        />
      </Section>

      <Section title="Output">
        <OutputEditor
          value={outputDraft}
          onChange={updateOutput}
          resultColumns={lastResultColumns}
          fieldErrors={outputErrors}
        />
      </Section>

      {configErrors.length ? (
        <Notice tone="bad" title="This version cannot be saved yet">
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
            {configErrors.map((error) => (
              <li key={`${error.field}:${error.message}`}>{error.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={saveDraft.isPending || !canSave}
          onClick={() => saveDraft.mutate()}
        >
          {saveDraft.isPending
            ? 'Saving…'
            : draft
              ? 'Save draft'
              : source
                ? 'Save as draft'
                : 'Create draft v1'}
        </Button>
        {draft ? (
          <Button
            disabled={publish.isPending || !canSave}
            onClick={() => publish.mutate()}
          >
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
