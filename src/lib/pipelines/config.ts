import { z } from 'zod'

import { validatePipelineActions } from './actions'
import { contractErrors, requirementErrors } from './python'
import type { PythonContract } from './python'
import { t } from '#/copy'
import { parsePluginName } from '#/lib/extensions/points'
import { NO_CODE_KINDS, isNoCodeKind } from './no-code/forms'
import type { NoCodeForms, NoCodeKind } from './no-code/forms'
import { noCodeStepProblem } from './no-code/schema'
import { lakeProblem, remoteJobProblem } from './remote/settings'
import type { PipelineLake, PipelineRemoteJob } from './remote/settings'
import { webCallProblem } from './web-call'
import type { PipelineWebCall } from './web-call'

/**
 * AUTO-01 — Pipeline configuration contract (format version 2).
 *
 * A version is one ordered list of typed steps: data steps (SQL, Python, a
 * plugin) that each read the one before as `previous`, pauses that ask a
 * person, ELN actions and notifications. It is written in one mode (Simple,
 * Standard or Advanced). Format 1 kept one transform, further steps, actions
 * and notifications in four places; migration 20261112110000 rewrote every
 * stored version into this shape.
 *
 * A Pipeline configuration is a versioned JSONB object that names every
 * parameter, input and output explicitly — the same way analysis definitions
 * and chart specs name their contracts — so a rerun against the same
 * definition version, parameters and input Dataset Version ids is
 * reproducible. The database validates the same rules at the version
 * boundary and at run start (api.pipeline_config_errors /
 * api.pipeline_run_request_errors); this module is the TypeScript mirror used
 * by the authoring UI and the server executor.
 */

export const PIPELINE_CONFIG_VERSION = 2 as const

export const PARAMETER_TYPES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
] as const

export type ParameterType = (typeof PARAMETER_TYPES)[number]

const parameterTypeSchema = z.enum(PARAMETER_TYPES)

export const INPUT_NAME_RE = /^[a-z][a-z0-9_]{0,47}$/
export const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/
export const MAX_PARAMETERS = 50
export const MAX_INPUTS = 10
export const MAX_STATEMENT_LENGTH = 20_000
export const MAX_STEPS = 50

/** Outputs a version may write besides its first. */
export const MAX_MORE_OUTPUTS = 9

export const MAX_STEP_NOTE_LENGTH = 500

/** Every kind of step a version may hold, in the order the Add step menu lists them. */
export const PIPELINE_STEP_KINDS = [
  ...NO_CODE_KINDS,
  'sql',
  'python',
  'plugin',
  'lakehouse',
  'remote_job',
  'web_call',
  'ask',
  'action',
  'notify',
] as const

/**
 * What the runner executes a kind as. A no-code kind stores the SQL it writes
 * and runs as `sql`; every other kind runs as itself. Mirrors the `runs`
 * column of `internal.pipeline_step_kinds`.
 */
export function stepRuns(
  kind: (typeof PIPELINE_STEP_KINDS)[number],
):
  | 'sql'
  | 'python'
  | 'plugin'
  | 'remote_job'
  | 'web_call'
  | 'ask'
  | 'action'
  | 'notify' {
  if (isNoCodeKind(kind) || kind === 'lakehouse') return 'sql'

  return kind
}

/** The kinds that give rows: each reads the one before as `previous`. */
export const DATA_STEP_KINDS = [
  ...NO_CODE_KINDS,
  'sql',
  'python',
  'plugin',
  'lakehouse',
  'remote_job',
  'web_call',
] as const

/** The settings keys a step may carry, and which belong to which kind. */
const STEP_SETTING_KEYS = [
  'statement',
  'form',
  'contract',
  'plugin',
  'lake',
  'remoteJob',
  'webCall',
  'ask',
  'action',
  'notify',
] as const

const STEP_KIND_KEYS: Record<
  (typeof PIPELINE_STEP_KINDS)[number],
  ReadonlyArray<(typeof STEP_SETTING_KEYS)[number]>
> = {
  filter: ['statement', 'form'],
  join: ['statement', 'form'],
  calculate: ['statement', 'form'],
  check_ranges: ['statement', 'form'],
  flag: ['statement', 'form'],
  sql: ['statement'],
  python: ['statement', 'contract'],
  plugin: ['plugin'],
  lakehouse: ['statement', 'lake'],
  remote_job: ['remoteJob'],
  web_call: ['webCall'],
  ask: ['ask'],
  action: ['action'],
  notify: ['notify'],
}

const parameterValueSchemas = {
  text: z.string(),
  integer: z.number().refine(Number.isInteger),
  decimal: z.number(),
  boolean: z.boolean(),
  date: z.string().regex(DATE_RE),
  timestamp: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
} satisfies Record<ParameterType, z.ZodType>

type ParameterValue = z.infer<(typeof parameterValueSchemas)[ParameterType]>

export interface PipelineParameter {
  name: string
  type: ParameterType
  required: boolean
  default?: z.core.util.JSONType
  description?: string
}

export interface PipelineInput {
  name: string
  required: boolean
  description?: string
  /**
   * The Dataset Schema this input expects. Only a convenience for people: the
   * Run dialog offers Dataset Versions that follow it first. A run is never
   * refused for it; the SQL decides whether the columns fit.
   */
  schemaId?: string
}

export interface PipelineOutput {
  /** create = new Dataset from schemaVersionId; append = extend datasetId. */
  mode: 'create' | 'append' | 'none'
  /** Required when mode = 'create'. */
  schemaVersionId?: string
  /** Required when mode = 'append'. */
  datasetId?: string
  /** Required when mode = 'create'. */
  datasetName?: string
  /** The Dataset Version label stamped on the produced snapshot. */
  datasetLabel: string
  /** Optional explicit result-column → schema-field-slug mapping. */
  fieldMapping?: Record<string, string> | null
  /**
   * The data step whose rows this output writes. Omitted: the rows of the last
   * data step (what a Standard pipeline's one output has always written).
   */
  from?: string
}

/** Every output a version writes: the first, then the file-only ones. */
export function outputsOf(config: {
  output: PipelineOutput
  moreOutputs?: PipelineOutput[]
}): PipelineOutput[] {
  return [config.output, ...(config.moreOutputs ?? [])]
}

