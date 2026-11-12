import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { t } from '#/copy'
import { toast } from '#/components/ui/sonner'
import {
  currentVersion,
  draftVersion,
  pipelineDataQueryKeys,
  useDefinitionRuns,
  usePipelineDefinition,
  usePipelineVersions,
  usePythonRuntime,
  useWorkspaceMemberNames,
} from '#/components/pipelines/pipelines-data'
import type { RunDetails } from '#/components/pipelines/run-dialog'
import { notebookDataClient } from '#/lib/notebook-data'
import {
  listPipelineRunLogs,
  listPipelineRunPrompts,
  tryPipelineDraft,
} from '#/lib/pipelines/data'
import {
  PIPELINE_CONFIG_VERSION,
  validatePipelineConfig,
} from '#/lib/pipelines/config'
import type {
  ConfigError,
  PipelineConfig,
  PipelineStep,
} from '#/lib/pipelines/config'
import { configFromView, configView } from '#/lib/pipelines/config-view'
import type { PipelineConfigView } from '#/lib/pipelines/config-view'
import { runNumbers, runSteps } from '#/lib/pipelines/run-steps'
import type { RunStepState } from '#/lib/pipelines/run-steps'
import { unmetRequirements } from '#/lib/pipelines/python'
import { configForWire, readStoredConfig } from '#/lib/pipelines/step-list'
import { checkVersionFile, versionFileText } from '#/lib/pipelines/version-file'
import type { VersionFileResult } from '#/lib/pipelines/version-file'
import type {
  PipelineDefinitionVersionWire,
  PipelineTrialWire,
  pipelineJsonObjectSchema,
} from '#/lib/pipelines/types'
import type { PipelineDraftProposal } from '#/lib/ai-pipeline-draft'

/** What a trial or a run said about one step: the rows it gave and their columns. */
export interface StepFacts {
  rows?: number
  columns?: string[]
}

const stepFactsSchema = z.object({
  name: z.string(),
  rowCount: z.number().optional(),
  columns: z.array(z.string()).optional(),
})

/** The empty configuration a first draft starts from. */
const EMPTY_CONFIG: PipelineConfig = {
  configVersion: PIPELINE_CONFIG_VERSION,
  mode: 'standard',
  parameters: [],
  inputs: [],
  steps: [],
  output: { mode: 'none', datasetLabel: '' },
}

/** The remark after the version number in the file: which version it is a draft of. */
function fileVersionNote(
  source: { lifecycle: string; version: number } | undefined,
  current: { version: number } | undefined,
): string | undefined {
  if (!source) return undefined

  return source.lifecycle === 'draft' && current
    ? t('features.pipelineVersionFile.editor.draftNote', {
        version: current.version,
      })
    : undefined
}

/** The runner's Python pin is supplied when a version is saved; it is not an edit. */
function withoutPin(config: PipelineConfig): PipelineConfig {
  const { pythonRuntime: _pin, ...rest } = config

  return rest
}

export type Selection = 'starts' | 'inputs' | 'output' | `step:${string}`

/** What a Simple pipeline's editor tells the header about its recipe. */
export interface SimpleDraft {
  /** The recipe has edits that are not saved. */
  dirty: boolean
  /** The recipe is finished and compiles to a configuration the contract accepts. */
  complete: boolean
  /** Saves the recipe on the draft and returns the draft version's id. */
  save: () => Promise<string | undefined>
}

