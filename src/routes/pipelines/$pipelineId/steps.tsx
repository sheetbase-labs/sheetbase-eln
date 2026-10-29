import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { rich, t } from '#/copy'
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
      ? (runtime.data?.message ?? t('data.pipelineSteps.pythonAvailableYetAsk'))
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
      toast(
        draft
          ? t('data.pipelineSteps.draftUpdated')
          : t('data.pipelineSteps.draftVersionCreated'),
      )
      void invalidate()
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('data.pipelineSteps.couldnTSave'),
      ),
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
        error instanceof Error
          ? error.message
          : t('data.pipelineSteps.couldnTTryDraft'),
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
      if (!draft) throw new Error(t('data.pipelineSteps.draftPublish'))
      return notebookDataClient.rpc('publish_pipeline_definition_version', {
        p_workspace_id: workspaceId,
        p_version_id: draft.id,
      })
    },
    onSuccess: () => {
      toast(t('data.pipelineSteps.versionPublished'))
      void invalidate()
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('data.pipelineSteps.couldnTPublish'),
      ),
  })

  if (versions.isLoading) {
    return (
      <div className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        <p className="m-0 text-label text-fg-muted">
          {t('data.pipelineSteps.loadingVersions')}
        </p>
      </div>
    )
  }

  return (
    <div className="@container/pipeline flex min-h-0 min-w-0 w-full flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-label text-fg-muted">
          {draft
            ? t('data.pipelineSteps.editingDraftV', { version: draft.version })
            : source
              ? t('data.pipelineSteps.workingCopyFromV', {
                  version: source.version,
                })
              : t('data.pipelineSteps.workingCopySaveCreate')}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto @min-[760px]/pipeline:grid-cols-[200px_minmax(0,1fr)] @min-[760px]/pipeline:overflow-hidden">
        <nav
          aria-label={t('data.pipelineSteps.ariaPipelineConfiguration')}
          className="hidden flex-col gap-4 overflow-auto border-r border-border bg-surface-subtle p-3 @min-[760px]/pipeline:flex"
        >
          <Button
            variant="quiet"
            aria-pressed={active === 'inputs'}
            className={`justify-start ${active === 'inputs' ? 'bg-selection' : ''}`}
            onClick={() => setSelected('inputs')}
          >
            {t('data.pipelineSteps.inputs')}{' '}
            <span className="ml-auto num text-fg-muted">{inputs.length}</span>
          </Button>
          <div className="flex flex-col gap-2">
            <h2 className="m-0 px-2 text-label font-medium text-fg-muted">
              {t('data.pipelineSteps.executionOrder')}
            </h2>
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              <li>
                <Button
                  variant="quiet"
                  aria-pressed={active === 'transform'}
                  className={`w-full justify-start ${active === 'transform' ? 'bg-selection' : ''}`}
                  onClick={() => setSelected('transform')}
                >
                  <span className="num text-fg-muted">1</span>{' '}
                  {t('data.pipelineSteps.transform')}{' '}
                  <span className="ml-auto text-label text-fg-muted">
                    {language === 'none'
                      ? t('data.pipelineSteps.off')
                      : language.toUpperCase()}
                  </span>
                </Button>
              </li>
              {extraSteps.map((step, index) => (
                <li key={index}>
                  <Button
                    variant="quiet"
                    aria-label={t('data.pipelineSteps.ariaEditStep', {
                      value: index + 1,
                      name: step.name,
                    })}
                    aria-pressed={active === index}
                    className={`w-full justify-start ${active === index ? 'bg-selection' : ''}`}
                    onClick={() => setSelected(index)}
                  >
                    <span className="num text-fg-muted">{index + 2}</span>
                    <span className="truncate">{step.name}</span>
                    <span className="ml-auto text-label text-fg-muted">
                      {step.confirm
                        ? t('data.pipelineSteps.pause')
                        : step.language.toUpperCase()}
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
              {t('data.pipelineSteps.addStep')}
            </Button>
          </div>
          <div className="border-t border-border pt-3">
            <Button
              variant="quiet"
              aria-pressed={active === 'output'}
              className={`w-full justify-start ${active === 'output' ? 'bg-selection' : ''}`}
              onClick={() => setSelected('output')}
            >
              {t('data.pipelineSteps.output')}{' '}
              <span className="ml-auto text-label text-fg-muted">
                {outputMode === 'none'
                  ? t('data.pipelineSteps.previewOnly')
                  : outputMode === 'create'
                    ? t('common.actions.create')
                    : t('data.pipelineSteps.append')}
              </span>
            </Button>
          </div>
          <p className="m-0 mt-auto px-2 text-label text-fg-muted">
            {t('data.pipelineSteps.stepsRunOrderEach')} <code>previous</code>.
          </p>
        </nav>
        <div
          ref={workAreaRef}
          className="flex min-h-0 min-w-0 flex-col overflow-auto"
        >
          <div className="flex shrink-0 items-end gap-2 border-b border-border px-4 py-3 @min-[760px]/pipeline:hidden">
            <Field
              label={t('data.pipelineSteps.pipelineSection')}
              className="min-w-0 flex-1"
            >
              <Select
                aria-label={t('data.pipelineSteps.pipelineSection')}
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
                <option value="inputs">
                  {t('data.pipelineSteps.inputs2', { length: inputs.length })}
                </option>
                <option value="transform">
                  {t('data.pipelineSteps.n1Transform')}
                </option>
                {extraSteps.map((step, index) => (
                  <option key={index} value={`step-${index}`}>
                    {index + 2}. {step.name}
                  </option>
                ))}
                <option value="output">{t('data.pipelineSteps.output')}</option>
              </Select>
            </Field>
            <Button
              size="sm"
              icon="plus"
              aria-label={t('data.pipelineSteps.ariaAddPipelineStep')}
              disabled={extraSteps.length >= 9}
              onClick={addFurtherStep}
            >
              {t('data.pipelineSteps.addStep')}
            </Button>
          </div>
          <div className="flex flex-col gap-5 px-4 py-4 md:px-6">
            <div
              hidden={active !== 'inputs'}
              className="flex flex-col gap-5 [&[hidden]]:hidden"
            >
              <Section
                title={t('data.pipelineSteps.inputs')}
                count={inputs.length}
              >
                <p className="m-0 text-label text-fg-muted">
                  {t('data.pipelineSteps.optionalDatasetSnapshotsAvailable')}
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
              <Section title={t('data.pipelineSteps.transform')}>
                <p className="m-0 text-body text-fg-muted">
                  {t('data.pipelineSteps.firstOperationPipelineTry')}
                </p>
                <div className="flex flex-col gap-4">
                  <Field
                    label={t('data.pipelineSteps.language')}
                    className="w-full max-w-48"
                  >
                    <Select
                      aria-label={t('data.pipelineSteps.ariaTransformLanguage')}
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
                      <option value="sql">{t('data.pipelineSteps.sql')}</option>
                      <option value="python">
                        {t('data.pipelineSteps.python')}
                      </option>
                      {language === 'none' ? (
                        <option value="none">{t('common.states.none')}</option>
                      ) : null}
                    </Select>
                  </Field>
                  {language === 'python' ? (
                    <PythonStepEditor
                      label={t('data.pipelineSteps.transform')}
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
                      label={t('data.pipelineSteps.code')}
                      hint={t('data.pipelineSteps.useSelectOverNamed')}
                    >
                      <SqlEditor
                        ref={transformRef}
                        aria-label={t('data.pipelineSteps.ariaTransformCode')}
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
                    ? t('data.pipelineSteps.step', {
                        value: active + 2,
                        name: extraSteps[active]?.name,
                      })
                    : t('data.pipelineSteps.furtherSteps')
                }
              >
                <p className="m-0 text-body text-fg-muted">
                  {rich('data.pipelineSteps.runsAfterPrecedingStep', {
                    code: (text) => <code>{text}</code>,
                  })}
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
              <Section title={t('data.pipelineSteps.output')}>
                <p className="m-0 text-body text-fg-muted">
                  {t('data.pipelineSteps.chooseWhetherRealRun')}
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
              <Notice
                tone="bad"
                title={t('data.pipelineSteps.pythonAvailable')}
              >
                {pythonUnavailable}
              </Notice>
            ) : null}

            <section
              aria-label={t('data.pipelineSteps.ariaDraftPreview')}
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
                  <h2 className="m-0 text-body font-medium">
                    {t('data.pipelineSteps.ariaDraftPreview')}
                  </h2>
                  <p className="m-0 text-label text-fg-muted">
                    {t('data.pipelineSteps.tryWholePipelineSee')}
                  </p>
                </div>
              )}
            </section>

            <details className="border-t border-border pt-3 text-body">
              <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-focus">
                {t('data.pipelineSteps.runParameters', {
                  length: parameters.length,
                })}
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <p className="m-0 text-label text-fg-muted">
                  {t('data.pipelineSteps.optionalValuesSuppliedWhen')}
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
                  {t('data.pipelineSteps.pythonPackages', {
                    length: requirements.length,
                  })}
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
                {t('data.pipelineSteps.authorLocalPythonFile')}
              </summary>
              <div className="mt-3 flex min-w-0 flex-col gap-3">
                <p className="m-0 text-fg-muted">
                  {t('data.pipelineSteps.keepPyIpynbFile')}
                </p>
                <CodeBlock
                  language="shell"
                  label={t('data.pipelineSteps.pushLocalPythonStep')}
                  code={`sheetbase push-step analysis.py --workspace ${workspaceId} --pipeline ${pipelineId}`}
                />
                <p className="m-0 text-fg-muted">
                  {source
                    ? t('data.pipelineSteps.updatesExistingDraftCreates')
                    : t('data.pipelineSteps.saveFirstDraftBelow')}{' '}
                  {t('data.pipelineSteps.addStepFollowedStep')}
                </p>
              </div>
            </details>

            <details className="border-t border-border pt-3 text-body">
              <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-focus">
                {t('data.pipelineSteps.pipelineDescription')}
              </summary>
              <div className="mt-3">
                <Field
                  label={t('data.pipelineSteps.description')}
                  hint={t('data.pipelineSteps.whatPipeline')}
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
              <Notice
                tone="bad"
                title={t('data.pipelineSteps.versionCannotSavedYet')}
              >
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
            ? t('common.states.saving')
            : draft
              ? t('data.pipelineSteps.saveDraft')
              : source
                ? t('data.pipelineSteps.saveDraft2')
                : t('data.pipelineSteps.createDraftV1')}
        </Button>
        <Button
          icon="play"
          disabled={tryDraft.isPending || !canSave}
          onClick={startTrial}
        >
          {tryDraft.isPending
            ? t('data.pipelineSteps.trying')
            : t('data.pipelineSteps.tryDraft')}
        </Button>
        {draft ? (
          <Button
            disabled={publish.isPending || !canSave}
            onClick={() => publish.mutate()}
          >
            {publish.isPending
              ? t('data.pipelineSteps.publishing')
              : t('data.pipelineSteps.publishSavedDraft')}
          </Button>
        ) : null}
        <Button
          nativeButton={false}
          render={
            <Link to="/pipelines/$pipelineId/runs" params={{ pipelineId }} />
          }
        >
          {t('data.pipelineSteps.pipelineRuns')}
        </Button>
        <p className="m-0 w-full text-label text-fg-muted">
          {t('data.pipelineSteps.tryDraftRunsAll')}
        </p>
      </div>
      {trialDialog ? (
        <RunDialog
          trial
          pipelineName={
            definition.data?.name ?? t('data.pipelineSteps.thisPipeline')
          }
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