/** What an output writes to, to tell two outputs of one version apart; `none` has no target. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Takes a stored output of any version and decodes it with the raw schema first.
export function outputTarget(raw: unknown): string | null {
  const parsed = rawOutputSchema.safeParse(raw)

  if (!parsed.success) return null
  const { mode, datasetId, datasetName, schemaVersionId } = parsed.data

  const id = z.string().safeParse(datasetId)
  const name = z.string().safeParse(datasetName)

  if (mode === 'append' && id.success) return `append:${id.data}`

  if (mode === 'create' && name.success)
    return `create:${z.string().safeParse(schemaVersionId).data ?? ''}:${name.data}`

  return null
}

/**
 * PIPE-02 / DEC-08 / ADR-0052 — an `ask` step pauses the run for a named
 * person. Autonomy stays the default: only an `ask` step pauses. The pipeline author configures the typed decision form, who is
 * asked, which steps depend on the decision, and what happens when nobody
 * answers before the prompt expires.
 */
export const CONFIRM_NO_ANSWER_OUTCOMES = ['reask', 'apply', 'fail'] as const

export type ConfirmNoAnswerOutcome = (typeof CONFIRM_NO_ANSWER_OUTCOMES)[number]

/** The three decisions a person can record against a prompt. */
export const CONFIRM_DECISIONS = ['confirm', 'skip', 'stop'] as const

export type ConfirmDecision = (typeof CONFIRM_DECISIONS)[number]

/** Default and maximum prompt lifetime; temporary data is bounded by this. */
export const DEFAULT_CONFIRM_EXPIRY_HOURS = 24
export const MAX_CONFIRM_EXPIRY_HOURS = 168
export const MAX_CONFIRM_FIELDS = 20
export const MAX_CONFIRM_ASKED_USERS = 50

/** One field of the typed decision form shown to the asked people. */
export interface PipelineConfirmField {
  key: string
  label: string
  type: ParameterType
  required?: boolean
  /** With type 'text', render a select of these options. */
  options?: string[]
}

/** The settings of an `ask` step: what the person answers, and who. */
export interface PipelineStepConfirm {
  /** Typed decision form; at least one field. */
  fields: PipelineConfirmField[]
  /** The named people asked to decide (user ids); at least one. */
  askedUserIds: string[]
  /**
   * Steps skipped when the person chooses Skip. The step must be declared in
   * this version's `steps`. Skipping leaves the dependent work unapplied.
   */
  skipSteps?: string[]
  /** Behaviour when nobody answers before expiry. Default 'reask'. */
  noAnswer?: ConfirmNoAnswerOutcome
  /** Prompt lifetime in hours. Default 24, maximum 168. */
  expiresHours?: number
}

/**
 * A step a plugin runs: it takes named tables and gives a table back, and the
 * next step reads that table as `previous`. Table boxes name where the rows
 * come from (`previous`, `inputs.<name>`, `steps.<step>`); every other box is
 * a typed value or `parameters.<name>`.
 */
/**
 * A step a plugin runs: it takes named tables and gives a table back, and the
 * next step reads that table as `previous`. Table boxes name where the rows
 * come from (`previous`, `inputs.<name>`, `steps.<step>`); every other box is
 * a typed value or `parameters.<name>`.
 */
export interface PipelinePluginStep {
  /** `plugin.<extension>.<step id>`, a `pipeline-steps` item of an installed plugin. */
  operation: string
  arguments: Record<string, z.core.util.JSONType>
}

export type { PipelineWebCall } from './web-call'

/** A governed ELN change a step makes, or proposes, under the action's policy. */
export interface PipelineStepAction {
  operation: string
  arguments: Record<string, z.core.util.JSONType>
  mode?: 'execute' | 'propose'
  /** Bulk import: run the action once for each row of this list. */
  forEach?: { $ref: string }
}

/** A notification channel (webhook, Teams or email) the run posts to. */
export interface PipelineStepNotify {
  subscriptionId: string
  payload?: Record<string, z.core.util.JSONType>
}

/** What every step carries, whatever its kind. */
interface PipelineStepBase {
  /** Lowercase identifier, unique in the version; later steps read it as `steps.<name>`. */
  name: string
  /** A short note for the people reading the pipeline. Never run. */
  note?: string
}

/** Settings shared by the steps that give rows (data steps). */
interface PipelineDataStepBase extends PipelineStepBase {
  /** Skip this step, passing the rows on unchanged, when the step before it gave none. */
  onlyIfRows?: boolean
}

export interface PipelineCodeStep extends PipelineDataStepBase {
  kind: 'sql' | 'python'
  statement: string
  /** Python only: the columns this step reads and the DataFrame it returns. */
  contract?: PythonContract
}

/**
 * A no-code step: the settings a person picked (`form`) and the SQL they
 * write (`statement`), which is what runs. Edit as SQL… makes it a SQL step.
 */
export type PipelineNoCodeStep = {
  [K in NoCodeKind]: PipelineDataStepBase & {
    kind: K
    statement: string
    form: NoCodeForms[K]
  }
}[NoCodeKind]

export interface PipelinePluginDataStep extends PipelineDataStepBase {
  kind: 'plugin'
  plugin: PipelinePluginStep
}

/** Ask another system for data over a connection an administrator approved. */
export interface PipelineWebCallStep extends PipelineDataStepBase {
  kind: 'web_call'
  webCall: PipelineWebCall
}

/**
 * SQL against the lakehouse: the open tables it names are read as they stand
 * (the current snapshot of each) and are tables of the step's SQL. Off until a
 * data steward switches it on in Settings.
 */
export interface PipelineLakehouseStep extends PipelineDataStepBase {
  kind: 'lakehouse'
  statement: string
  lake: PipelineLake
}

/**
 * A job on an HPC queue. The run waits, like it does for a person, until the
 * job gives its table back or its time limit passes; the step before it is its
 * `previous`, which the job reads from Sheetbase.
 */
export interface PipelineRemoteJobStep extends PipelineDataStepBase {
  kind: 'remote_job'
  remoteJob: PipelineRemoteJob
}

/**
 * Pause and ask a person about the rows the step before it gave. Confirm
 * carries on with those rows; Skip leaves out the steps it names; Stop ends
 * the run. The answer's values reach later steps as `confirm_answer` (SQL)
 * and `inputs["answer"]` (Python).
 */
export interface PipelineAskStep extends PipelineStepBase {
  kind: 'ask'
  ask: PipelineStepConfirm
}

/**
 * An ELN action. Actions run after the output is written, in the order of the
 * list; `previous` is the result of the data step before the action.
 */
export interface PipelineActionStep extends PipelineStepBase {
  kind: 'action'
  action: PipelineStepAction
}

/** Post to a notification channel after the output is written. */
export interface PipelineNotifyStep extends PipelineStepBase {
  kind: 'notify'
  notify: PipelineStepNotify
}

