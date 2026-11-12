import { validatePipelineActions } from './actions'
import {
  PIPELINE_CONFIG_VERSION,
  pipelineActionSteps,
  stepRuns,
  validatePipelineConfig,
} from './config'
import type {
  ConfigError,
  PipelineCodeStep,
  PipelineConfig,
  PipelineDataStep,
  PipelineInput,
  PipelineLakehouseStep,
  PipelineRemoteJobStep,
  PipelineMode,
  PipelineOutput,
  PipelineParameter,
  PipelinePluginStep,
  PipelineStep,
  PipelineStepAction,
  PipelineStepConfirm,
  PipelineStepNotify,
} from './config'
import type { PythonContract } from './python'

/**
 * The shape today's step editor works in: a first analysis step, further
 * steps that may each pause for a person, then ELN actions and notifications.
 *
 * A stored version is one ordered list of typed steps (`PipelineConfig`). The
 * editor still shows the four parts it always has, so it reads a version
 * through `configView` and saves through `configFromView`. The two are exact
 * inverses for every version the editor can show; `viewSupported` says
 * whether it can, and the editor saves nothing it cannot show.
 */
export interface PipelineConfigView {
  configVersion: typeof PIPELINE_CONFIG_VERSION
  mode: PipelineMode
  description?: string
  pythonRuntime?: string
  pythonRequirements?: string[]
  parameters: PipelineParameter[]
  inputs: PipelineInput[]
  transform: {
    language: 'sql' | 'python' | 'none'
    statement: string
    contract?: PythonContract
    /** The step's name in the list. `analysis` when it was made here. */
    name?: string
    note?: string
  }
  steps?: PipelineViewStep[]
  actions?: Array<PipelineStepAction & { name: string; note?: string }>
  notifications?: Array<PipelineStepNotify & { name?: string; note?: string }>
  output: PipelineOutput
}

export interface PipelineViewStep {
  /** The step's name; for a step that pauses, the name of its ask step. */
  name: string
  language: 'sql' | 'python' | 'plugin'
  /** The code of a SQL or Python step. A plugin step has none (empty). */
  statement: string
  plugin?: PipelinePluginStep
  contract?: PythonContract
  /** Pause after this step and ask a person about its rows. */
  confirm?: PipelineStepConfirm
  /** For a step that pauses: the name of the data step before the ask. */
  dataName?: string
  note?: string
  onlyIfRows?: boolean
}

/** The name the first analysis step gets when the editor makes it. */
export const ANALYSIS_STEP_NAME = 'analysis'

/** The name of the data step in front of an ask the editor makes. */
export function shownStepName(askName: string): string {
  return `${askName.slice(0, 42)}_shown`
}

/** The data steps the editor's older shape can show: not a job on a cluster or SQL over the lakehouse. */
type ViewDataStep = Exclude<
  PipelineDataStep,
  PipelineLakehouseStep | PipelineRemoteJobStep
>

function isData(step: PipelineStep | undefined): step is ViewDataStep {
  return (
    step?.kind === 'sql' || step?.kind === 'python' || step?.kind === 'plugin'
  )
}

/**
 * Whether the editor can show this version as it is stored: data steps (each
 * optionally followed by one ask) first, then actions and notifications.
 */
export function viewSupported(config: PipelineConfig): boolean {
  let effects = false

  for (const [index, step] of config.steps.entries()) {
    if (step.kind === 'lakehouse' || step.kind === 'remote_job') return false

    if (step.kind === 'action' || step.kind === 'notify') {
      effects = true
      continue
    }

    if (effects) return false

    if (step.kind === 'ask' && !isData(config.steps[index - 1])) return false
  }

  return true
}

function viewStep(
  step: ViewDataStep,
  ask?: Extract<PipelineStep, { kind: 'ask' }>,
): PipelineViewStep {
  const view: PipelineViewStep = {
    name: ask ? ask.name : step.name,
    // A no-code step is shown to this older view as the SQL it writes.
    language:
      stepRuns(step.kind) === 'plugin'
        ? 'plugin'
        : stepRuns(step.kind) === 'python'
          ? 'python'
          : 'sql',
    statement: step.kind === 'plugin' ? '' : step.statement,
  }

  if (step.kind === 'plugin') view.plugin = step.plugin

  if (step.kind === 'python' && step.contract) view.contract = step.contract

  if (ask) {
    view.confirm = ask.ask
    view.dataName = step.name
  }

  if (step.note) view.note = step.note

  if (step.onlyIfRows) view.onlyIfRows = true

  return view
}

/** Read a stored version in the editor's shape. */
export function configView(config: PipelineConfig): PipelineConfigView {
  const view: PipelineConfigView = {
    configVersion: PIPELINE_CONFIG_VERSION,
    mode: config.mode,
    parameters: config.parameters,
    inputs: config.inputs,
    transform: { language: 'none', statement: '' },
    output: config.output,
  }

  if (config.description !== undefined) view.description = config.description

  if (config.pythonRuntime !== undefined)
    view.pythonRuntime = config.pythonRuntime

  if (config.pythonRequirements !== undefined)
    view.pythonRequirements = config.pythonRequirements

  const steps: PipelineViewStep[] = []
  const actions: NonNullable<PipelineConfigView['actions']> = []
  const notifications: NonNullable<PipelineConfigView['notifications']> = []

  for (let index = 0; index < config.steps.length; index++) {
    const step = config.steps[index]

    if (step.kind === 'action') {
      actions.push(
        noted<ViewAction>({ name: step.name, ...step.action }, step.note),
      )
      continue
    }

    if (step.kind === 'notify') {
      notifications.push(
        noted<ViewNotify>({ name: step.name, ...step.notify }, step.note),
      )
      continue
    }

    // The editor cannot show these two; `viewSupported` keeps it from saving.
    if (
      step.kind === 'ask' ||
      step.kind === 'lakehouse' ||
      step.kind === 'remote_job'
    )
      continue
    const next = config.steps.at(index + 1)
    const ask = next?.kind === 'ask' ? next : undefined

    // The first SQL or Python step, with nothing to ask after it, is the
    // editor's analysis step.
    if (
      index === 0 &&
      !ask &&
      !step.onlyIfRows &&
      (step.kind === 'sql' || step.kind === 'python')
    ) {
      view.transform = {
        language: step.kind,
        statement: step.statement,
        name: step.name,
      }

      if (step.kind === 'python' && step.contract)
        view.transform.contract = step.contract

      if (step.note) view.transform.note = step.note
      continue
    }

    steps.push(viewStep(step, ask))
  }

  if (steps.length) view.steps = steps

  if (actions.length) view.actions = actions

  if (notifications.length) view.notifications = notifications

  return view
}

