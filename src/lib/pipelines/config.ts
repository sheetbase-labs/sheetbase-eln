import { validatePipelineActions } from './actions'

/**
 * AUTO-01 — Pipeline configuration contract (format version 1).
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

export const PIPELINE_CONFIG_VERSION = 1 as const

export const PARAMETER_TYPES = [
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'timestamp',
] as const
export type ParameterType = (typeof PARAMETER_TYPES)[number]

export const INPUT_NAME_RE = /^[a-z][a-z0-9_]{0,47}$/
export const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/
export const MAX_PARAMETERS = 50
export const MAX_INPUTS = 10
export const MAX_STATEMENT_LENGTH = 20_000

export interface PipelineParameter {
  name: string
  type: ParameterType
  required: boolean
  default?: unknown
  description?: string
}

export interface PipelineInput {
  name: string
  required: boolean
  description?: string
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
}

/**
 * PIPE-02 / DEC-08 / ADR-0052 — a `confirm` step pauses the run for a named
 * person. Autonomy stays the default: only a step that carries `confirm`
 * pauses. The pipeline author configures the typed decision form, who is
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

/** Opt-in human confirmation attached to a step. */
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

export interface PipelineStep {
  name: string
  language: 'sql' | 'python'
  statement: string
  /** Opt-in: run this step's proposal, then pause for a person. */
  confirm?: PipelineStepConfirm
}

export interface PipelineConfig {
  configVersion: typeof PIPELINE_CONFIG_VERSION
  description?: string
  pythonRuntime?: string
  actions?: Array<{
    name: string
    operation: string
    arguments: Record<string, unknown>
  }>
  parameters: PipelineParameter[]
  inputs: PipelineInput[]
  transform: {
    language: 'sql' | 'python' | 'none'
    statement: string
  }
  output: PipelineOutput
  /** Ordered analysis steps; each receives the preceding result as previous. */
  steps?: PipelineStep[]
  /** Signed HTTP POST destinations, delivered durably after successful output. */
  notifications?: Array<{
    subscriptionId: string
    payload?: Record<string, unknown>
  }>
}

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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
}

function push(
  errors: ConfigError[],
  code: ConfigError['code'],
  field: string,
  message: string,
): void {
  errors.push({ code, field, message })
}