export type PipelineDataStep =
  | PipelineCodeStep
  | PipelineNoCodeStep
  | PipelinePluginDataStep
  | PipelineLakehouseStep
  | PipelineRemoteJobStep
  | PipelineWebCallStep

export type PipelineStep =
  PipelineDataStep | PipelineAskStep | PipelineActionStep | PipelineNotifyStep

export type PipelineStepKind = PipelineStep['kind']

/**
 * How a pipeline is written. One mode per pipeline: Simple is a recipe, Standard
 * typed steps, Advanced the version file. A pipeline only ever moves to a more
 * expressive mode, as a new draft.
 */
export const PIPELINE_MODES = ['simple', 'standard', 'advanced'] as const

export type PipelineMode = (typeof PIPELINE_MODES)[number]

export interface PipelineConfig {
  configVersion: typeof PIPELINE_CONFIG_VERSION
  mode: PipelineMode
  description?: string
  pythonRuntime?: string
  /**
   * Python packages the steps need, pinned as `name==version`. Nothing is
   * installed at run time: the runner refuses a run whose pinned runtime does
   * not provide exactly these versions.
   */
  pythonRequirements?: string[]
  parameters: PipelineParameter[]
  inputs: PipelineInput[]
  /** One ordered list. Data steps each read the one before as `previous`. */
  steps: PipelineStep[]
  output: PipelineOutput
  /** File-only: further outputs, each from a named step. Standard shows them read-only. */
  moreOutputs?: PipelineOutput[]
  /**
   * File-only: parameter sets this version includes. Their parameters are
   * copied into `parameters` when the version is saved, so a set changing later
   * never changes a version that used it.
   */
  include?: PipelineInclude[]
}

/** A parameter set a version includes, and the parameters it brought in. */
export interface PipelineInclude {
  set: string
  parameters: string[]
}

/** The parameter sets' key shape: lower-case letters, digits, `-` and `_`. */
export const PARAMETER_SET_KEY = /^[a-z][a-z0-9_-]{0,63}$/

export type ConfigError = {
  code:
    | 'invalid_shape'
    | 'unsupported_config_version'
    | 'invalid_value'
    | 'duplicate_name'
    | 'too_many'
    | 'unsupported_language'
    | 'missing_required'
  field: string
  message: string
}

// Tolerant envelopes preserve malformed fields for independent diagnostics.
const rawConfigSchema = z
  .looseObject({
    configVersion: z.unknown(),
    description: z.unknown(),
    parameters: z.unknown(),
    inputs: z.unknown(),
    mode: z.unknown(),
    steps: z.unknown(),
    pythonRuntime: z.unknown(),
    pythonRequirements: z.unknown(),
    output: z.unknown(),
    moreOutputs: z.unknown(),
    include: z.unknown(),
  })
  .partial()

const rawParameterSchema = z
  .looseObject({
    name: z.unknown(),
    type: z.unknown(),
    required: z.unknown(),
    default: z.unknown(),
    description: z.unknown(),
  })
  .partial()

const rawInputSchema = z
  .looseObject({
    name: z.unknown(),
    required: z.unknown(),
  })
  .partial()

const rawStepSchema = z
  .looseObject({
    name: z.unknown(),
    kind: z.unknown(),
    note: z.unknown(),
    onlyIfRows: z.unknown(),
    statement: z.unknown(),
    form: z.unknown(),
    contract: z.unknown(),
    plugin: z.unknown(),
    lake: z.unknown(),
    remoteJob: z.unknown(),
    webCall: z.unknown(),
    ask: z.unknown(),
    action: z.unknown(),
    notify: z.unknown(),
  })
  .partial()

const rawPluginSchema = z
  .looseObject({
    operation: z.unknown(),
    arguments: z.unknown(),
  })
  .partial()

const rawConfirmSchema = z
  .looseObject({
    fields: z.unknown(),
    askedUserIds: z.unknown(),
    noAnswer: z.unknown(),
    expiresHours: z.unknown(),
    skipSteps: z.unknown(),
  })
  .partial()

const rawConfirmFieldSchema = z
  .looseObject({
    key: z.unknown(),
    label: z.unknown(),
    type: z.unknown(),
    required: z.unknown(),
    options: z.unknown(),
  })
  .partial()

const rawNotificationSchema = z
  .looseObject({
    subscriptionId: z.unknown(),
    payload: z.unknown(),
  })
  .partial()

const rawOutputSchema = z
  .looseObject({
    mode: z.unknown(),
    schemaVersionId: z.unknown(),
    datasetId: z.unknown(),
    datasetName: z.unknown(),
    datasetLabel: z.unknown(),
    fieldMapping: z.unknown(),
    from: z.unknown(),
  })
  .partial()

const rawReferenceEnvelopeSchema = z.looseObject({
  $ref: z.unknown().optional(),
})

const rawReferenceSchema = z.custom<z.infer<typeof rawReferenceEnvelopeSchema>>(
  (value) => rawReferenceEnvelopeSchema.safeParse(value).success,
)

const rawAnswerSchema = z
  .looseObject({
    decision: z.unknown(),
    values: z.unknown(),
  })
  .partial()

const rawValuesEnvelopeSchema = z.looseObject({})

// Validate without cloning: looseObject's clone drops __proto__, but the
// validator must still diagnose forbidden argument keys and unknown parameters.
const rawValuesSchema = z.custom<z.infer<typeof rawValuesEnvelopeSchema>>(
  (value) => rawValuesEnvelopeSchema.safeParse(value).success,
)

const identifierSchema = z.string().regex(INPUT_NAME_RE)
const inputNameSchema = identifierSchema.refine((name) => name !== 'previous')

const shortLabelSchema = z
  .string()
  .max(200)
  .refine((label) => label.trim().length > 0)

const statementSchema = z
  .string()
  .max(MAX_STATEMENT_LENGTH)
  .refine((statement) => statement.trim().length > 0)

const uuidSchema = z.string().regex(/^[0-9a-f-]{36}$/i)

function isUuid(v: unknown): v is string {
  return uuidSchema.safeParse(v).success
}

function push(
  errors: ConfigError[],
  code: ConfigError['code'],
  field: string,
  message: string,
): void {
  errors.push({ code, field, message })
}

/** Where a plugin step's table or value may come from. */
const PLUGIN_STEP_REF_ROOTS = ['previous', 'parameters', 'inputs', 'steps']
const PLUGIN_STEP_REF_PART = /^[A-Za-z0-9_-]+$/

