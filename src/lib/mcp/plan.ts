import { z } from 'zod'

import { LAB_RPCS } from '../lab-api-surface'
import type { LabActOutcome } from './lab'

/**
 * MCP lab plans: several lab actions in one call, run in order.
 *
 * It is the MCP face of the assistant's plan card. Each step is a lab action
 * exactly as `sheetbase.lab.act` takes it, and runs through the same agent
 * permissions: Auto runs now, Ask waits for a person, Never is refused. So
 * what may run on its own, and what pauses for approval, is the workspace's own
 * setting per action, role and credential. A later step names what an earlier
 * one made with `{ "$ref": "<key>.<path>" }` in its arguments, for example the
 * `id` of the experiment a first step created. The plan stops at the first
 * step that fails or has to wait, and says which steps are done.
 */

export const LAB_PLAN_TOOL_NAME = 'sheetbase.lab.plan'

export const MIN_LAB_PLAN_STEPS = 2
export const MAX_LAB_PLAN_STEPS = 12

const json = z.json()

export type PlanValue = z.infer<typeof json>

const ACTIONS = Object.keys(LAB_RPCS)

const stepKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lowercase letters, digits and _.')

export const labPlanSchema = z.strictObject({
  steps: z
    .array(
      z.strictObject({
        key: stepKey.describe(
          'A name for this step, so later steps can use what it makes.',
        ),
        action: z.enum(ACTIONS),
        arguments: z
          .record(z.string(), json)
          .default({})
          .describe(
            'As for sheetbase.lab.act. A value may be { "$ref": "<step key>.<path>" } to use a result of an earlier step, such as "experiment.id".',
          ),
      }),
    )
    .min(MIN_LAB_PLAN_STEPS)
    .max(MAX_LAB_PLAN_STEPS),
})

export type LabPlanInput = z.infer<typeof labPlanSchema>

export function labPlanTool() {
  return {
    name: LAB_PLAN_TOOL_NAME,
    description:
      'Run several lab actions in order in one call, as the person this token belongs to. Each step is an action as sheetbase.lab.act takes it, under the same agent permissions: it may run now, wait for a person to approve it, or be refused. The plan stops at the first step that fails or must wait and reports which steps are done. Use { "$ref": "<step key>.<path>" } in a later step’s arguments to use what an earlier step returned, such as the id of a new experiment. Needs the same personal token and workspace settings as sheetbase.lab.act.',
    inputSchema: z.toJSONSchema(labPlanSchema, { io: 'input' }),
    annotations: {
      title: 'Run a plan of lab actions',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }
}

export type PlanStepReport =
  | { key: string; status: 'done'; result: PlanValue }
  | { key: string; status: 'waiting_for_approval'; requestId: string }
  | { key: string; status: 'failed'; message: string; code?: string }
  | { key: string; status: 'not_run' }

export interface LabPlanReport {
  status: 'done' | 'waiting_for_approval' | 'failed'
  steps: PlanStepReport[]
}

const objectSchema = z.record(z.string(), json)
const listSchema = z.array(json)

/** The value at a dotted path: object keys, and numbers for array positions. */
function lookup(
  value: PlanValue | undefined,
  path: readonly string[],
): PlanValue | undefined {
  let current = value

  for (const part of path) {
    const list = listSchema.safeParse(current)
    const object = objectSchema.safeParse(current)

    if (list.success) current = list.data[Number(part)]
    else if (object.success) current = object.data[part]
    else return undefined
  }

  return current
}

const refSchema = z.strictObject({ $ref: z.string().min(1).max(200) })

/**
 * Replaces each `{ "$ref": "key.path" }` with what that earlier step returned.
 * A reference to a step that has not run, or to nothing, is an error that
 * names it, so a plan never carries on with a guess.
 */
export function resolveReferences(
  value: PlanValue,
  results: ReadonlyMap<string, PlanValue>,
): { ok: true; value: PlanValue } | { ok: false; message: string } {
  const ref = refSchema.safeParse(value)

  if (ref.success) {
    const [key, ...path] = ref.data.$ref.split('.')

    if (!results.has(key)) {
      return {
        ok: false,
        message: `"${ref.data.$ref}" names a step that has not run yet.`,
      }
    }

    const found = lookup(results.get(key), path)

    return found === undefined || found === null
      ? {
          ok: false,
          message: `"${ref.data.$ref}" found nothing in that step’s result.`,
        }
      : { ok: true, value: found }
  }

  const list = listSchema.safeParse(value)

  if (list.success) {
    const items: PlanValue[] = []

    for (const item of list.data) {
      const resolved = resolveReferences(item, results)

      if (!resolved.ok) return resolved
      items.push(resolved.value)
    }

    return { ok: true, value: items }
  }

  const object = objectSchema.safeParse(value)

  if (object.success) {
    const entries: [string, PlanValue][] = []

    for (const [name, item] of Object.entries(object.data)) {
      const resolved = resolveReferences(item, results)

      if (!resolved.ok) return resolved
      entries.push([name, resolved.value])
    }

    return { ok: true, value: Object.fromEntries(entries) }
  }

  return { ok: true, value }
}

/**
 * Runs the steps in order through `runStep`, which is the guarded lab action.
 * Stops at the first step that fails or waits; later steps are `not_run`.
 */
export async function runLabPlan(
  input: LabPlanInput,
  runStep: (step: {
    action: string
    arguments: Record<string, PlanValue>
  }) => Promise<LabActOutcome>,
): Promise<LabPlanReport> {
  const results = new Map<string, PlanValue>()
  const seen = new Set<string>()
  const steps: PlanStepReport[] = []

  for (const step of input.steps) {
    if (seen.has(step.key)) {
      return {
        status: 'failed',
        steps: [
          {
            key: step.key,
            status: 'failed',
            message: `Two steps are called "${step.key}". Give each its own key.`,
          },
        ],
      }
    }

    seen.add(step.key)
  }

  for (const [index, step] of input.steps.entries()) {
    const resolved = resolveReferences(step.arguments, results)

    if (!resolved.ok) {
      steps.push({ key: step.key, status: 'failed', message: resolved.message })

      return finish('failed', steps, input.steps.slice(index + 1))
    }

    let outcome: LabActOutcome

    try {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Each step may use what the one before returned, so they run one after another.
      outcome = await runStep({
        action: step.action,
        arguments: objectSchema.parse(resolved.value),
      })
    } catch (error) {
      steps.push({
        key: step.key,
        status: 'failed',
        message: error instanceof Error ? error.message : 'The step failed.',
      })

      return finish('failed', steps, input.steps.slice(index + 1))
    }

    if (outcome.ok === 'waiting') {
      steps.push({
        key: step.key,
        status: 'waiting_for_approval',
        requestId: outcome.request.id,
      })

      return finish('waiting_for_approval', steps, input.steps.slice(index + 1))
    }

    if (outcome.ok === false) {
      steps.push({
        key: step.key,
        status: 'failed',
        message: outcome.message,
        code: outcome.code,
      })

      return finish('failed', steps, input.steps.slice(index + 1))
    }

    const result = json.safeParse(outcome.result)
    const kept = result.success ? result.data : null

    results.set(step.key, kept)
    steps.push({ key: step.key, status: 'done', result: kept })
  }

  return { status: 'done', steps }
}

function finish(
  status: LabPlanReport['status'],
  steps: PlanStepReport[],
  rest: readonly { key: string }[],
): LabPlanReport {
  return {
    status,
    steps: [
      ...steps,
      ...rest.map((step): PlanStepReport => ({
        key: step.key,
        status: 'not_run',
      })),
    ],
  }
}
