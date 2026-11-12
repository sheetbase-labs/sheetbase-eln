import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  configurationErrors,
  configurationForWire,
  editorConfiguration,
  editorShowsVersion,
} from '../-configuration'
import type { PipelineConfiguration } from '../-configuration'
import { rich, t } from '#/copy'
import { Button } from '#/components/ui/button'
import { CodeBlock } from '#/components/ui/code-block'
import { Field, Input } from '#/components/ui/input'
import { Select } from '#/components/ui/select'
import { Notice } from '#/components/ui/alert'
import { Section } from '#/components/ui/layout'
import { toast } from '#/components/ui/sonner'
import { ParametersEditor } from '#/components/pipelines/parameters-editor'
import {
  PythonPackagesEditor,
  PythonStepEditor,
} from '#/components/pipelines/python-editor'
import { SqlEditor } from '#/components/pipelines/sql-editor'
import { StepsEditor } from '#/components/pipelines/steps-editor'
import { PluginStepsEditor } from '#/components/pipelines/plugin-steps-editor'
import type { PipelineActionConfig } from '#/components/pipelines/plugin-steps-editor'
import { InputsEditor } from '#/components/pipelines/inputs-editor'
import { OutputEditor } from '#/components/pipelines/output-editor'
import { RunDialog } from '#/components/pipelines/run-dialog'
import type { RunDetails } from '#/components/pipelines/run-dialog'
import { AiPipelineBox } from '#/components/pipelines/ai-pipeline-box'
import { TrialPanel } from '#/components/pipelines/trial-panel'
import type {
  OutputDraft,
  OutputMode,
} from '#/components/pipelines/output-editor'
import {
  draftVersion,
  usePythonRuntime,
  useDefinitionRuns,
  usePipelineDefinition,
  usePipelineVersions,
  useWorkspaceMemberNames,
} from '#/components/pipelines/pipelines-data'
import { MAX_STEPS, PIPELINE_CONFIG_VERSION } from '#/lib/pipelines/config'
import { readResultPreview } from '#/lib/pipelines/result-preview'
import type { PipelineInput, PipelineParameter } from '#/lib/pipelines/config'
import type { PipelineViewStep as PipelineStep } from '#/lib/pipelines/config-view'
import { addStep, statementForLanguage } from '#/lib/pipelines/authoring'
import { unmetRequirements } from '#/lib/pipelines/python'
import type { PythonContract } from '#/lib/pipelines/python'
import { notebookDataClient } from '#/lib/notebook-data'
import { tryPipelineDraft } from '#/lib/pipelines/data'
import type {
  PipelineDefinitionVersionWire,
  PipelineTrialWire,
} from '#/lib/pipelines/types'
import type { PipelineDraftProposal } from '#/lib/ai-pipeline-draft'
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

/** Further steps the editor adds; the analysis step is the one more. */
const MAX_EDITOR_STEPS = MAX_STEPS - 1

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
  'actions',
] as const

function draftDialogVersion(
  pipelineId: string,
  workspaceId: string,
  configuration: PipelineConfiguration,
  draft: PipelineDefinitionVersionWire | undefined,
): PipelineDefinitionVersionWire {
  return {
    definition_id: pipelineId,
    workspace_id: workspaceId,
    lifecycle: 'draft',
    configuration_format_version: PIPELINE_CONFIG_VERSION,
    revision: draft?.revision ?? 0,
    created_at: draft?.created_at ?? '',
    updated_at: draft?.updated_at ?? '',
    created_by_user_id: draft?.created_by_user_id ?? null,
    published_at: null,
    published_by_user_id: null,
    retired_at: null,
    retired_by_user_id: null,
    id: draft?.id ?? 'draft',
    version: draft?.version ?? 0,
    configuration: configurationForWire(configuration),
  }
}

function pythonEditorRuntime(
  language: string,
  steps: PipelineStep[],
  runtime: ReturnType<typeof usePythonRuntime>,
  sourceConfig: PipelineConfiguration,
) {
  const usesPython =
    language === 'python' || steps.some((s) => s.language === 'python')

  const pythonRuntime = usesPython
    ? runtime.data?.available
      ? runtime.data.runtime
      : sourceConfig.pythonRuntime
    : undefined

  const pythonUnavailable =
    usesPython && !pythonRuntime && !runtime.isLoading
      ? (runtime.data?.message ?? t('data.pipelineSteps.pythonAvailableYetAsk'))
      : null

  return { usesPython, pythonRuntime, pythonUnavailable }
}