function validatePluginStep(
  errors: ConfigError[],
  step: z.infer<typeof rawStepSchema>,
  field: string,
): void {
  const decoded = rawPluginSchema.safeParse(step.plugin)

  const operation = decoded.success
    ? z.string().safeParse(decoded.data.operation)
    : null

  if (
    !decoded.success ||
    !operation?.success ||
    !parsePluginName(operation.data)
  ) {
    push(
      errors,
      'invalid_value',
      field,
      t('data.pipelineConfig.pluginStepNeedsPlugin'),
    )

    return
  }

  const argumentsObject = rawValuesSchema.safeParse(decoded.data.arguments)

  if (!argumentsObject.success) {
    push(
      errors,
      'invalid_shape',
      `${field}.arguments`,
      t('data.pipelineConfig.pluginStepArguments'),
    )

    return
  }

  for (const [key, value] of Object.entries(argumentsObject.data)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) {
      push(
        errors,
        'invalid_value',
        `${field}.arguments`,
        t('data.pipelineConfig.pluginStepArguments'),
      )
      continue
    }

    const reference = rawReferenceSchema.safeParse(value)

    if (!reference.success || !Object.hasOwn(reference.data, '$ref')) continue
    const ref = z.string().safeParse(reference.data.$ref)
    const parts = ref.success ? ref.data.split('.') : []

    if (
      Object.keys(reference.data).length !== 1 ||
      !PLUGIN_STEP_REF_ROOTS.includes(parts[0] ?? '') ||
      parts.length > 2 ||
      parts.some((part) => !PLUGIN_STEP_REF_PART.test(part)) ||
      (parts[0] === 'previous') !== (parts.length === 1)
    )
      push(
        errors,
        'invalid_value',
        `${field}.arguments.${key}`,
        t('data.pipelineConfig.pluginStepReference'),
      )
  }
}

/** One output: where its rows go, and which step's rows they are. */
function outputErrors(
  errors: ConfigError[],
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored output is checked field by field here, as the rest of this validator does.
  raw: unknown,
  field: string,
  dataSteps: Set<string>,
  options: { named: boolean },
): void {
  const parsedOutput = rawOutputSchema.safeParse(raw)

  if (!parsedOutput.success) {
    push(
      errors,
      'invalid_shape',
      field,
      t('data.pipelineConfig.outputMustObject'),
    )
  } else {
    const output = parsedOutput.data

    if (
      output.mode !== 'create' &&
      output.mode !== 'append' &&
      output.mode !== 'none'
    ) {
      push(
        errors,
        'invalid_value',
        `${field}.mode`,
        t('data.pipelineConfig.outputModeMustCreate'),
      )
    }

    if (output.mode === 'create') {
      if (!isUuid(output.schemaVersionId)) {
        push(
          errors,
          'invalid_value',
          `${field}.schemaVersionId`,
          t('data.pipelineConfig.createOutputRequiresValid'),
        )
      }

      if (!shortLabelSchema.safeParse(output.datasetName).success) {
        push(
          errors,
          'invalid_value',
          `${field}.datasetName`,
          t('data.pipelineConfig.createOutputRequiresDataset'),
        )
      }
    }

    if (output.mode === 'append') {
      if (!isUuid(output.datasetId)) {
        push(
          errors,
          'invalid_value',
          `${field}.datasetId`,
          t('data.pipelineConfig.appendOutputRequiresValid'),
        )
      }
    }

    if (
      output.mode !== 'none' &&
      !shortLabelSchema.safeParse(output.datasetLabel).success
    ) {
      push(
        errors,
        'invalid_value',
        `${field}.datasetLabel`,
        t('data.pipelineConfig.outputRequiresDatasetVersion'),
      )
    }

    if (
      output.fieldMapping !== undefined &&
      output.fieldMapping !== null &&
      !rawValuesSchema.safeParse(output.fieldMapping).success
    ) {
      push(
        errors,
        'invalid_shape',
        `${field}.fieldMapping`,
        'fieldMapping must be an object or null',
      )
    }
  }

  const fromValue = z.looseObject({ from: z.unknown() }).safeParse(raw)
    .data?.from

  const fromName = z.string().safeParse(fromValue)

  if (
    fromValue !== undefined &&
    !(fromName.success && dataSteps.has(fromName.data))
  )
    push(
      errors,
      'invalid_value',
      `${field}.from`,
      t('data.pipelineConfig.outputFromMustBeStep'),
    )

  if (options.named && fromValue === undefined)
    push(
      errors,
      'missing_required',
      `${field}.from`,
      t('data.pipelineConfig.outputFromRequired'),
    )
}

/** The `include` list: each entry a set key and parameters that are among the version's own. */
function includeErrors(
  errors: ConfigError[],
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored include list is checked entry by entry here.
  include: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- A stored parameter list is read only for its names.
  parameters: unknown,
): void {
  if (include === undefined) return

  if (!Array.isArray(include)) {
    push(
      errors,
      'invalid_shape',
      'include',
      t('data.pipelineConfig.includeMustBeList'),
    )

    return
  }

  const own = new Set<string>()

  if (Array.isArray(parameters))
    for (const entry of parameters) {
      const named = z.looseObject({ name: z.string() }).safeParse(entry)

      if (named.success) own.add(named.data.name)
    }

  const seen = new Set<string>()

  for (const [i, entry] of include.entries()) {
    const parsed = z
      .looseObject({ set: z.string(), parameters: z.array(z.string()) })
      .safeParse(entry)

    if (!parsed.success || !PARAMETER_SET_KEY.test(parsed.data.set)) {
      push(
        errors,
        'invalid_shape',
        `include[${i}]`,
        t('data.pipelineConfig.includeEntry'),
      )
      continue
    }

    if (seen.has(parsed.data.set))
      push(
        errors,
        'duplicate_name',
        `include[${i}]`,
        t('data.pipelineConfig.includeTwice'),
      )

    seen.add(parsed.data.set)

    if (parsed.data.parameters.some((name) => !own.has(name)))
      push(
        errors,
        'invalid_value',
        `include[${i}].parameters`,
        t('data.pipelineConfig.includeParameterMissing'),
      )
  }
}