/** The step-list editor's state: the draft being edited, its checks, and what it can do. */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function -- the model owns the draft, its checks, save, publish, try and the run facts together; they share one working copy.
export function usePipelineEditorModel(
  pipelineId: string,
  workspaceId: string,
) {
  const queryClient = useQueryClient()
  const versions = usePipelineVersions(pipelineId)
  const list = versions.data ?? []
  const definition = usePipelineDefinition(pipelineId)
  const draft = draftVersion(list)
  const current = currentVersion(list)
  const source = draft ?? current
  const runs = useDefinitionRuns(list)
  const members = useWorkspaceMemberNames()
  const runtime = usePythonRuntime()

  const stored = useMemo(
    () => (source ? readStoredConfig(source.configuration) : EMPTY_CONFIG),
    [source],
  )

  // The working copy: the saved draft (or the published version) plus edits.
  const [working, setWorking] = useState<{
    key: string
    config: PipelineConfig
  } | null>(null)

  const sourceKey = `${source?.id ?? 'none'}:${source?.revision ?? 0}`

  useEffect(() => {
    if (stored) setWorking({ key: sourceKey, config: stored })
  }, [sourceKey, stored])

  // Advanced mode edits the version file: its text is the working copy, and the
  // version it says (when it says one) is what the rest of the editor sees.
  const advanced = stored?.mode === 'advanced'

  const pipelineNames = [
    definition.data?.display_id ?? '',
    definition.data?.key ?? '',
  ].filter(Boolean)

  const savedFile = useMemo(
    () =>
      stored && advanced
        ? versionFileText(stored, {
            title: definition.data?.name,
            pipeline: pipelineNames[0] ?? '',
            version: source?.version,
            versionNote: fileVersionNote(
              source,
              current?.lifecycle === 'published' ? current : undefined,
            ),
          })
        : '',
    // The names are the definition's own; they only change with it.
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- the names are the definition's own and change only with it.
    [stored, advanced, definition.data, source, current],
  )

  const [fileState, setFileState] = useState<{
    key: string
    text: string
  } | null>(null)

  const fileText = fileState?.key === sourceKey ? fileState.text : savedFile

  const setFileText = (text: string) => setFileState({ key: sourceKey, text })

  const pin = runtime.data?.available
    ? runtime.data.runtime
    : stored?.pythonRuntime

  const fileCheck = useMemo<VersionFileResult | null>(
    () =>
      advanced
        ? checkVersionFile(fileText, {
            pipeline: pipelineNames,
            pythonRuntime: pin,
          })
        : null,
    // react-doctor-disable-next-line react-doctor/exhaustive-deps -- the pin and names are the definition's own and change only with it.
    [advanced, fileText, definition.data, pin],
  )

  const fileConfig = fileCheck?.config ?? stored

  const config = advanced
    ? fileConfig
    : working?.key === sourceKey
      ? working.config
      : stored

  const shown = stored !== null

  const setConfig = (update: (config: PipelineConfig) => PipelineConfig) => {
    if (!config || advanced) return
    setWorking({ key: sourceKey, config: update(config) })
  }

  const [selected, setSelected] = useState<Selection | null>(null)

  const dirty = useMemo(
    () =>
      Boolean(
        config &&
        stored &&
        JSON.stringify(configForWire(withoutPin(config))) !==
          JSON.stringify(configForWire(withoutPin(stored))),
      ),
    [config, stored],
  )

  // The runner pins the immutable Python image a saved version was written
  // against, so the editor supplies it: the one installed now, or the pin the
  // version already has when the runner cannot be reached.
  const usesPython = Boolean(config?.steps.some((s) => s.kind === 'python'))

  const pythonRuntime = usesPython
    ? runtime.data?.available
      ? runtime.data.runtime
      : config?.pythonRuntime
    : undefined

  const pythonUnavailable =
    usesPython && !pythonRuntime && !runtime.isLoading
      ? (runtime.data?.message ?? t('data.pipelineSteps.pythonAvailableYetAsk'))
      : null

  const built = useMemo<PipelineConfig | null>(() => {
    if (!config) return null
    const { pythonRuntime: _old, pythonRequirements, ...rest } = config
    const next: PipelineConfig = { ...rest }

    if (pythonRuntime) next.pythonRuntime = pythonRuntime

    if (usesPython && pythonRequirements?.length)
      next.pythonRequirements = pythonRequirements

    return next
  }, [config, pythonRuntime, usesPython])

  const errors = useMemo<ConfigError[]>(() => {
    if (!built) return []

    return [
      ...(fileCheck
        ? fileCheck.problems.map((problem) => ({
            code: 'invalid_value' as const,
            field: `line ${problem.line}`,
            message: t('features.pipelineVersionFile.editor.problemAt', {
              line: problem.line,
              message: problem.message,
            }),
          }))
        : validatePipelineConfig(built)),
      ...(usesPython && runtime.data?.packages
        ? unmetRequirements(
            built.pythonRequirements ?? [],
            runtime.data.packages,
          ).map((message) => ({
            code: 'invalid_value' as const,
            field: 'pythonRequirements',
            message,
          }))
        : []),
    ]
  }, [built, fileCheck, usesPython, runtime.data?.packages])

  const problemsOf = (index: number) =>
    errors.filter(
      (e) =>
        e.field === `steps[${index}]` || e.field.startsWith(`steps[${index}].`),
    )

  const canSave = Boolean(built) && errors.length === 0 && !pythonUnavailable

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['ui-port', 'pipelines'] })

  const writeDraft = (next: PipelineConfig) =>
    draft
      ? notebookDataClient.rpc('update_pipeline_definition_version_draft', {
          p_workspace_id: workspaceId,
          p_version_id: draft.id,
          p_expected_revision: draft.revision,
          p_configuration: configForWire(next),
        })
      : notebookDataClient.rpc('create_pipeline_definition_version', {
          p_workspace_id: workspaceId,
          p_definition_id: pipelineId,
          p_configuration: configForWire(next),
        })

  const saveDraft = useMutation({
    mutationFn: async () => {
      if (!built) throw new Error(t('data.pipelineSteps.couldnTSave'))
      await writeDraft(built)
    },
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

  // A Simple pipeline keeps its recipe in its own editor; that editor tells the
  // header what is unsaved and how to save it, so Publish can save first too.
  const [simple, setSimple] = useState<SimpleDraft | null>(null)

  // Convert to Advanced: what is on screen becomes a new draft written as the
  // version file. A pipeline only ever moves to a more expressive mode.
  const convertToAdvanced = useMutation({
    mutationFn: async () => {
      if (!built || advanced)
        throw new Error(t('data.pipelineSteps.couldnTSave'))
      await writeDraft({ ...built, mode: 'advanced' })
    },
    onSuccess: () => {
      toast(t('features.pipelineVersionFile.convert.done'))
      void invalidate()
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? error.message
          : t('data.pipelineSteps.couldnTSave'),
      ),
  })

  // The version file's editor registers how to move the caret, for the outline to call.
  const fileJump = useRef<((line: number, column?: number) => void) | null>(
    null,
  )

  // Asking to publish saves what is on screen first, then asks about that draft.
  const ensureDraft = async () => {
    if (simple) {
      if (!simple.complete)
        throw new Error(t('data.pipelineSteps.draftPublish'))

      const savedId = simple.dirty || !draft ? await simple.save() : draft.id

      if (!savedId) throw new Error(t('data.pipelineSteps.draftPublish'))

      return savedId
    }

    if (!built) throw new Error(t('data.pipelineSteps.draftPublish'))
    let versionId = draft?.id

    if (dirty || !draft) {
      const saved = await writeDraft(built)

      // SAFETY: the step kind names the shape of its form, checked by parseNoCodeForm.
      versionId = (saved as { id?: string } | null)?.id ?? versionId
    }

    if (!versionId) throw new Error(t('data.pipelineSteps.draftPublish'))

    return versionId
  }

  // Try the draft: run what is on screen, unsaved, and show the result.
  const [trialDialog, setTrialDialog] = useState(false)
  const [trialDetails, setTrialDetails] = useState<RunDetails | null>(null)
  const [trialAt, setTrialAt] = useState<Date | null>(null)

  const [trialResult, setTrialResult] = useState<{
    report: PipelineTrialWire
    ranWith: string
  } | null>(null)

  const configKey = built ? JSON.stringify(configForWire(built)) : ''

  const tryDraft = useMutation({
    mutationFn: (details: RunDetails) => {
      if (!built) throw new Error(t('data.pipelineSteps.couldnTTryDraft'))

      return tryPipelineDraft({
        workspaceId,
        configuration: built,
        inputVersions: details.inputVersions,
        parameters: details.parameters,
      })
    },
    onSuccess: (report) => {
      setTrialDialog(false)
      setTrialResult({ report, ranWith: configKey })
      setTrialAt(new Date())
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
    if (!built) return
    const { inputs, parameters } = built

    if (!inputs.length && !parameters.length) {
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

  const draftAsVersion: PipelineDefinitionVersionWire = {
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
    configuration: built ? configForWire(built) : {},
  }

  // What each step did in the trial, and in the latest run, by step name.
  const latestRun = runs.data?.at(0)
  const latestRunId = latestRun?.id

  const latestLogs = useQuery({
    queryKey: pipelineDataQueryKeys.runLogs(latestRunId ?? ''),
    queryFn: () => listPipelineRunLogs(notebookDataClient, latestRunId ?? ''),
    enabled: Boolean(latestRunId),
  })

  const facts = useMemo(() => {
    const byName: Partial<Record<string, StepFacts>> = {}

    const read = (
      detail: z.output<typeof pipelineJsonObjectSchema>,
      into: Partial<Record<string, StepFacts>>,
    ) => {
      const fact = stepFactsSchema.safeParse(detail)

      if (!fact.success) return
      into[fact.data.name] = {
        rows: fact.data.rowCount,
        columns: fact.data.columns,
      }
    }

    if (latestRun && latestLogs.data) {
      for (const entry of latestLogs.data)
        if (entry.stage === 'step') read(entry.detail, byName)
    }

    const trial: Partial<Record<string, StepFacts>> = {}

    if (trialResult?.report.ok)
      for (const entry of trialResult.report.logs)
        if (entry.stage === 'step' && entry.detail) read(entry.detail, trial)

    return { run: byName, trial }
  }, [latestRun, latestLogs.data, trialResult])

  // Where the latest run got to, by step name; a step the run did not have is new.
  const latestPrompts = useQuery({
    queryKey: pipelineDataQueryKeys.runPrompts(latestRunId ?? ''),
    queryFn: () =>
      listPipelineRunPrompts(notebookDataClient, latestRunId ?? ''),
    enabled: latestRun?.status === 'waiting',
  })

  const latestRunVersion = list.find(
    (v) => v.id === latestRun?.definition_version_id,
  )

  const runStates = useMemo(() => {
    const states: Partial<Record<string, RunStepState>> = {}

    const runConfig = latestRunVersion
      ? readStoredConfig(latestRunVersion.configuration)
      : null

    if (!latestRun || !runConfig) return states

    for (const step of runSteps(
      runConfig,
      latestRun,
      latestLogs.data ?? [],
      latestPrompts.data?.at(0),
    ))
      states[step.name] = step.state

    return states
  }, [latestRun, latestRunVersion, latestLogs.data, latestPrompts.data])

  const latestRunNumber = latestRun
    ? runNumbers(runs.data ?? []).get(latestRun.id)
    : undefined

  // An AI draft goes into the draft version only after the person applies it,
  // and only if the shared contract accepts it. Publishing stays a person's step.
  const applyAiDraft = async (proposal: PipelineDraftProposal) => {
    if (!config) return
    const d = proposal.config

    const view: PipelineConfigView = {
      configVersion: PIPELINE_CONFIG_VERSION,
      mode: config.mode,
      description: d.description ?? config.description ?? undefined,
      parameters: d.parameters,
      inputs: d.inputs,
      transform: { language: 'sql', statement: d.transform.statement },
      output: {
        ...config.output,
        mode: d.output.mode,
        datasetName: d.output.datasetName ?? '',
        schemaVersionId: d.output.schemaVersionId,
        datasetId: d.output.datasetId,
        datasetLabel: d.output.datasetLabel ?? '',
        fieldMapping: undefined,
      },
    }

    if (d.steps.length) view.steps = d.steps

    const drafted = configFromView(view)
    const taken = new Set(drafted.steps.map((s) => s.name))

    // The drafted steps replace the data steps; the existing actions and notifications stay.
    const effects: PipelineStep[] = config.steps.filter(
      (s) => (s.kind === 'action' || s.kind === 'notify') && !taken.has(s.name),
    )

    const next: PipelineConfig = {
      ...drafted,
      steps: [...drafted.steps, ...effects],
    }

    const problem = validatePipelineConfig(next).at(0)

    if (problem) throw new Error(problem.message)
    await writeDraft(next)
    await invalidate()
  }

  const aiContext = config ? configView(config) : null

  return {
    pipelineId,
    workspaceId,
    versions,
    definition,
    list,
    draft,
    current,
    source,
    runs,
    latestRun,
    members: members.data ?? {},
    runtime,
    config,
    built,
    advanced,
    fileText,
    setFileText,
    savedFile,
    fileCheck,
    fileJump,
    convertToAdvanced,
    shown,
    setConfig,
    dirty,
    selected,
    setSelected,
    errors,
    problemsOf,
    canSave,
    usesPython,
    pythonUnavailable,
    saveDraft,
    ensureDraft,
    simple,
    setSimple,
    tryDraft,
    startTrial,
    submitTrial,
    trialDialog,
    setTrialDialog,
    trialDetails,
    trialResult,
    trialAt,
    configKey,
    draftAsVersion,
    facts,
    runStates,
    latestRunNumber,
    applyAiDraft,
    aiContext,
  }
}

export type PipelineEditor = ReturnType<typeof usePipelineEditorModel>

const EditorContext = createContext<PipelineEditor | null>(null)

export const PipelineEditorProvider = EditorContext.Provider

export function usePipelineEditor(): PipelineEditor {
  const editor = useContext(EditorContext)

  if (!editor) throw new Error('The pipeline editor is not mounted.')

  return editor
}
