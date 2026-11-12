/**
 * The ordered step list as the Standard editor edits it: pure functions over
 * a version's own `PipelineConfig`. The shared validator stays the judge of
 * what is acceptable; these keep an edit from producing something it can never
 * accept (a duplicate name, a Skip pointing at a step that was removed).
 */
import { z } from 'zod'

import {
  DATA_STEP_KINDS,
  PIPELINE_CONFIG_VERSION,
  PIPELINE_MODES,
  stepRuns,
} from './config'
import type {
  PipelineAskStep,
  PipelineConfig,
  PipelineDataStep,
  PipelineNoCodeStep,
  PipelineStep,
  PipelineStepKind,
} from './config'
import { defaultForm } from './no-code/summary'
import { isNoCodeKind } from './no-code/forms'
import type { NoCodeForm, NoCodeKind } from './no-code/forms'
import { noCodeStatement } from './no-code/generate'
import { DEFAULT_SQL_STATEMENT, pythonSkeleton } from './python'
import type { PythonContract } from './python'
import { emptyLake, emptyRemoteJob } from './remote/settings'
import { pipelineJsonObjectSchema } from './types'

type JsonValue = z.core.util.JSONType

/** A stored version as the editor reads it: its own shape, with its defaults filled. */
export function readStoredConfig(raw: JsonValue): PipelineConfig | null {
  const object = pipelineJsonObjectSchema.safeParse(raw)

  if (!object.success) return null
  const value = object.data

  const stored = z
    .looseObject({
      configVersion: z.literal(PIPELINE_CONFIG_VERSION),
      steps: z.array(z.looseObject({ name: z.string(), kind: z.string() })),
    })
    .safeParse(value)

  if (!stored.success) return null

  // The server checks the rest; the editor fills what a saved version may leave out.
  // The stored shape was only checked for its envelope, so the default fills are typed here.
  const output = pipelineJsonObjectSchema.safeParse(value.output)

  const config = {
    ...value,
    mode: PIPELINE_MODES.find((m) => m === value.mode) ?? 'standard',
    parameters: Array.isArray(value.parameters) ? value.parameters : [],
    inputs: Array.isArray(value.inputs) ? value.inputs : [],
    output: output.success ? output.data : { mode: 'none', datasetLabel: '' },
  }

  return z.custom<PipelineConfig>().parse(config)
}

/** A version as the JSON the database stores: unset values dropped. */
export function configForWire(config: PipelineConfig) {
  // react-doctor-disable-next-line react-doctor/no-json-parse-stringify-clone -- a saved version must be plain JSON; the round trip drops unset values on purpose.
  return pipelineJsonObjectSchema.parse(JSON.parse(JSON.stringify(config)))
}

/** A name for a new step of a kind, unused so far: `filter_1`, `filter_2`… */
export function freeStepName(base: string, steps: PipelineStep[]): string {
  const taken = new Set(steps.map((step) => step.name))
  const stem = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  let n = 1

  while (taken.has(`${stem}_${n}`)) n += 1

  return `${stem}_${n}`
}

/** The SQL a new lakehouse step starts with: the tables it reads are tables of this SQL, by their names. */
export const DEFAULT_LAKEHOUSE_STATEMENT = 'SELECT * FROM <table> LIMIT 100'

export function isDataStep(step: PipelineStep): step is PipelineDataStep {
  return DATA_STEP_KINDS.some((kind) => kind === step.kind)
}

/** The data step whose rows the step at `index` reads as `previous`, if any. */
export function previousDataStep(
  steps: PipelineStep[],
  index: number,
): PipelineDataStep | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const step = steps[i]

    if (step.kind === 'action' || step.kind === 'notify') continue

    if (isDataStep(step)) return step
  }

  return undefined
}

/** What the editor needs to start a step of a kind. */
export interface NewStepContext {
  inputs: Array<{ name: string }>
  /** For a Python step: the parameters it may read. */
  parameters: Array<{ name: string; type: string }>
  /** Whether a step before it gives rows. */
  hasPrevious: boolean
  /** The person an ask step asks first. */
  askedUserIds: string[]
}

/** A step of `kind`, ready to edit. */
export function newStep(
  kind: PipelineStepKind,
  steps: PipelineStep[],
  context: NewStepContext,
): PipelineStep {
  const name = freeStepName(kind, steps)

  if (isNoCodeKind(kind)) return noCodeStep(kind, name, defaultForm(kind))

  switch (kind) {
    case 'python':
      return {
        name,
        kind: 'python',
        statement: pythonSkeleton({
          inputs: context.inputs.map((i) => ({ name: i.name })),
          parameters: context.parameters.map((p) => ({
            name: p.name,
            type: z
              .enum([
                'text',
                'integer',
                'decimal',
                'boolean',
                'date',
                'timestamp',
              ])
              .catch('text')
              .parse(p.type),
          })),
          hasPrevious: context.hasPrevious,
        }),
      }
    case 'plugin':
      return { name, kind: 'plugin', plugin: { operation: '', arguments: {} } }
    case 'lakehouse':
      return {
        name,
        kind: 'lakehouse',
        statement: DEFAULT_LAKEHOUSE_STATEMENT,
        lake: emptyLake(),
      }
    case 'remote_job':
      return { name, kind: 'remote_job', remoteJob: emptyRemoteJob() }
    case 'web_call':
      return {
        name,
        kind: 'web_call',
        webCall: { connection: '', method: 'GET', path: '/' },
      }
    case 'ask':
      return {
        name,
        kind: 'ask',
        ask: {
          fields: [
            { key: 'note', label: 'Note', type: 'text', required: false },
          ],
          askedUserIds: context.askedUserIds,
          noAnswer: 'reask',
          expiresHours: 24,
        },
      }
    case 'action':
      return {
        name,
        kind: 'action',
        action: { operation: '', arguments: {}, mode: 'propose' },
      }
    case 'notify':
      return { name, kind: 'notify', notify: { subscriptionId: '' } }
    default:
      return { name, kind: 'sql', statement: DEFAULT_SQL_STATEMENT }
  }
}