/** The data steps a stored version names: what an output may take its rows from. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Reads the names of a stored version's steps without trusting its shape.
function dataStepNames(steps: unknown): Set<string> {
  const names = new Set<string>()

  if (!Array.isArray(steps)) return names

  for (const step of steps) {
    const parsed = z
      .looseObject({ name: z.string(), kind: z.string() })
      .safeParse(step)

    if (parsed.success && DATA_STEP_KINDS.some((k) => k === parsed.data.kind))
      names.add(parsed.data.name)
  }

  return names
}

/** Validate a raw configuration value. Returns every violation found. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public authoring boundary decodes the configuration envelope before reporting every independent field violation.
export function validatePipelineConfig(configuration: unknown): ConfigError[] {
  const decoded = rawConfigSchema.safeParse(configuration)
  const errors: ConfigError[] = []

  if (!decoded.success) {
    push(
      errors,
      'invalid_shape',
      'configuration',
      t('data.pipelineConfig.configurationMustObject'),
    )

    return errors
  }

  const v = decoded.data

  if (v.configVersion !== PIPELINE_CONFIG_VERSION) {
    push(
      errors,
      'unsupported_config_version',
      'configVersion',
      `configVersion must be ${PIPELINE_CONFIG_VERSION}`,
    )
  }

  // description
  if (
    v.description !== undefined &&
    v.description !== null &&
    !z.string().max(2000).safeParse(v.description).success
  ) {
    push(
      errors,
      'invalid_value',
      'description',
      'description must be a string of at most 2000 characters',
    )
  }

  // parameters
  if (!Array.isArray(v.parameters)) {
    push(
      errors,
      'invalid_shape',
      'parameters',
      t('data.pipelineConfig.parametersMustArray'),
    )
  } else {
    if (v.parameters.length > MAX_PARAMETERS) {
      push(
        errors,
        'too_many',
        'parameters',
        `at most ${MAX_PARAMETERS} parameters are allowed`,
      )
    }

    const names = new Set<string>()
    v.parameters.forEach((value, index) => {
      const field = `parameters[${index}]`
      const parameter = rawParameterSchema.safeParse(value)

      if (!parameter.success) {
        push(
          errors,
          'invalid_shape',
          field,
          t('data.pipelineConfig.eachParameterMustObject'),
        )

        return
      }

      const raw = parameter.data
      const parsedName = inputNameSchema.safeParse(raw.name)

      if (!parsedName.success) {
        push(
          errors,
          'invalid_value',
          `${field}.name`,
          t('data.pipelineConfig.parameterNameMustLowercase'),
        )

        return
      }

      const name = parsedName.data

      if (names.has(name)) {
        push(
          errors,
          'duplicate_name',
          `${field}.name`,
          `parameter name is duplicated: ${name}`,
        )

        return
      }

      names.add(name)

      const parameterType = parameterTypeSchema.safeParse(raw.type)

      if (!parameterType.success) {
        push(
          errors,
          'invalid_value',
          `${field}.type`,
          `parameter ${name} has an unsupported type`,
        )
      }

      if (
        raw.required !== undefined &&
        raw.required !== null &&
        !z.boolean().safeParse(raw.required).success
      ) {
        push(
          errors,
          'invalid_value',
          `${field}.required`,
          `parameter ${name} required must be a boolean`,
        )
      }

      const required = raw.required === true

      if (raw.default !== undefined && raw.default !== null && required) {
        push(
          errors,
          'invalid_value',
          `${field}.default`,
          `required parameter ${name} cannot declare a default`,
        )
      }

      if (
        raw.default !== undefined &&
        raw.default !== null &&
        (!parameterType.success ||
          !valueMatchesType(raw.default, parameterType.data))
      ) {
        push(
          errors,
          'invalid_value',
          `${field}.default`,
          `parameter ${name} default does not match its type`,
        )
      }

      if (
        raw.description !== undefined &&
        raw.description !== null &&
        !z.string().safeParse(raw.description).success
      ) {
        push(
          errors,
          'invalid_value',
          `${field}.description`,
          t('data.pipelineConfig.descriptionMustString'),
        )
      }
    })
  }

  // inputs
  if (!Array.isArray(v.inputs)) {
    push(
      errors,
      'invalid_shape',
      'inputs',
      t('data.pipelineConfig.inputsMustArray'),
    )
  } else {
    if (v.inputs.length > MAX_INPUTS) {
      push(
        errors,
        'invalid_shape',
        'inputs',
        `inputs must contain between 0 and ${MAX_INPUTS} entries`,
      )
    }

    const names = new Set<string>()
    v.inputs.forEach((value, index) => {
      const field = `inputs[${index}]`
      const input = rawInputSchema.safeParse(value)

      if (!input.success) {
        push(
          errors,
          'invalid_shape',
          field,
          t('data.pipelineConfig.eachInputMustObject'),
        )

        return
      }

      const raw = input.data
      const parsedName = inputNameSchema.safeParse(raw.name)

      if (!parsedName.success) {
        push(
          errors,
          'invalid_value',
          `${field}.name`,
          t('data.pipelineConfig.inputNameMustLowercase'),
        )

        return
      }

      const name = parsedName.data

      if (names.has(name)) {
        push(
          errors,
          'duplicate_name',
          `${field}.name`,
          `input name is duplicated: ${name}`,
        )

        return
      }

      names.add(name)

      if (
        raw.required !== undefined &&
        raw.required !== null &&
        !z.boolean().safeParse(raw.required).success
      ) {
        push(
          errors,
          'invalid_value',
          `${field}.required`,
          `input ${name} required must be a boolean`,
        )
      }
    })
  }

  // mode
  if (!z.enum(PIPELINE_MODES).safeParse(v.mode).success) {
    push(errors, 'invalid_value', 'mode', t('data.pipelineConfig.chooseMode'))
  }

  // steps: one ordered list of every kind
  const steps = validateSteps(errors, v)

  const usesPython = steps.some((step) => step.kind === 'python')

  if (
    usesPython &&
    !z
      .string()
      .regex(/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/)
      .safeParse(v.pythonRuntime).success
  ) {
    push(
      errors,
      'missing_required',
      'pythonRuntime',
      t('data.pipelineConfig.chooseAvailablePythonRuntime'),
    )
  }

  if (v.pythonRequirements !== undefined) {
    if (!usesPython)
      push(
        errors,
        'invalid_value',
        'pythonRequirements',
        t('data.pipelineConfig.packageRequirementsApplyOnly'),
      )

    for (const message of requirementErrors(v.pythonRequirements))
      push(errors, 'invalid_value', 'pythonRequirements', message)
  }

  includeErrors(errors, v.include, v.parameters)

  // output
  const dataSteps = dataStepNames(v.steps)
  outputErrors(errors, v.output, 'output', dataSteps, { named: false })

  // The more outputs a file can ask for: each one names the step its rows come from.
  if (v.moreOutputs !== undefined) {
    if (!Array.isArray(v.moreOutputs)) {
      push(
        errors,
        'invalid_shape',
        'moreOutputs',
        t('data.pipelineConfig.moreOutputsMustBeList'),
      )
    } else {
      if (v.moreOutputs.length > MAX_MORE_OUTPUTS)
        push(
          errors,
          'too_many',
          'moreOutputs',
          t('data.pipelineConfig.tooManyOutputs', { count: MAX_MORE_OUTPUTS }),
        )

      const targets = new Set<string>()

      for (const [i, more] of v.moreOutputs.entries()) {
        outputErrors(errors, more, `moreOutputs[${i}]`, dataSteps, {
          named: true,
        })
        const target = outputTarget(more)

        if (target !== null && targets.has(target))
          push(
            errors,
            'duplicate_name',
            `moreOutputs[${i}]`,
            t('data.pipelineConfig.outputTargetTwice'),
          )

        if (target !== null) targets.add(target)
      }

      const primary = outputTarget(v.output)

      if (primary !== null && targets.has(primary))
        push(
          errors,
          'duplicate_name',
          'output',
          t('data.pipelineConfig.outputTargetTwice'),
        )
    }
  }

  return errors
}

/** A step as stored, before it is known to be valid: its kind and name. */
interface DecodedStep {
  index: number
  kind: string
  name: string
  raw: z.infer<typeof rawStepSchema>
}