/** Unique names for notifications the editor added without one. */
function notifyName(index: number, taken: Set<string>): string {
  let name = `notify_${index + 1}`

  for (let n = 2; taken.has(name); n++) name = `notify_${index + 1}_${n}`

  return name
}

/** Write the editor's shape back as the ordered step list. */
export function configFromView(view: PipelineConfigView): PipelineConfig {
  return storedFromView(view).config
}

/**
 * Validate the editor's shape as it will be stored, with each error pointed at
 * the part of the editor it belongs to (`transform`, `steps[j]`, `actions`,
 * `notifications`), not at its place in the stored list.
 */
export function viewConfigErrors(view: PipelineConfigView): ConfigError[] {
  const { config, origins } = storedFromView(view)

  // The action steps are checked together as one list, reported on `steps`.
  const actionMessages = new Set(
    validatePipelineActions(pipelineActionSteps(config)),
  )

  return validatePipelineConfig(config).map((error) => {
    if (error.field === 'steps' && actionMessages.has(error.message))
      return { ...error, field: 'actions' }

    const match = /^steps\[(\d+)\](.*)$/.exec(error.field)
    const origin = match ? origins[Number(match[1])] : undefined

    if (!match || !origin) return error

    const rest = match[2]
      .replace(/^\.ask/, '.confirm')
      .replace(/^\.(action|notify)/, '')

    return { ...error, field: `${origin}${rest}` }
  })
}

/** A stored version, with where in the editor each of its steps came from. */
interface StoredView {
  config: PipelineConfig
  origins: string[]
}

type ViewAction = NonNullable<PipelineConfigView['actions']>[number]

type ViewNotify = NonNullable<PipelineConfigView['notifications']>[number]

/** Set a step's note only when it has one. */
function noted<T extends { note?: string }>(item: T, note?: string): T {
  if (note) item.note = note

  return item
}

/** Set a Python step's contract only when it has one. */
function contracted(
  step: PipelineCodeStep,
  contract?: PythonContract,
): PipelineStep {
  if (contract) step.contract = contract

  return step
}

function storedFromView(view: PipelineConfigView): StoredView {
  const steps: PipelineStep[] = []
  // Where in the editor each stored step came from, by index.
  const origins: string[] = []

  if (view.transform.language !== 'none') {
    const name = view.transform.name ?? ANALYSIS_STEP_NAME
    const { statement, note } = view.transform

    steps.push(
      noted<PipelineStep>(
        view.transform.language === 'python'
          ? contracted(
              { name, kind: 'python', statement },
              view.transform.contract,
            )
          : { name, kind: 'sql', statement },
        note,
      ),
    )
    origins.push('transform')
  }

  for (const [index, step] of (view.steps ?? []).entries()) {
    const dataName = step.confirm
      ? (step.dataName ?? shownStepName(step.name))
      : step.name

    const data: PipelineDataStep =
      step.language === 'plugin'
        ? {
            name: dataName,
            kind: 'plugin',
            plugin: step.plugin ?? { operation: '', arguments: {} },
          }
        : step.language === 'python'
          ? {
              name: dataName,
              kind: 'python',
              statement: step.statement,
            }
          : { name: dataName, kind: 'sql', statement: step.statement }

    if (data.kind === 'python' && step.contract) data.contract = step.contract

    if (step.onlyIfRows) data.onlyIfRows = true

    steps.push(noted(data, step.note))
    origins.push(`steps[${index}]`)

    if (step.confirm) {
      steps.push({ name: step.name, kind: 'ask', ask: step.confirm })
      origins.push(`steps[${index}]`)
    }
  }

  for (const action of view.actions ?? []) {
    const { name, note, ...settings } = action

    steps.push(
      noted<PipelineStep>({ name, kind: 'action', action: settings }, note),
    )
    origins.push('actions')
  }

  const taken = new Set(steps.map((step) => step.name))

  for (const [index, target] of (view.notifications ?? []).entries()) {
    const { name, note, ...settings } = target
    const stepName = name ?? notifyName(index, taken)
    taken.add(stepName)
    steps.push(
      noted<PipelineStep>(
        { name: stepName, kind: 'notify', notify: settings },
        note,
      ),
    )
    origins.push('notifications')
  }

  const config: PipelineConfig = {
    configVersion: PIPELINE_CONFIG_VERSION,
    mode: view.mode,
    parameters: view.parameters,
    inputs: view.inputs,
    steps,
    output: view.output,
  }

  if (view.description !== undefined) config.description = view.description

  if (view.pythonRuntime !== undefined)
    config.pythonRuntime = view.pythonRuntime

  if (view.pythonRequirements !== undefined)
    config.pythonRequirements = view.pythonRequirements

  return { config, origins }
}