function useStepsEditor() {
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
  const [actions, setActions] = useState<PipelineActionConfig[]>([])

  const [selected, setSelected] = useState('transform')

  const selectedIndex = selected.startsWith('step-')
    ? Number(selected.slice(5))
    : -1

  const active =
    selectedIndex >= 0 && !extraSteps[selectedIndex] ? 'transform' : selected

  const activeIndex = active.startsWith('step-') ? Number(active.slice(5)) : -1

  const workAreaRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (workAreaRef.current) workAreaRef.current.scrollTop = 0
  }, [active])

  const addFurtherStep = () => {
    setExtraSteps(addStep(extraSteps))
    setSelected(`step-${extraSteps.length}`)
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

  const sourceConfig = useMemo(
    () => editorConfiguration.parse(source?.configuration ?? {}),
    [source?.configuration],
  )

  const shown = useMemo(
    () => editorShowsVersion(source?.configuration ?? {}),
    [source?.configuration],
  )

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
    setActions(sourceConfig.actions ?? [])
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
    sourceConfig.actions,
  ])

  // A saved version pins the immutable Python image it was written against, so
  // the editor supplies it: the one installed now, or the version's existing pin
  // when the runner cannot be reached.
  const runtime = usePythonRuntime()

  const { usesPython, pythonRuntime, pythonUnavailable } = pythonEditorRuntime(
    language,
    extraSteps,
    runtime,
    sourceConfig,
  )

  const builtConfig = useMemo<PipelineConfiguration>(
    () => ({
      ...sourceConfig,
      pythonRuntime,
      pythonRequirements:
        usesPython && requirements.length ? requirements : undefined,
      configVersion: PIPELINE_CONFIG_VERSION,
      description: description.trim() || null,
      parameters,
      ...(extraSteps.length ? { steps: extraSteps } : { steps: undefined }),
      ...(actions.length ? { actions } : { actions: undefined }),
      inputs,
      transform: {
        ...sourceConfig.transform,
        language,
        statement: statement.trim(),
        contract: language === 'python' ? transformContract : undefined,
      },
      output: {
        ...sourceConfig.output,
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
      actions,
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
      ...configurationErrors(builtConfig).filter((error) =>
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
      ...(shown
        ? []
        : [
            {
              code: 'invalid_shape' as const,
              field: 'steps',
              message: t('data.pipelineSteps.versionNotShownHere'),
            },
          ]),
    ],
    [builtConfig, usesPython, requirements, runtime.data?.packages, shown],
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

  const writeDraft = (configuration: PipelineConfiguration) =>
    draft
      ? notebookDataClient.rpc('update_pipeline_definition_version_draft', {
          p_workspace_id: workspaceId,
          p_version_id: draft.id,
          p_expected_revision: draft.revision,
          p_configuration: configurationForWire(configuration),
        })
      : notebookDataClient.rpc('create_pipeline_definition_version', {
          p_workspace_id: workspaceId,
          p_definition_id: pipelineId,
          p_configuration: configurationForWire(configuration),
        })

  // An AI draft goes into the draft version only after the person applies it,
  // and only if the shared contract accepts it. Publishing stays a person's step.
  const applyAiDraft = async (proposal: PipelineDraftProposal) => {
    const d = proposal.config

    const next: PipelineConfiguration = {
      ...builtConfig,
      description: d.description ?? builtConfig.description,
      pythonRuntime: undefined,
      pythonRequirements: undefined,
      parameters: d.parameters,
      inputs: d.inputs,
      steps: d.steps.length ? d.steps : undefined,
      transform: { language: 'sql', statement: d.transform.statement },
      output: {
        ...sourceConfig.output,
        mode: d.output.mode,
        datasetName: d.output.datasetName ?? '',
        schemaVersionId: d.output.schemaVersionId,
        datasetId: d.output.datasetId,
        datasetLabel: d.output.datasetLabel,
        fieldMapping: undefined,
      },
    }

    const problem = configurationErrors(next).at(0)

    if (problem) throw new Error(problem.message)
    await writeDraft(next)
    await invalidate()
  }

  const saveDraft = useMutation({
    mutationFn: () => writeDraft(builtConfig),
    onSuccess: () => {
      toast(
        draft
          ? t('data.pipelineSteps.draftUpdated')
          : t('data.pipelineSteps.draftVersionCreated'),
      )
      void invalidate()
    },
    onError: (error) =>
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
      void invalidate()
    },
    onError: (error) => {
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
  const draftAsVersion = draftDialogVersion(
    pipelineId,
    workspaceId,
    builtConfig,
    draft,
  )

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
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('data.pipelineSteps.couldnTPublish'),
      ),
  })

  return {
    pipelineId,
    workspaceId,
    versions,
    draft,
    source,
    description,
    setDescription,
    statement,
    setStatement,
    language,
    setLanguage,
    transformContract,
    setTransformContract,
    requirements,
    setRequirements,
    inputs,
    setInputs,
    parameters,
    setParameters,
    extraSteps,
    setExtraSteps,
    actions,
    setActions,
    active,
    activeIndex,
    setSelected,
    workAreaRef,
    addFurtherStep,
    members,
    outputMode,
    outputDraft,
    updateOutput,
    lastResultColumns,
    outputErrors,
    transformRef,
    insertIntoTransform,
    runtime,
    usesPython,
    pythonUnavailable,
    configErrors,
    canSave,
    definition,
    applyAiDraft,
    saveDraft,
    tryDraft,
    trialResult,
    trialDetails,
    configKey,
    startTrial,
    publish,
    trialDialog,
    draftAsVersion,
    setTrialDialog,
    submitTrial,
  }
}

type StepsEditorModel = ReturnType<typeof useStepsEditor>

function PipelineSteps() {
  const editor = useStepsEditor()

  const {
    versions,
    draft,
    source,
    description,
    inputs,
    parameters,
    statement,
    language,
    extraSteps,
    applyAiDraft,
    trialDialog,
    definition,
    draftAsVersion,
    trialDetails,
    tryDraft,
    setTrialDialog,
    submitTrial,
  } = editor

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
      <AiPipelineBox
        current={{
          description,
          inputs,
          parameters,
          statement,
          language,
          steps: extraSteps,
        }}
        onApply={applyAiDraft}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto @min-[760px]/pipeline:grid-cols-[200px_minmax(0,1fr)] @min-[760px]/pipeline:overflow-hidden">
        <StepsNavigation editor={editor} />
        <StepsWorkArea editor={editor} />
      </div>
      <StepsFooter editor={editor} />
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

function StepsNavigation({ editor }: { editor: StepsEditorModel }) {
  const {
    active,
    setSelected,
    inputs,
    language,
    extraSteps,
    activeIndex,
    addFurtherStep,
    actions,
    outputMode,
  } = editor

  return (
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
            <li key={step.name}>
              <Button
                variant="quiet"
                aria-label={t('data.pipelineSteps.ariaEditStep', {
                  value: index + 1,
                  name: step.name,
                })}
                aria-pressed={activeIndex === index}
                className={`w-full justify-start ${activeIndex === index ? 'bg-selection' : ''}`}
                onClick={() => setSelected(`step-${index}`)}
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
          disabled={extraSteps.length >= MAX_EDITOR_STEPS}
          onClick={addFurtherStep}
        >
          {t('data.pipelineSteps.addStep')}
        </Button>
      </div>
      <div className="border-t border-border pt-3">
        <Button
          variant="quiet"
          aria-pressed={active === 'plugins'}
          className={`w-full justify-start ${active === 'plugins' ? 'bg-selection' : ''}`}
          onClick={() => setSelected('plugins')}
        >
          {t('data.pluginSteps.rail')}{' '}
          <span className="ml-auto num text-fg-muted">
            {actions.filter((a) => a.operation.startsWith('plugin.')).length}
          </span>
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
  )
}

function StepsWorkArea({ editor }: { editor: StepsEditorModel }) {
  const {
    workAreaRef,
    active,
    setSelected,
    inputs,
    extraSteps,
    addFurtherStep,
    setInputs,
    insertIntoTransform,
    language,
    setLanguage,
    setStatement,
    parameters,
    statement,
    transformContract,
    setTransformContract,
    runtime,
    requirements,
    transformRef,
    actions,
    setActions,
    activeIndex,
    members,
    setExtraSteps,
    outputDraft,
    updateOutput,
    lastResultColumns,
    outputErrors,
  } = editor

  return (
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
            value={active}
            onChange={(event) => {
              const value = event.target.value
              setSelected(
                value === 'inputs' ||
                  value === 'transform' ||
                  value === 'plugins' ||
                  value === 'output'
                  ? value
                  : `step-${Number(value.slice(5))}`,
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
              <option key={step.name} value={`step-${index}`}>
                {index + 2}. {step.name}
              </option>
            ))}
            <option value="plugins">{t('data.pluginSteps.rail')}</option>
            <option value="output">{t('data.pipelineSteps.output')}</option>
          </Select>
        </Field>
        <Button
          size="sm"
          icon="plus"
          aria-label={t('data.pipelineSteps.ariaAddPipelineStep')}
          disabled={extraSteps.length >= MAX_EDITOR_STEPS}
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
          <Section title={t('data.pipelineSteps.inputs')} count={inputs.length}>
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
                    setStatement((previousStatement) =>
                      next === 'sql' || next === 'python'
                        ? statementForLanguage(previousStatement, next, {
                            inputs,
                            parameters,
                          })
                        : previousStatement,
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
          hidden={active !== 'plugins'}
          className="flex flex-col gap-4 [&[hidden]]:hidden"
        >
          <Section title={t('data.pluginSteps.title')}>
            <p className="m-0 text-body text-fg-muted">
              {t('data.pluginSteps.intro')}
            </p>
            <PluginStepsEditor
              actions={actions}
              parameters={parameters}
              onChange={setActions}
            />
          </Section>
        </div>

        <div
          hidden={activeIndex < 0}
          className="flex flex-col gap-4 [&[hidden]]:hidden"
        >
          <Section
            title={
              activeIndex >= 0
                ? t('data.pipelineSteps.step', {
                    value: activeIndex + 2,
                    name: extraSteps[activeIndex]?.name,
                  })
                : t('data.pipelineSteps.furtherSteps')
            }
          >
            <p className="m-0 text-body text-fg-muted">
              {rich(
                activeIndex >= 0 &&
                  extraSteps[activeIndex]?.language === 'plugin'
                  ? 'data.pipelineSteps.pluginRunsAfterPrecedingStep'
                  : 'data.pipelineSteps.runsAfterPrecedingStep',
                {
                  code: (text) => <code>{text}</code>,
                },
              )}
            </p>
            <StepsEditor
              steps={extraSteps}
              activeIndex={Math.max(activeIndex, 0)}
              showAdd={false}
              members={members.data ?? {}}
              onChange={(next) => {
                if (activeIndex >= 0) {
                  const moved = next.indexOf(extraSteps[activeIndex])
                  setSelected(
                    moved >= 0
                      ? `step-${moved}`
                      : next.length
                        ? `step-${Math.min(activeIndex, next.length - 1)}`
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

        <StepsDraftDetails editor={editor} />
      </div>
    </div>
  )
}

function StepsDraftDetails({ editor }: { editor: StepsEditorModel }) {
  const {
    pythonUnavailable,
    trialResult,
    configKey,
    trialDetails,
    tryDraft,
    startTrial,
    parameters,
    setParameters,
    usesPython,
    requirements,
    setRequirements,
    runtime,
    workspaceId,
    pipelineId,
    source,
    description,
    setDescription,
    configErrors,
  } = editor

  return (
    <>
      {pythonUnavailable ? (
        <Notice tone="bad" title={t('data.pipelineSteps.pythonAvailable')}>
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
          <ParametersEditor parameters={parameters} onChange={setParameters} />
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
              <li key={`${error.field}:${error.message}`}>{error.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </>
  )
}

function StepsFooter({ editor }: { editor: StepsEditorModel }) {
  const {
    saveDraft,
    canSave,
    draft,
    source,
    tryDraft,
    startTrial,
    publish,
    pipelineId,
  } = editor

  return (
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
  )
}