/**
 * Validate the ordered step list. Returns the steps whose kind and name could
 * be read, so the checks that span steps (Python runtime, Skip targets) can use
 * them.
 */
function validateSteps(
  errors: ConfigError[],
  config: z.infer<typeof rawConfigSchema>,
): DecodedStep[] {
  const value = config.steps

  if (!Array.isArray(value)) {
    push(
      errors,
      'invalid_shape',
      'steps',
      t('data.pipelineConfig.stepsMustArray'),
    )

    return []
  }

  if (value.length > MAX_STEPS) {
    push(
      errors,
      'too_many',
      'steps',
      t('data.pipelineConfig.tooManySteps', { MAX_STEPS }),
    )

    return []
  }

  const parameterNames = (
    Array.isArray(config.parameters) ? config.parameters : []
  ).flatMap((entry) => {
    const parameter = rawParameterSchema.safeParse(entry)

    const name = z.string().safeParse(parameter.success && parameter.data.name)

    return name.success ? [name.data] : []
  })

  const decoded: DecodedStep[] = []
  const names = new Set<string>()
  const actions: unknown[] = []
  const notifyTargets = new Set<string>()

  for (const [index, entry] of value.entries()) {
    const field = `steps[${index}]`
    const parsed = rawStepSchema.safeParse(entry)

    const name = parsed.success
      ? inputNameSchema.safeParse(parsed.data.name)
      : null

    if (!parsed.success || !name?.success) {
      push(
        errors,
        'invalid_value',
        field,
        t('data.pipelineConfig.eachStepNeedsLowercase'),
      )
      continue
    }

    const step = parsed.data

    if (names.has(name.data))
      push(
        errors,
        'duplicate_name',
        `${field}.name`,
        t('data.pipelineConfig.stepNamesMustUnique'),
      )
    names.add(name.data)

    const kind = z.enum(PIPELINE_STEP_KINDS).safeParse(step.kind)

    if (!kind.success) {
      push(
        errors,
        'unsupported_language',
        `${field}.kind`,
        t('data.pipelineConfig.chooseStepKind'),
      )
      continue
    }

    decoded.push({ index, kind: kind.data, name: name.data, raw: step })

    if (
      step.note !== undefined &&
      !z.string().max(MAX_STEP_NOTE_LENGTH).safeParse(step.note).success
    )
      push(
        errors,
        'invalid_value',
        `${field}.note`,
        t('data.pipelineConfig.stepNoteTooLong', { MAX_STEP_NOTE_LENGTH }),
      )

    const isData = DATA_STEP_KINDS.some((dataKind) => dataKind === kind.data)

    if (step.onlyIfRows !== undefined) {
      if (!isData)
        push(
          errors,
          'invalid_value',
          `${field}.onlyIfRows`,
          t('data.pipelineConfig.onlyIfRowsDataSteps'),
        )
      else if (!z.boolean().safeParse(step.onlyIfRows).success)
        push(
          errors,
          'invalid_value',
          `${field}.onlyIfRows`,
          t('data.pipelineConfig.requiredMustBoolean'),
        )
    }

    // Each kind keeps its settings under its own key, and only its own.
    const allowed = new Set(STEP_KIND_KEYS[kind.data])

    for (const key of STEP_SETTING_KEYS)
      if (step[key] !== undefined && !allowed.has(key))
        push(
          errors,
          'invalid_value',
          `${field}.${key}`,
          key === 'contract'
            ? t('data.pipelineConfig.dataContractAppliesPython')
            : t('data.pipelineConfig.settingNotForKind', { key }),
        )

    switch (kind.data) {
      case 'filter':
      case 'join':
      case 'calculate':
      case 'check_ranges':
      case 'flag': {
        const form = z.json().safeParse(step.form)
        const statement = z.json().safeParse(step.statement)

        const problem = noCodeStepProblem(
          kind.data,
          form.success ? form.data : null,
          statement.success ? statement.data : null,
        )

        if (problem)
          push(
            errors,
            'invalid_value',
            `${field}.${problem.field}`,
            problem.message,
          )
        break
      }

      case 'sql':
      case 'python':
        if (!statementSchema.safeParse(step.statement).success)
          push(
            errors,
            'invalid_value',
            `${field}.statement`,
            t('data.pipelineConfig.stepCodeMustContain'),
          )

        // A contract on a SQL step was refused above, as a setting not its own.
        if (kind.data === 'python' && step.contract !== undefined)
          for (const message of contractErrors(step.contract))
            push(errors, 'invalid_value', `${field}.contract`, message)
        break
      case 'plugin':
        validatePluginStep(errors, step, `${field}.plugin`)
        break
      case 'lakehouse': {
        if (!statementSchema.safeParse(step.statement).success)
          push(
            errors,
            'invalid_value',
            `${field}.statement`,
            t('data.pipelineConfig.stepCodeMustContain'),
          )

        const problem = lakeProblem(step.lake)

        if (problem)
          push(
            errors,
            problem === 'invalid' ? 'invalid_shape' : 'invalid_value',
            `${field}.lake`,
            t(`features.pipelineRemote.problems.lake.${problem}`),
          )
        break
      }

      case 'remote_job': {
        const problem = remoteJobProblem(step.remoteJob)

        if (problem)
          push(
            errors,
            problem === 'invalid' ? 'invalid_shape' : 'invalid_value',
            problem === 'invalid'
              ? `${field}.remoteJob`
              : `${field}.remoteJob.${problem === 'limit' ? 'limitMinutes' : problem}`,
            t(`features.pipelineRemote.problems.job.${problem}`),
          )
        break
      }

      case 'web_call': {
        const problem = webCallProblem(step.webCall, parameterNames)

        if (problem)
          push(
            errors,
            'invalid_value',
            problem.field
              ? `${field}.webCall.${problem.field}`
              : `${field}.webCall`,
            problem.message,
          )
        break
      }

      case 'ask':
        validateConfirmStep(
          errors,
          rawConfirmSchema.safeParse(step.ask),
          `${field}.ask`,
        )
        break
      case 'action': {
        const action = rawValuesSchema.safeParse(step.action)

        if (!action.success)
          push(
            errors,
            'invalid_shape',
            `${field}.action`,
            t('data.pipelineConfig.actionStepNeedsAction'),
          )
        else actions.push({ ...action.data, name: name.data })
        break
      }

      case 'notify': {
        const notify = rawNotificationSchema.safeParse(step.notify)

        if (!notify.success || !isUuid(notify.data.subscriptionId))
          push(
            errors,
            'invalid_value',
            `${field}.notify`,
            t('data.pipelineConfig.chooseWebhookDestination'),
          )
        else if (notifyTargets.has(notify.data.subscriptionId))
          push(
            errors,
            'duplicate_name',
            `${field}.notify`,
            t('data.pipelineConfig.webhookDestinationsMustUnique'),
          )
        else {
          notifyTargets.add(notify.data.subscriptionId)

          if (
            notify.data.payload !== undefined &&
            !rawValuesSchema.safeParse(notify.data.payload).success
          )
            push(
              errors,
              'invalid_shape',
              `${field}.notify.payload`,
              t('data.pipelineConfig.webhookPayloadMustJson'),
            )
        }

        break
      }
    }
  }

  // Skip names another step of this version, never the ask itself.
  for (const step of decoded) {
    if (step.kind !== 'ask') continue
    const ask = rawConfirmSchema.safeParse(step.raw.ask)

    if (!ask.success || !Array.isArray(ask.data.skipSteps)) continue

    for (const skip of ask.data.skipSteps) {
      const skipName = z.string().safeParse(skip)

      if (!skipName.success) continue

      if (!names.has(skipName.data) || skipName.data === step.name)
        push(
          errors,
          'invalid_value',
          `steps[${step.index}].ask.skipSteps`,
          `skipSteps must name another step in this version: ${skipName.data}`,
        )
    }
  }

  if (actions.length > 0)
    for (const message of validatePipelineActions(actions))
      push(errors, 'invalid_value', 'steps', message)

  return decoded
}