/** Validate a raw configuration value. Returns every violation found. */
export function validatePipelineConfig(v: unknown): ConfigError[] {
  const errors: ConfigError[] = []
  if (!isObject(v)) {
    push(
      errors,
      'invalid_shape',
      'configuration',
      'configuration must be an object',
    )
    return errors
  }
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
    (typeof v.description !== 'string' || v.description.length > 2000)
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
    push(errors, 'invalid_shape', 'parameters', 'parameters must be an array')
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
    v.parameters.forEach((raw, index) => {
      const field = `parameters[${index}]`
      if (!isObject(raw)) {
        push(errors, 'invalid_shape', field, 'each parameter must be an object')
        return
      }
      const name = raw.name
      if (
        typeof name !== 'string' ||
        !INPUT_NAME_RE.test(name) ||
        name === 'previous'
      ) {
        push(
          errors,
          'invalid_value',
          `${field}.name`,
          'parameter name must be a lowercase identifier',
        )
        return
      }
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
      if (
        typeof raw.type !== 'string' ||
        !(PARAMETER_TYPES as readonly string[]).includes(raw.type)
      ) {
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
        typeof raw.required !== 'boolean'
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
        !defaultMatchesType(raw.default, raw.type)
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
        typeof raw.description !== 'string'
      ) {
        push(
          errors,
          'invalid_value',
          `${field}.description`,
          'description must be a string',
        )
      }
    })
  }

  // inputs
  if (!Array.isArray(v.inputs)) {
    push(errors, 'invalid_shape', 'inputs', 'inputs must be an array')
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
    v.inputs.forEach((raw, index) => {
      const field = `inputs[${index}]`
      if (!isObject(raw)) {
        push(errors, 'invalid_shape', field, 'each input must be an object')
        return
      }
      const name = raw.name
      if (
        typeof name !== 'string' ||
        !INPUT_NAME_RE.test(name) ||
        name === 'previous'
      ) {
        push(
          errors,
          'invalid_value',
          `${field}.name`,
          'input name must be a lowercase identifier',
        )
        return
      }
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
        typeof raw.required !== 'boolean'
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

  // transform
  if (!isObject(v.transform)) {
    push(errors, 'invalid_shape', 'transform', 'transform must be an object')
  } else {
    if (
      v.transform.language !== 'sql' &&
      v.transform.language !== 'python' &&
      v.transform.language !== 'none'
    ) {
      push(
        errors,
        'unsupported_language',
        'transform.language',
        'transform language must be SQL or Python',
      )
    }
    if (
      v.transform.language !== 'none' &&
      (typeof v.transform.statement !== 'string' ||
        v.transform.statement.trim().length < 1 ||
        v.transform.statement.length > MAX_STATEMENT_LENGTH)
    ) {
      push(
        errors,
        'invalid_shape',
        'transform.statement',
        'transform statement must be between 1 and 20000 characters',
      )
    }
  }

  if (v.steps !== undefined) {
    if (!Array.isArray(v.steps) || v.steps.length > 9) {
      push(
        errors,
        'invalid_shape',
        'steps',
        'At most nine additional steps are allowed.',
      )
    } else {
      const names = new Set<string>()
      for (const [index, step] of v.steps.entries()) {
        if (
          !isObject(step) ||
          typeof step.name !== 'string' ||
          !INPUT_NAME_RE.test(step.name) ||
          step.name === 'previous'
        ) {
          push(
            errors,
            'invalid_value',
            `steps[${index}]`,
            'Each step needs a lowercase identifier.',
          )
          continue
        }
        if (names.has(step.name))
          push(
            errors,
            'duplicate_name',
            `steps[${index}].name`,
            'Step names must be unique.',
          )
        names.add(step.name)
        if (step.language !== 'sql' && step.language !== 'python')
          push(
            errors,
            'unsupported_language',
            `steps[${index}].language`,
            'Choose SQL or Python.',
          )
        if (
          typeof step.statement !== 'string' ||
          !step.statement.trim() ||
          step.statement.length > MAX_STATEMENT_LENGTH
        )
          push(
            errors,
            'invalid_value',
            `steps[${index}].statement`,
            'Step code must contain 1–20000 characters.',
          )
        if (step.confirm !== undefined)
          validateConfirmStep(errors, step.confirm, index)
      }
      // skipSteps must reference a declared step other than the confirm step.
      for (const [index, step] of v.steps.entries()) {
        if (!isObject(step) || !isObject(step.confirm)) continue
        const skips = step.confirm.skipSteps
        if (!Array.isArray(skips)) continue
        for (const name of skips) {
          if (typeof name !== 'string') continue
          if (!names.has(name) || name === step.name)
            push(
              errors,
              'invalid_value',
              `steps[${index}].confirm.skipSteps`,
              `skipSteps must name another step in this version: ${name}`,
            )
        }
      }
    }
  }
  if (v.notifications !== undefined) {
    if (!Array.isArray(v.notifications) || v.notifications.length > 10) {
      push(
        errors,
        'invalid_shape',
        'notifications',
        'Choose at most ten webhook destinations.',
      )
    } else {
      const ids = new Set<string>()
      for (const item of v.notifications) {
        if (!isObject(item) || !isUuid(item.subscriptionId))
          push(
            errors,
            'invalid_value',
            'notifications',
            'Choose a webhook destination.',
          )
        else if (ids.has(item.subscriptionId))
          push(
            errors,
            'duplicate_name',
            'notifications',
            'Webhook destinations must be unique.',
          )
        else {
          ids.add(item.subscriptionId)
          if (item.payload !== undefined && !isObject(item.payload))
            push(
              errors,
              'invalid_shape',
              'notifications',
              'Webhook payload must be a JSON object.',
            )
        }
      }
    }
  }

  const usesPython =
    (isObject(v.transform) && v.transform.language === 'python') ||
    (Array.isArray(v.steps) &&
      v.steps.some((step) => isObject(step) && step.language === 'python'))
  if (
    usesPython &&
    (typeof v.pythonRuntime !== 'string' ||
      !/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(v.pythonRuntime))
  ) {
    push(
      errors,
      'missing_required',
      'pythonRuntime',
      'Choose an available Python runtime before saving.',
    )
  }
  if (v.actions !== undefined) {
    for (const message of validatePipelineActions(v.actions))
      push(errors, 'invalid_value', 'actions', message)
  }

  // output
  if (!isObject(v.output)) {
    push(errors, 'invalid_shape', 'output', 'output must be an object')
  } else {
    if (
      v.output.mode !== 'create' &&
      v.output.mode !== 'append' &&
      v.output.mode !== 'none'
    ) {
      push(
        errors,
        'invalid_value',
        'output.mode',
        'output mode must be create, append or none',
      )
    }
    if (v.output.mode === 'create') {
      if (!isUuid(v.output.schemaVersionId)) {
        push(
          errors,
          'invalid_value',
          'output.schemaVersionId',
          'create output requires a valid Dataset Schema Version id',
        )
      }
      if (
        typeof v.output.datasetName !== 'string' ||
        v.output.datasetName.trim().length < 1 ||
        v.output.datasetName.length > 200
      ) {
        push(
          errors,
          'invalid_value',
          'output.datasetName',
          'create output requires a dataset name',
        )
      }
    }
    if (v.output.mode === 'append') {
      if (!isUuid(v.output.datasetId)) {
        push(
          errors,
          'invalid_value',
          'output.datasetId',
          'append output requires a valid Dataset id',
        )
      }
    }
    if (
      v.output.mode !== 'none' &&
      (typeof v.output.datasetLabel !== 'string' ||
        v.output.datasetLabel.trim().length < 1 ||
        v.output.datasetLabel.length > 200)
    ) {
      push(
        errors,
        'invalid_value',
        'output.datasetLabel',
        'output requires a Dataset Version label',
      )
    }
    if (
      v.output.fieldMapping !== undefined &&
      v.output.fieldMapping !== null &&
      !isObject(v.output.fieldMapping)
    ) {
      push(
        errors,
        'invalid_shape',
        'output.fieldMapping',
        'fieldMapping must be an object or null',
      )
    }
  }

  return errors
}

function validateConfirmStep(
  errors: ConfigError[],
  raw: unknown,
  index: number,
): void {
  const field = `steps[${index}].confirm`
  if (!isObject(raw)) {
    push(
      errors,
      'invalid_shape',
      field,
      'A confirm step needs a form, asked people and a no-answer outcome.',
    )
    return
  }
  if (
    !Array.isArray(raw.fields) ||
    raw.fields.length < 1 ||
    raw.fields.length > MAX_CONFIRM_FIELDS
  ) {
    push(
      errors,
      'invalid_shape',
      `${field}.fields`,
      `The decision form needs between 1 and ${MAX_CONFIRM_FIELDS} fields.`,
    )
  } else {
    const keys = new Set<string>()
    raw.fields.forEach((rawField, fieldIndex) => {
      const path = `${field}.fields[${fieldIndex}]`
      if (
        !isObject(rawField) ||
        typeof rawField.key !== 'string' ||
        !INPUT_NAME_RE.test(rawField.key)
      ) {
        push(
          errors,
          'invalid_value',
          `${path}.key`,
          'Each form field needs a lowercase identifier key.',
        )
        return
      }
      if (keys.has(rawField.key))
        push(
          errors,
          'duplicate_name',
          `${path}.key`,
          `form field key is duplicated: ${rawField.key}`,
        )
      keys.add(rawField.key)
      if (
        typeof rawField.label !== 'string' ||
        rawField.label.trim().length < 1 ||
        rawField.label.length > 200
      )
        push(
          errors,
          'invalid_value',
          `${path}.label`,
          'Each form field needs a label of at most 200 characters.',
        )
      if (
        typeof rawField.type !== 'string' ||
        !(PARAMETER_TYPES as readonly string[]).includes(rawField.type)
      )
        push(
          errors,
          'invalid_value',
          `${path}.type`,
          'Choose a supported field type.',
        )
      if (
        rawField.required !== undefined &&
        typeof rawField.required !== 'boolean'
      )
        push(
          errors,
          'invalid_value',
          `${path}.required`,
          'required must be a boolean.',
        )
      if (
        rawField.options !== undefined &&
        (!Array.isArray(rawField.options) ||
          rawField.options.length < 1 ||
          rawField.options.length > 50 ||
          rawField.options.some(
            (option) =>
              typeof option !== 'string' ||
              option.trim().length === 0 ||
              option.length > 100,
          ))
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
    !Array.isArray(raw.askedUserIds) ||
    raw.askedUserIds.length < 1 ||
    raw.askedUserIds.length > MAX_CONFIRM_ASKED_USERS ||
    raw.askedUserIds.some(
      (userId) => typeof userId !== 'string' || userId.trim().length === 0,
    )
  ) {
    push(
      errors,
      'invalid_shape',
      `${field}.askedUserIds`,
      `Ask between 1 and ${MAX_CONFIRM_ASKED_USERS} people.`,
    )
  }
  if (
    raw.noAnswer !== undefined &&
    !(CONFIRM_NO_ANSWER_OUTCOMES as readonly string[]).includes(
      raw.noAnswer as string,
    )
  ) {
    push(
      errors,
      'invalid_value',
      `${field}.noAnswer`,
      'Choose stop and re-ask, apply the proposal, or fail.',
    )
  }
  if (
    raw.expiresHours !== undefined &&
    (typeof raw.expiresHours !== 'number' ||
      !Number.isInteger(raw.expiresHours) ||
      raw.expiresHours < 1 ||
      raw.expiresHours > MAX_CONFIRM_EXPIRY_HOURS)
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
    (!Array.isArray(raw.skipSteps) ||
      raw.skipSteps.some(
        (name) => typeof name !== 'string' || !INPUT_NAME_RE.test(name),
      ))
  ) {
    push(
      errors,
      'invalid_value',
      `${field}.skipSteps`,
      'skipSteps must be a list of lowercase step identifiers.',
    )
  }
}

function defaultMatchesType(value: unknown, type: unknown): boolean {
  switch (type) {
    case 'text':
      return typeof value === 'string'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'decimal':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value)
    case 'timestamp':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    default:
      return false
  }
}

export function configErrorsToMessage(errors: ConfigError[]): string | null {
  if (errors.length === 0) return null
  return errors[0].message
}

// ---------------------------------------------------------------------------
// PIPE-02 confirm-step helpers (shared by the executor and the authoring UI).
// ---------------------------------------------------------------------------

/** The confirm step named `stepName`, or null when it is not a confirm step. */
export function findPipelineConfirmStep(
  config: PipelineConfig,
  stepName: string,
): PipelineStep | null {
  const step = (config.steps ?? []).find((entry) => entry.name === stepName)
  return step && step.confirm ? step : null
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
  answer: unknown,
): string | null {
  if (!isObject(answer))
    return 'an answer must be an object with a decision'
  if (
    typeof answer.decision !== 'string' ||
    !(CONFIRM_DECISIONS as readonly string[]).includes(answer.decision)
  )
    return 'decision must be confirm, skip or stop'
  const values = answer.values
  if (values !== undefined && !isObject(values))
    return 'values must be an object'
  if (answer.decision !== 'confirm') return null
  const supplied = (values ?? {})
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
  parameters: Record<string, unknown>
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
  parameters: Record<string, unknown>,
  inputVersions: Record<string, string>,
): ConfigError[] {
  const errors: ConfigError[] = []

  if (!isObject(parameters)) {
    push(errors, 'invalid_shape', 'parameters', 'parameters must be an object')
    return errors
  }
  if (!isObject(inputVersions)) {
    push(
      errors,
      'invalid_shape',
      'input_versions',
      'input_versions must be an object',
    )
    return errors
  }

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
    } else if (typeof value !== 'string' || !isUuid(value)) {
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

function valueMatchesType(value: unknown, type: ParameterType): boolean {
  switch (type) {
    case 'text':
      return typeof value === 'string'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'decimal':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value)
    case 'timestamp':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    default:
      return false
  }
}
