import { z } from 'zod'

/**
 * Plans: several assistant cards approved together and run in order.
 *
 * The model proposes one plan card listing every step. Each step is the same
 * tool call it would have made as a card of its own; it is built only when its
 * turn comes, so a step can name what an earlier step made (the experiment an
 * earlier step created, the samples it logged) and find it. The person approves
 * once. The steps run in order as them, each through the ordinary RPCs, and the
 * plan stops at the first step that fails.
 *
 * What may pause or be run straight through is the workspace's own rule, set
 * with the other agent permissions (`plan_pause_destructive`, `plan_run_all`).
 */

export const PLAN_TOOL = 'sheetbase.plan.propose'

export const PLAN_PROPOSE_TOOL_NAMES = [PLAN_TOOL] as const

export type PlanProposeToolName = (typeof PLAN_PROPOSE_TOOL_NAMES)[number]

/** The two workspace rules, kept with the agent permissions. */
export const PLAN_PAUSE_DESTRUCTIVE = 'plan_pause_destructive'
export const PLAN_RUN_ALL = 'plan_run_all'

export const MIN_PLAN_STEPS = 2
export const MAX_PLAN_STEPS = 12

/**
 * Steps that stay a person's own decision. A plan never carries them: the
 * assistant offers each as a card of its own once the plan has run.
 */
const PERSONAL_STEP = /\.(decide|approve|sign|record_trained|acknowledge)$/

/** Steps that remove, cancel, retire or end something. */
const DESTRUCTIVE_STEP =
  /\.(delete[a-z_]*|dispose|cancel|retire|remove|revoke|archive|discard[a-z_]*|quarantine|suspend|withdraw|unshare_record|reservation_cancel|out_of_service|apply|end|leave|release|reject|unassign_training|disable)$/

export function isPersonalStep(tool: string): boolean {
  return PERSONAL_STEP.test(tool)
}

export function isDestructiveStep(tool: string): boolean {
  return DESTRUCTIVE_STEP.test(tool)
}

const title = z.string().min(1).max(120)
const summary = z.string().min(1).max(400)

export const planStepSchema = z.strictObject({
  title: title.describe('What this step does, in a few words.'),
  tool: z
    .string()
    .min(1)
    .max(120)
    .describe('The card tool this step would have used on its own.'),
  arguments: z
    .record(z.string(), z.unknown())
    .describe(
      'That tool’s arguments, written exactly as for a card of its own. Name anything an earlier step makes by the name or title that step gives it.',
    ),
})

export const proposePlanSchema = z.strictObject({
  title,
  summary,
  steps: z
    .array(planStepSchema)
    .min(MIN_PLAN_STEPS)
    .max(MAX_PLAN_STEPS)
    .describe(
      'The steps in the order they must happen. Make what other steps depend on first, such as the experiment, then what goes into it.',
    ),
})

export type PlanStepInput = z.infer<typeof planStepSchema>

/** One step of a plan card, as it travels with the card. */
export interface PlanStep {
  key: string
  title: string
  tool: string
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- A step's arguments belong to the tool it names; the server decodes them when its turn comes.
  arguments: Record<string, unknown>
  /** Pauses for its own approval unless the person runs everything. */
  destructive: boolean
}

export type PlanAction = {
  kind: 'plan.run'
  workspaceId: string
  steps: PlanStep[]
  /** The workspace rule for this person: pause at destructive steps. */
  pauseDestructive: boolean
  /** The workspace rule for this person: they may run every step at once. */
  runAllAllowed: boolean
}

export type PlanActionKind = PlanAction['kind']

export function isPlanAction(action: { kind: string }): action is PlanAction {
  return action.kind === 'plan.run'
}

export type PlanStepPhase =
  'waiting' | 'running' | 'done' | 'paused' | 'failed' | 'skipped'

export interface PlanStepState {
  phase: PlanStepPhase
  /** What went wrong, for a failed step. */
  message?: string
  /** Where what the step made lives. */
  openHref?: string
  /** A note the step made, such as a one-time link. */
  note?: string
}

export type PlanStepResult =
  | { ok: true; openHref?: string; note?: string }
  | { ok: false; message: string }

export type PlanOutcome =
  | { status: 'done' }
  | { status: 'paused'; at: number }
  | { status: 'failed'; at: number }

/**
 * Runs the steps in order from `from`. A destructive step pauses the plan
 * (unless `runAll`, or it is the step the person just approved on its own); a
 * step that fails stops it and leaves the rest skipped. Earlier steps stay done.
 */
export async function runPlan(input: {
  steps: readonly PlanStep[]
  from: number
  /** The step the person approved by itself, so it does not pause again. */
  approved?: number
  pauseDestructive: boolean
  runAll: boolean
  execute: (step: PlanStep, index: number) => Promise<PlanStepResult>
  onUpdate: (index: number, state: PlanStepState) => void
}): Promise<PlanOutcome> {
  for (let index = input.from; index < input.steps.length; index++) {
    const step = input.steps[index]

    if (
      step.destructive &&
      input.pauseDestructive &&
      !input.runAll &&
      index !== input.approved
    ) {
      input.onUpdate(index, { phase: 'paused' })

      return { status: 'paused', at: index }
    }

    input.onUpdate(index, { phase: 'running' })
    let result: PlanStepResult

    try {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Each step may name what the one before made, so they run one after another.
      result = await input.execute(step, index)
    } catch (error) {
      result = {
        ok: false,
        message: error instanceof Error ? error.message : 'It did not work.',
      }
    }

    if (!result.ok) {
      input.onUpdate(index, { phase: 'failed', message: result.message })

      for (let rest = index + 1; rest < input.steps.length; rest++) {
        input.onUpdate(rest, { phase: 'skipped' })
      }

      return { status: 'failed', at: index }
    }

    input.onUpdate(index, {
      phase: 'done',
      openHref: result.openHref,
      note: result.note,
    })
  }

  return { status: 'done' }
}