function validateConfirmStep(
  errors: ConfigError[],
  decoded: z.ZodSafeParseResult<z.infer<typeof rawConfirmSchema>>,
  field: string,
): void {
  if (!decoded.success) {
    push(
      errors,
      'invalid_shape',
      field,
      t('data.pipelineConfig.confirmStepNeedsForm'),
    )

    return
  }

  const raw = decoded.data

  if (
    !Array.isArray(raw.fields) ||
    raw.fields.length < 1 ||
    raw.fields.length > MAX_CONFIRM_FIELDS
  ) {
    push(
      errors,
      'invalid_shape',
      `${field}.fields`,
      t('data.pipelineConfig.decisionFormNeedsBetween', { MAX_CONFIRM_FIELDS }),
    )
  } else {
    const keys = new Set<string>()
    raw.fields.forEach((value, fieldIndex) => {
      const path = `${field}.fields[${fieldIndex}]`
      const parsedField = rawConfirmFieldSchema.safeParse(value)

      const key = parsedField.success
        ? identifierSchema.safeParse(parsedField.data.key)
        : null

      if (!parsedField.success || !key?.success) {
        push(
          errors,
          'invalid_value',
          `${path}.key`,
          t('data.pipelineConfig.eachFormFieldNeeds'),
        )

        return
      }

      const rawField = parsedField.data

      if (keys.has(key.data))
        push(
          errors,
          'duplicate_name',
          `${path}.key`,
          `form field key is duplicated: ${key.data}`,
        )
      keys.add(key.data)

      if (!shortLabelSchema.safeParse(rawField.label).success)
        push(
          errors,
          'invalid_value',
          `${path}.label`,
          t('data.pipelineConfig.eachFormFieldNeeds2'),
        )

      if (!parameterTypeSchema.safeParse(rawField.type).success)
        push(
          errors,
          'invalid_value',
          `${path}.type`,
          t('data.pipelineConfig.chooseSupportedFieldType'),
        )

      if (
        rawField.required !== undefined &&
        !z.boolean().safeParse(rawField.required).success
      )
        push(
          errors,
          'invalid_value',
          `${path}.required`,
          t('data.pipelineConfig.requiredMustBoolean'),
        )

      if (
        rawField.options !== undefined &&
        !z
          .array(
            z
              .string()
              .max(100)
              .refine((option) => option.trim().length > 0),
          )
          .min(1)
          .max(50)
          .safeParse(rawField.options).success
      )
        push(
          errors,
          'invalid_value',
          `${path}.options`,
          'options must be 1–50 short labels.',
        )
    })
  }

  if (
    !z
      .array(z.string().refine((userId) => userId.trim().length > 0))
      .min(1)
      .max(MAX_CONFIRM_ASKED_USERS)
      .safeParse(raw.askedUserIds).success
  ) {
    push(
      errors,
      'invalid_shape',
      `${field}.askedUserIds`,
      t('data.pipelineConfig.askBetween1People', { MAX_CONFIRM_ASKED_USERS }),
    )
  }

  if (
    raw.noAnswer !== undefined &&
    !z.enum(CONFIRM_NO_ANSWER_OUTCOMES).safeParse(raw.noAnswer).success
  ) {
    push(
      errors,
      'invalid_value',
      `${field}.noAnswer`,
      t('data.pipelineConfig.chooseStopReAsk'),
    )
  }

  if (
    raw.expiresHours !== undefined &&
    !z
      .number()
      .int()
      .min(1)
      .max(MAX_CONFIRM_EXPIRY_HOURS)
      .safeParse(raw.expiresHours).success
  ) {
    push(
      errors,
      'invalid_value',
      `${field}.expiresHours`,
      `expiresHours must be a whole number between 1 and ${MAX_CONFIRM_EXPIRY_HOURS}.`,
    )
  }

  if (
    raw.skipSteps !== undefined &&
    !z.array(identifierSchema).safeParse(raw.skipSteps).success
  ) {
    push(
      errors,
      'invalid_value',
      `${field}.skipSteps`,
      'skipSteps must be a list of lowercase step identifiers.',
    )
  }
}

