import { useEffect, useMemo, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { Checkbox } from '#/components/v3/ui/checkbox'
import { Field, Input } from '#/components/v3/ui/input'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
import { Status } from '#/components/v3/ui/status'
import { toast } from '#/components/v3/ui/sonner'
import { Select } from '#/components/v3/ui/select'
import {
  draftVersion,
  usePipelineOutputTargets,
  usePipelineVersions,
} from '#/components/v3/pipelines/pipelines-data'
import {
  INPUT_NAME_RE,
  MAX_INPUTS,
  validatePipelineConfig,
} from '#/lib/pipelines/config'
import type { PipelineInput } from '#/lib/pipelines/config'
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

type OutputMode = 'create' | 'append' | 'none'

interface PipelineConfiguration {
  configVersion?: number
  description?: string | null
  parameters?: unknown[]
  inputs?: PipelineInput[]
  transform?: { language?: string; statement?: string }
  output?: {
    mode?: OutputMode
    schemaVersionId?: string
    datasetId?: string
    datasetName?: string
    datasetLabel?: string
    fieldMapping?: unknown
  }
}

/** The configuration keys this page edits; other errors are the server's to report. */
const EDITED_CONFIG_FIELDS = [
  'description',
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
  const [outputMode, setOutputMode] = useState<OutputMode>('none')
  const [schemaVersionId, setSchemaVersionId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [datasetLabel, setDatasetLabel] = useState('')
  const targets = usePipelineOutputTargets()

  const sourceId = source?.id
  const sourceConfig = (source?.configuration ?? {}) as PipelineConfiguration
  useEffect(() => {
    setDescription(sourceConfig.description ?? '')
    setStatement(sourceConfig.transform?.statement ?? '')
    setDatasetName(sourceConfig.output?.datasetName ?? '')
    setInputs(sourceConfig.inputs ?? [])
    setOutputMode(sourceConfig.output?.mode ?? 'none')
    setSchemaVersionId(sourceConfig.output?.schemaVersionId ?? '')
    setDatasetId(sourceConfig.output?.datasetId ?? '')
    setDatasetLabel(sourceConfig.output?.datasetLabel ?? '')
  }, [
    sourceId,
    sourceConfig.description,
    sourceConfig.transform?.statement,
    sourceConfig.output?.datasetName,
    sourceConfig.output?.mode,
    sourceConfig.output?.schemaVersionId,
    sourceConfig.output?.datasetId,
    sourceConfig.output?.datasetLabel,
    sourceConfig.inputs,
  ])

  const builtConfig = useMemo<PipelineConfiguration>(
    () => ({
      ...sourceConfig,
      configVersion: sourceConfig.configVersion ?? 1,
      description: description.trim() || null,
      parameters: sourceConfig.parameters ?? [],
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
      },
    }),
    [
      sourceConfig,
      description,
      inputs,
      outputMode,
      statement,
      datasetName,
      schemaVersionId,
      datasetId,
      datasetLabel,
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
          <div className="flex flex-col gap-2">
            {inputs.map((input, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <Input
                  className="mono h-8 w-[200px] text-xs"
                  aria-label={`Input ${index + 1} name`}
                  placeholder="e.g. readings"
                  value={input.name}
                  onChange={(event) =>
                    setInputs((current) =>
                      current.map((item, position) =>
                        position === index
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <label className="flex items-center gap-1.5 text-body">
                  <Checkbox
                    aria-label={`Input ${index + 1} required`}
                    checked={input.required}
                    onCheckedChange={(on) =>
                      setInputs((current) =>
                        current.map((item, position) =>
                          position === index
                            ? { ...item, required: Boolean(on) }
                            : item,
                        ),
                      )
                    }
                  />
                  Required
                </label>
                <Button
                  size="sm"
                  variant="quiet"
                  aria-label={`Remove input ${index + 1}`}
                  onClick={() =>
                    setInputs((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                >
                  Remove
                </Button>
                {input.name && !INPUT_NAME_RE.test(input.name) ? (
                  <span role="alert" className="text-label text-danger-text">
                    Lower-case letters, numbers and _, starting with a letter.
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-label text-fg-muted">No inputs declared.</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            icon="plus"
            disabled={inputs.length >= MAX_INPUTS}
            onClick={() =>
              setInputs((current) => [
                ...current,
                { name: '', required: false },
              ])
            }
          >
            Add input
          </Button>
          <span className="text-label text-fg-muted">
            Each input is a table the transform reads by name; up to{' '}
            {MAX_INPUTS}.
          </span>
        </div>
      </Section>

      <Section title="Output">
        <div className="flex flex-col gap-4">
          <Field
            label="Mode"
            hint="What the run leaves behind. Keep a dataset to make each successful run write a new Dataset Version."
          >
            <Select
              aria-label="Output mode"
              value={outputMode}
              onChange={(event) =>
                setOutputMode(event.target.value as OutputMode)
              }
            >
              <option value="none">None — keep no dataset output</option>
              <option value="create">Create a new dataset</option>
              <option value="append">Append to an existing dataset</option>
            </Select>
          </Field>
          {outputMode === 'create' ? (
            <>
              <Field label="Dataset name">
                <Input
                  aria-label="Dataset name"
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                />
              </Field>
              <Field
                label="Dataset schema version"
                hint="The published schema the new dataset is built from."
              >
                <Select
                  aria-label="Dataset schema version"
                  value={schemaVersionId}
                  onChange={(e) => setSchemaVersionId(e.target.value)}
                >
                  <option value="">Choose a schema version…</option>
                  {(targets.data?.schemaVersions ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          {outputMode === 'append' ? (
            <Field
              label="Dataset"
              hint="The dataset each run adds a version to."
            >
              <Select
                aria-label="Dataset"
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
              >
                <option value="">Choose a dataset…</option>
                {(targets.data?.datasets ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.displayId ? `${d.displayId} · ${d.name}` : d.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {outputMode !== 'none' ? (
            <Field
              label="Dataset version label"
              hint="Names each version a run writes, for example “Weekly readings”."
            >
              <Input
                aria-label="Dataset version label"
                value={datasetLabel}
                onChange={(e) => setDatasetLabel(e.target.value)}
              />
            </Field>
          ) : (
            <p className="m-0 text-label text-fg-muted">
              The run keeps its result in the run record only.
            </p>
          )}
          {outputMode !== 'none' && targets.isError ? (
            <Notice tone="bad" title="Couldn’t load datasets and schemas">
              The choices above come from the workspace’s datasets.{' '}
              <Button size="sm" onClick={() => void targets.refetch()}>
                Try again
              </Button>
            </Notice>
          ) : null}
        </div>
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