/** A no-code step: the form and the SQL it writes (empty until the form is complete). */
export function noCodeStep(
  kind: NoCodeKind,
  name: string,
  form: ReturnType<typeof defaultForm>,
): PipelineStep {
  const made = noCodeStatement(kind, form)
  const statement = made.ok ? made.statement : DEFAULT_SQL_STATEMENT

  // The kind and its form go together; the type of `form` follows `kind`.
  return z.custom<PipelineStep>().parse({ name, kind, form, statement })
}

/**
 * Change a no-code step's form. The SQL follows the form while it is complete;
 * until then the step keeps the last SQL it had.
 */
export function withForm(
  step: PipelineNoCodeStep,
  form: NoCodeForm,
): PipelineStep {
  const made = noCodeStatement(step.kind, form)

  // The kind and its form go together; the type of `form` follows `kind`.
  return z.custom<PipelineStep>().parse({
    ...step,
    form,
    statement: made.ok ? made.statement : step.statement,
  })
}

/** Replace one step; a change of name keeps every Skip that named it. */
export function updateStep(
  steps: PipelineStep[],
  index: number,
  next: PipelineStep,
): PipelineStep[] {
  const before = steps[index]

  return steps.map((step, position) => {
    if (position === index) return next

    if (before.name === next.name || step.kind !== 'ask') return step
    const skip = step.ask.skipSteps

    if (!skip?.includes(before.name)) return step

    return {
      ...step,
      ask: {
        ...step.ask,
        skipSteps: skip.map((n) => (n === before.name ? next.name : n)),
      },
    }
  })
}

/** Remove a step, and the Skips that named it. */
export function removeStep(
  steps: PipelineStep[],
  index: number,
): PipelineStep[] {
  const name = steps[index].name

  return steps.flatMap((step, position) => {
    if (position === index) return []

    if (step.kind !== 'ask' || !step.ask.skipSteps?.includes(name))
      return [step]
    const { skipSteps, ...ask } = step.ask
    const kept = skipSteps.filter((n) => n !== name)

    return [{ ...step, ask: kept.length ? { ...ask, skipSteps: kept } : ask }]
  })
}

export function moveStep(
  steps: PipelineStep[],
  index: number,
  by: -1 | 1,
): PipelineStep[] {
  const to = index + by

  if (to < 0 || to >= steps.length) return steps

  const next = [...steps]

  ;[next[index], next[to]] = [next[to], next[index]]

  return next
}

/** Insert a step after `index` (at the end when it is -1 or past the end). */
export function insertStep(
  steps: PipelineStep[],
  step: PipelineStep,
  after: number = steps.length - 1,
): PipelineStep[] {
  const at = Math.min(Math.max(after + 1, 0), steps.length)

  return [...steps.slice(0, at), step, ...steps.slice(at)]
}

/** A copy of a step under a new name. */
export function duplicateStep(
  steps: PipelineStep[],
  index: number,
): PipelineStep[] {
  const copy: PipelineStep = {
    ...structuredClone(steps[index]),
    name: freeStepName(steps[index].name.replace(/_\d+$/, ''), steps),
  }

  return insertStep(steps, copy, index)
}

/**
 * Edit as SQL…: a no-code step becomes a SQL step with the SQL its form wrote,
 * one way. Only a no-code step can be converted.
 */
export function convertToSql(
  steps: PipelineStep[],
  index: number,
): PipelineStep[] {
  const step = steps[index]

  if (!isDataStep(step) || !isNoCodeKind(step.kind)) return steps
  const { name, note, onlyIfRows } = step
  const statement = 'statement' in step ? step.statement : ''
  const sql: PipelineStep = { name, kind: 'sql', statement }

  if (note !== undefined) sql.note = note

  if (onlyIfRows !== undefined) sql.onlyIfRows = onlyIfRows

  return updateStep(steps, index, sql)
}

/** Switch a Python step's contract; a SQL step carries none. */
export function withContract(
  step: PipelineDataStep,
  contract: PythonContract | undefined,
): PipelineDataStep {
  if (step.kind !== 'python') return step
  const { contract: _old, ...rest } = step

  return contract ? { ...rest, contract } : rest
}

export type { PipelineAskStep }

export { stepRuns }