export function configErrorsToMessage(errors: ConfigError[]): string | null {
  if (errors.length === 0) return null

  return errors[0].message
}

// ---------------------------------------------------------------------------
// PIPE-02 confirm-step helpers (shared by the executor and the authoring UI).
// ---------------------------------------------------------------------------

/** The ask step named `stepName`, or null when it is not an ask step. */
export function findPipelineConfirmStep(
  config: PipelineConfig,
  stepName: string,
): PipelineAskStep | null {
  const step = config.steps.find((entry) => entry.name === stepName)

  return step?.kind === 'ask' ? step : null
}

/** The data steps of a version, in order. */
export function pipelineDataSteps(config: PipelineConfig): PipelineDataStep[] {
  return config.steps.filter((step): step is PipelineDataStep =>
    DATA_STEP_KINDS.some((kind) => kind === step.kind),
  )
}

/** The ELN actions of a version, in order, named as their steps. */
export function pipelineActionSteps(
  config: PipelineConfig,
): Array<PipelineStepAction & { name: string }> {
  return config.steps.flatMap((step) =>
    step.kind === 'action' ? [{ name: step.name, ...step.action }] : [],
  )
}

/** The notifications of a version, in order. */
export function pipelineNotifySteps(
  config: PipelineConfig,
): Array<PipelineStepNotify & { name: string }> {
  return config.steps.flatMap((step) =>
    step.kind === 'notify' ? [{ name: step.name, ...step.notify }] : [],
  )
}

/** Author's no-answer outcome; DEC-08 defaults to stop and re-ask. */
export function confirmNoAnswerOutcome(
  confirm: PipelineStepConfirm,
): ConfirmNoAnswerOutcome {
  return confirm.noAnswer ?? 'reask'
}

/** Prompt lifetime in hours (bounded by MAX_CONFIRM_EXPIRY_HOURS). */
export function confirmExpiryHours(confirm: PipelineStepConfirm): number {
  return confirm.expiresHours ?? DEFAULT_CONFIRM_EXPIRY_HOURS
}

/**
 * Validate a recorded decision against the step's form: the decision must be
 * one of the three, and Confirm must carry type-matching values for every
 * required field. Null when valid.
 */
export function validateConfirmAnswer(
  confirm: PipelineStepConfirm,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public decision boundary immediately decodes the answer envelope before checking its form values.
  input: unknown,
): string | null {
  const decoded = rawAnswerSchema.safeParse(input)

  if (!decoded.success) return t('data.pipelineConfig.answerMustObjectDecision')

  const answer = decoded.data

  if (!z.enum(CONFIRM_DECISIONS).safeParse(answer.decision).success)
    return t('data.pipelineConfig.decisionMustConfirmSkip')
  const values = rawValuesSchema.optional().safeParse(answer.values)

  if (!values.success) return t('data.pipelineConfig.valuesMustObject')

  if (answer.decision !== 'confirm') return null
  const supplied = values.data ?? {}

  for (const field of confirm.fields) {
    const present = field.key in supplied

    if (!present) {
      if (field.required) return `missing required field: ${field.key}`
      continue
    }

    if (!valueMatchesType(supplied[field.key], field.type))
      return `field ${field.key} does not match its declared type`
  }

  return null
}

export interface ResolvedRunRequest {
  parameters: Record<string, z.core.util.JSONType>
  inputVersions: Record<string, string>
}

/**
 * Validate a run request against a validated configuration: every supplied
 * parameter must be declared and type-match, required parameters must be
 * present, and input_versions must name exactly the declared inputs with
 * Dataset Version ids. Mirrors api.pipeline_run_request_errors.
 */
export function validatePipelineRunRequest(
  config: PipelineConfig,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public run boundary immediately decodes the parameter map before checking each declared type.
  rawParameters: unknown,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public run boundary immediately decodes the input-version map before checking each declared input id.
  rawInputVersions: unknown,
): ConfigError[] {
  const parsedParameters = rawValuesSchema.safeParse(rawParameters)
  const parsedInputVersions = rawValuesSchema.safeParse(rawInputVersions)
  const errors: ConfigError[] = []

  if (!parsedParameters.success) {
    push(
      errors,
      'invalid_shape',
      'parameters',
      t('data.pipelineConfig.parametersMustObject'),
    )

    return errors
  }

  if (!parsedInputVersions.success) {
    push(
      errors,
      'invalid_shape',
      'input_versions',
      'input_versions must be an object',
    )

    return errors
  }

  const parameters = parsedParameters.data
  const inputVersions = parsedInputVersions.data
  const declared = new Map(config.parameters.map((p) => [p.name, p]))

  for (const [key, value] of Object.entries(parameters)) {
    const param = declared.get(key)

    if (!param) {
      push(
        errors,
        'invalid_value',
        `parameters.${key}`,
        `unknown parameter: ${key}`,
      )
    } else if (!valueMatchesType(value, param.type)) {
      push(
        errors,
        'invalid_value',
        `parameters.${key}`,
        `parameter ${key} does not match its declared type`,
      )
    }
  }

  for (const param of config.parameters) {
    if (param.required && !(param.name in parameters)) {
      push(
        errors,
        'missing_required',
        `parameters.${param.name}`,
        `missing required parameter: ${param.name}`,
      )
    }
  }

  const inputNames = new Set(config.inputs.map((i) => i.name))

  for (const [key, value] of Object.entries(inputVersions)) {
    if (!inputNames.has(key)) {
      push(
        errors,
        'invalid_value',
        `input_versions.${key}`,
        `unknown input: ${key}`,
      )
    } else if (!isUuid(value)) {
      push(
        errors,
        'invalid_value',
        `input_versions.${key}`,
        `input ${key} must be a Dataset Version id`,
      )
    }
  }

  for (const input of config.inputs) {
    if (!(input.name in inputVersions)) {
      push(
        errors,
        'missing_required',
        `input_versions.${input.name}`,
        `missing input: ${input.name}`,
      )
    }
  }

  return errors
}

function valueMatchesType(
  value: unknown,
  type: ParameterType,
): value is ParameterValue {
  const parameterType = parameterTypeSchema.safeParse(type)

  return (
    parameterType.success &&
    parameterValueSchemas[parameterType.data].safeParse(value).success
  )
}
