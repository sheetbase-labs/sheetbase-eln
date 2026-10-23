import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '#/components/v3/ui/button'
import { CodeBlock } from '#/components/v3/ui/code-block'
import { Field, Input } from '#/components/v3/ui/input'
import { Select } from '#/components/v3/ui/select'
import { Notice } from '#/components/v3/ui/alert'
import { Section } from '#/components/v3/ui/layout'
import { toast } from '#/components/v3/ui/sonner'
import { ParametersEditor } from '#/components/v3/pipelines/parameters-editor'
import {
  PythonPackagesEditor,
  PythonStepEditor,
} from '#/components/v3/pipelines/python-editor'
import { SqlEditor } from '#/components/v3/pipelines/sql-editor'
import { StepsEditor } from '#/components/v3/pipelines/steps-editor'
import { InputsEditor } from '#/components/v3/pipelines/inputs-editor'
import { OutputEditor } from '#/components/v3/pipelines/output-editor'
import { RunDialog } from '#/components/v3/pipelines/run-dialog'
import type { RunDetails } from '#/components/v3/pipelines/run-dialog'
import { TrialPanel } from '#/components/v3/pipelines/trial-panel'
import type {
  OutputDraft,
  OutputMode,
} from '#/components/v3/pipelines/output-editor'
import {
  draftVersion,
  usePythonRuntime,
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
import { addStep, statementForLanguage } from '#/lib/pipelines/authoring'
import { unmetRequirements } from '#/lib/pipelines/python'
import type { PythonContract } from '#/lib/pipelines/python'
import { notebookDataClient } from '#/lib/notebook-data'
import { tryPipelineDraft } from '#/lib/pipelines/data'
import type {
  PipelineDefinitionVersionWire,
  PipelineTrialWire,
} from '#/lib/pipelines/types'
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
  transform?: {
    language?: string
    statement?: string
    contract?: PythonContract
  }
  pythonRuntime?: string
  pythonRequirements?: string[]
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
  'pythonRuntime',
  'pythonRequirements',
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
  const [language, setLanguage] = useState('sql')
  const [transformContract, setTransformContract] = useState<
    PythonContract | undefined
  >()
  const [requirements, setRequirements] = useState<string[]>([])
  const [datasetName, setDatasetName] = useState('')
  const [inputs, setInputs] = useState<PipelineInput[]>([])
  const [parameters, setParameters] = useState<PipelineParameter[]>([])
  const [extraSteps, setExtraSteps] = useState<PipelineStep[]>([])
  const [selected, setSelected] = useState<
    'inputs' | 'transform' | 'output' | number
  >('transform')
  const active =
    typeof selected === 'number' && !extraSteps[selected]
      ? 'transform'
      : selected
  const workAreaRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (workAreaRef.current) workAreaRef.current.scrollTop = 0
  }, [active])
  const addFurtherStep = () => {
    setExtraSteps(addStep(extraSteps))
    setSelected(extraSteps.length)
  }
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
    setLanguage(sourceConfig.transform?.language ?? 'sql')
    setTransformContract(sourceConfig.transform?.contract)
    setRequirements(sourceConfig.pythonRequirements ?? [])
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
    sourceConfig.transform?.language,
    sourceConfig.transform?.contract,
    sourceConfig.pythonRequirements,
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

  // A saved version pins the immutable Python image it was written against, so
  // the editor supplies it: the one installed now, or the version's existing pin
  // when the runner cannot be reached.
  const runtime = usePythonRuntime()
  const usesPython =
    language === 'python' || extraSteps.some((s) => s.language === 'python')
  const pythonRuntime = usesPython
    ? runtime.data?.available
      ? runtime.data.runtime
      : sourceConfig.pythonRuntime
    : undefined
  const pythonUnavailable =
    usesPython && !pythonRuntime && !runtime.isLoading
      ? (runtime.data?.message ??
        'Python is not available yet. Ask your administrator to connect a Python runner.')
      : null

  const builtConfig = useMemo<PipelineConfiguration>(
    () => ({
      ...sourceConfig,
      pythonRuntime,
      pythonRequirements:
        usesPython && requirements.length ? requirements : undefined,
      configVersion: sourceConfig.configVersion ?? 1,
      description: description.trim() || null,
      parameters,
      ...(extraSteps.length ? { steps: extraSteps } : { steps: undefined }),
      inputs,
      transform: {
        language,
        statement: statement.trim(),
        ...(language === 'python' && transformContract
          ? { contract: transformContract }
          : {}),
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
      pythonRuntime,
      usesPython,
      requirements,
      transformContract,
      language,
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
    () => [
      ...validatePipelineConfig(builtConfig).filter((error) =>
        EDITED_CONFIG_FIELDS.some(
          (field) =>
            error.field === field ||
            error.field.startsWith(`${field}.`) ||
            error.field.startsWith(`${field}[`),
        ),
      ),
      // The runner only ever has the packages baked into its image, so a
      // declaration it cannot meet is caught here rather than at the first run.
      ...(usesPython && runtime.data?.packages
        ? unmetRequirements(requirements, runtime.data.packages).map(
            (message) => ({
              code: 'invalid_value' as const,
              field: 'pythonRequirements',
              message,
            }),
          )
        : []),
    ],
    [builtConfig, usesPython, requirements, runtime.data?.packages],
  )

  const canSave =
    statement.trim().length > 0 &&
    configErrors.length === 0 &&
    !pythonUnavailable
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

  // Try draft: run what is on screen, unsaved, and show the result inline.
  const [trialDialog, setTrialDialog] = useState(false)
  const [trialDetails, setTrialDetails] = useState<RunDetails | null>(null)
  const [trialResult, setTrialResult] = useState<{
    report: PipelineTrialWire
    ranWith: string
  } | null>(null)
  const configKey = JSON.stringify(builtConfig)
  const tryDraft = useMutation({
    mutationFn: (details: RunDetails) =>
      tryPipelineDraft({
        workspaceId,
        configuration: builtConfig,
        inputVersions: details.inputVersions,
        parameters: details.parameters,
      }),
    onSuccess: (report) => {
      setTrialDialog(false)
      setTrialResult({ report, ranWith: configKey })
    },
    onError: (error: unknown) => {
      setTrialDialog(false)
      toast.error(
        error instanceof Error ? error.message : 'Couldn’t try the draft.',
      )
    },
  })
  const startTrial = () => {
    const { inputs: declared, parameters: declaredParameters } = builtConfig
    if (!declared?.length && !declaredParameters?.length) {
      const empty = { inputVersions: {}, parameters: {} }
      setTrialDetails(empty)
      tryDraft.mutate(empty)
      return
    }
    setTrialDialog(true)
  }
  const submitTrial = (details: RunDetails) => {
    setTrialDetails(details)
    tryDraft.mutate(details)
  }
  // The dialog reads what the draft declares, not what was last saved.
  const draftAsVersion = {
    id: draft?.id ?? 'draft',
    version: draft?.version ?? 0,
    configuration: builtConfig,
  } as unknown as PipelineDefinitionVersionWire

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
    <div className="@container/pipeline flex min-h-0 min-w-0 w-full flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-label text-fg-muted">
          {draft
            ? `Editing draft v${draft.version}`
            : source
              ? `Working copy from v${source.version} · Saving creates a draft`
              : 'Working copy · Save to create the first draft (v1)'}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto @min-[760px]/pipeline:grid-cols-[200px_minmax(0,1fr)] @min-[760px]/pipeline:overflow-hidden">
        <nav
          aria-label="Pipeline configuration"
          className="hidden flex-col gap-4 overflow-auto border-r border-border bg-surface-subtle p-3 @min-[760px]/pipeline:flex"
        >
          <Button
            variant="quiet"
            aria-pressed={active === 'inputs'}
            className={`justify-start ${active === 'inputs' ? 'bg-selection' : ''}`}
            onClick={() => setSelected('inputs')}
          >
            Inputs{' '}
            <span className="ml-auto num text-fg-muted">{inputs.length}</span>
          </Button>
          <div className="flex flex-col gap-2">
            <h2 className="m-0 px-2 text-label font-medium text-fg-muted">
              Execution order
            </h2>
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              <li>
                <Button
                  variant="quiet"
                  aria-pressed={active === 'transform'}
                  className={`w-full justify-start ${active === 'transform' ? 'bg-selection' : ''}`}
                  onClick={() => setSelected('transform')}
                >
                  <span className="num text-fg-muted">1</span> Transform{' '}
                  <span className="ml-auto text-label text-fg-muted">
                    {language === 'none' ? 'Off' : language.toUpperCase()}
                  </span>
                </Button>
              </li>
              {extraSteps.map((step, index) => (
                <li key={index}>
                  <Button
                    variant="quiet"
                    aria-label={`Edit step ${index + 1}: ${step.name}`}
                    aria-pressed={active === index}
                    className={`w-full justify-start ${active === index ? 'bg-selection' : ''}`}
                    onClick={() => setSelected(index)}
                  >
                    <span className="num text-fg-muted">{index + 2}</span>
                    <span className="truncate">{step.name}</span>
                    <span className="ml-auto text-label text-fg-muted">
                      {step.confirm ? 'Pause' : step.language.toUpperCase()}
                    </span>
                  </Button>
                </li>
              ))}
            </ol>
            <Button
              size="sm"
              variant="quiet"
              icon="plus"
              className="justify-start"
              disabled={extraSteps.length >= 9}
              onClick={addFurtherStep}
            >
              Add step
            </Button>
          </div>
          <div className="border-t border-border pt-3">
            <Button
              variant="quiet"
              aria-pressed={active === 'output'}
              className={`w-full justify-start ${active === 'output' ? 'bg-selection' : ''}`}
              onClick={() => setSelected('output')}
            >
              Output{' '}
              <span className="ml-auto text-label text-fg-muted">
                {outputMode === 'none'
                  ? 'Preview only'
                  : outputMode === 'create'
                    ? 'Create'
                    : 'Append'}
              </span>
            </Button>
          </div>
          <p className="m-0 mt-auto px-2 text-label text-fg-muted">
            Steps run in order. Each further step reads the previous result as{' '}
            <code>previous</code>.
          </p>
        </nav>
        <div
          ref={workAreaRef}
          className="flex min-h-0 min-w-0 flex-col overflow-auto"
        >
          <div className="flex shrink-0 items-end gap-2 border-b border-border px-4 py-3 @min-[760px]/pipeline:hidden">
            <Field label="Pipeline section" className="min-w-0 flex-1">
              <Select
                aria-label="Pipeline section"
                value={typeof active === 'number' ? `step-${active}` : active}
                onChange={(event) => {
                  const value = event.target.value
                  setSelected(
                    value === 'inputs' ||
                      value === 'transform' ||
                      value === 'output'
                      ? value
                      : Number(value.slice(5)),
                  )
                }}
              >
                <option value="inputs">Inputs ({inputs.length})</option>
                <option value="transform">1. Transform</option>
                {extraSteps.map((step, index) => (
                  <option key={index} value={`step-${index}`}>
                    {index + 2}. {step.name}
                  </option>
                ))}
                <option value="output">Output</option>
              </Select>
            </Field>
            <Button
              size="sm"
              icon="plus"
              aria-label="Add pipeline step"
              disabled={extraSteps.length >= 9}
              onClick={addFurtherStep}
            >
              Add step
            </Button>
          </div>
          <div className="flex flex-col gap-5 px-4 py-4 md:px-6">
            <div
              hidden={active !== 'inputs'}
              className="flex flex-col gap-5 [&[hidden]]:hidden"
            >
              <Section title="Inputs" count={inputs.length}>
                <p className="m-0 text-label text-fg-muted">
                  Optional dataset snapshots available to every step. Choose
                  examples to inspect their columns.
                </p>
                <InputsEditor
                  inputs={inputs}
                  onChange={setInputs}
                  onInsert={(text) => {
                    insertIntoTransform(text)
                    setSelected('transform')
                  }}
                />
              </Section>
            </div>

            <div
              hidden={active !== 'transform'}
              className="flex flex-col gap-4 [&[hidden]]:hidden"
            >
              <Section title="Transform">
                <p className="m-0 text-body text-fg-muted">
                  The first operation in your pipeline. Try the working copy to
                  inspect its result without saving.
                </p>
                <div className="flex flex-col gap-4">
                  <Field label="Language" className="w-full max-w-48">
                    <Select
                      aria-label="Transform language"
                      value={language}
                      onChange={(event) => {
                        const next = event.target.value
                        setStatement((current) =>
                          next === 'sql' || next === 'python'
                            ? statementForLanguage(current, next, {
                                inputs,
                                parameters,
                              })
                            : current,
                        )
                        setLanguage(next)
                      }}
                    >
                      <option value="sql">SQL</option>
                      <option value="python">Python</option>
                      {language === 'none' ? (
                        <option value="none">None</option>
                      ) : null}
                    </Select>
                  </Field>
                  {language === 'python' ? (
                    <PythonStepEditor
                      label="Transform"
                      statement={statement}
                      onStatementChange={setStatement}
                      contract={transformContract}
                      onContractChange={setTransformContract}
                      inputs={inputs}
                      parameters={parameters}
                      hasPrevious={false}
                      runtime={runtime.data}
                      requirements={requirements}
                    />
                  ) : (
                    <Field
                      label="Code"
                      hint="Use SELECT over named inputs, or start without inputs, for example SELECT 2 AS value."
                    >
                      <SqlEditor
                        ref={transformRef}
                        aria-label="Transform code"
                        value={statement}
                        onChange={(e) => setStatement(e.target.value)}
                        rows={12}
                      />
                    </Field>
                  )}
                </div>
              </Section>
            </div>

            <div
              hidden={typeof active !== 'number'}
              className="flex flex-col gap-4 [&[hidden]]:hidden"
            >
              <Section
                title={
                  typeof active === 'number'
                    ? `Step ${active + 2} · ${extraSteps[active]?.name}`
                    : 'Further steps'
                }
              >
                <p className="m-0 text-body text-fg-muted">
                  Runs after the preceding step. Read its result as{' '}
                  <code>previous</code>, or pause for a person to confirm.
                </p>
                <StepsEditor
                  steps={extraSteps}
                  activeIndex={typeof active === 'number' ? active : 0}
                  showAdd={false}
                  members={members.data ?? {}}
                  onChange={(next) => {
                    if (typeof active === 'number') {
                      const moved = next.indexOf(extraSteps[active])
                      setSelected(
                        moved >= 0
                          ? moved
                          : next.length
                            ? Math.min(active, next.length - 1)
                            : 'transform',
                      )
                    }
                    setExtraSteps(next)
                  }}
                  python={{
                    runtime: runtime.data,
                    inputs,
                    parameters,
                    requirements,
                    transformRuns: language !== 'none',
                  }}
                />
              </Section>
            </div>

            <div
              hidden={active !== 'output'}
              className="flex flex-col gap-4 [&[hidden]]:hidden"
            >
              <Section title="Output">
                <p className="m-0 text-body text-fg-muted">
                  Choose whether a real run keeps the final result in a dataset.
                  Trying a draft never writes output.
                </p>
                <OutputEditor
                  value={outputDraft}
                  onChange={updateOutput}
                  resultColumns={lastResultColumns}
                  fieldErrors={outputErrors}
                />
              </Section>
            </div>

            {pythonUnavailable ? (
              <Notice tone="bad" title="Python is not available">
                {pythonUnavailable}
              </Notice>
            ) : null}

            <section
              aria-label="Draft preview"
              className="border-t border-border pt-4"
              aria-live="polite"
            >
              {trialResult ? (
                <TrialPanel
                  result={trialResult.report}
                  stale={trialResult.ranWith !== configKey}
                  onTryAgain={() =>
                    trialDetails ? tryDraft.mutate(trialDetails) : startTrial()
                  }
                />
              ) : (
                <div className="flex flex-col gap-1">
                  <h2 className="m-0 text-body font-medium">Draft preview</h2>
                  <p className="m-0 text-label text-fg-muted">
                    Try the whole pipeline to see results or errors here.
                    Nothing will be saved.
                  </p>
                </div>
              )}
            </section>

            <details className="border-t border-border pt-3 text-body">
              <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-focus">
                Run parameters · {parameters.length}
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <p className="m-0 text-label text-fg-muted">
                  Optional values supplied when someone starts a run. Available
                  to every step.
                </p>
                <ParametersEditor
                  parameters={parameters}
                  onChange={setParameters}
                />
              </div>
            </details>
            {usesPython ? (
              <details className="border-t border-border pt-3 text-body">
                <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-focus">
                  Python packages · {requirements.length}
                </summary>
                <div className="mt-3">
                  <PythonPackagesEditor
                    requirements={requirements}
                    onChange={setRequirements}
                    runtime={runtime.data}
                  />
                </div>
              </details>
            ) : null}
            <details className="border-t border-border pt-3 text-body">
              <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-focus">
                Author with a local Python file or notebook
              </summary>
              <div className="mt-3 flex min-w-0 flex-col gap-3">
                <p className="m-0 text-fg-muted">
                  Keep your .py or .ipynb file in your own repository. With the
                  Python SDK installed, set SHEETBASE_URL and
                  SHEETBASE_CREDENTIAL securely. Use a personal token with
                  pipelines:read and pipelines:write.
                </p>
                <CodeBlock
                  language="shell"
                  label="Push a local Python step"
                  code={`sheetbase push-step analysis.py --workspace ${workspaceId} --pipeline ${pipelineId}`}
                />
                <p className="m-0 text-fg-muted">
                  {source
                    ? 'This updates an existing draft, or creates a draft from the latest version.'
                    : 'Save the first draft below before using push-step, or create it with the SDK’s create_draft method.'}{' '}
                  Add --step followed by a step name to update a named step.
                  Pushing never publishes, and does not automatically sync your
                  repository.
                </p>
              </div>
            </details>

            <details className="border-t border-border pt-3 text-body">
              <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-focus">
                Pipeline description
              </summary>
              <div className="mt-3">
                <Field
                  label="Description"
                  hint="What this pipeline is for."
                  className="max-w-2xl"
                >
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field>
              </div>
            </details>

            {configErrors.length ? (
              <Notice tone="bad" title="This version cannot be saved yet">
                <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                  {configErrors.map((error) => (
                    <li key={`${error.field}:${error.message}`}>
                      {error.message}
                    </li>
                  ))}
                </ul>
              </Notice>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface px-4 py-3 md:px-6">
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
        <Button
          icon="play"
          disabled={tryDraft.isPending || !canSave}
          onClick={startTrial}
        >
          {tryDraft.isPending ? 'Trying…' : 'Try draft'}
        </Button>
        {draft ? (
          <Button
            disabled={publish.isPending || !canSave}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? 'Publishing…' : 'Publish saved draft'}
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
        <p className="m-0 w-full text-label text-fg-muted">
          Try draft runs all steps without saving. Publishing uses the saved
          draft; save your edits first.
        </p>
      </div>
      {trialDialog ? (
        <RunDialog
          trial
          pipelineName={definition.data?.name ?? 'this pipeline'}
          version={draftAsVersion}
          initial={trialDetails ?? undefined}
          busy={tryDraft.isPending}
          onClose={() => setTrialDialog(false)}
          onSubmit={submitTrial}
        />
      ) : null}
    </div>
  )
}
