import { runAssistantAction } from '#/lib/assistant-booking'
import { describeActionError } from '#/lib/assistant-bench'
import type { AssistantProposal } from '#/lib/assistant-proposals'
import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { runPlan } from './plan'
import type { PlanAction, PlanStep, PlanStepResult } from './plan'
import { buildPlanStep } from './step'

/**
 * Runs a plan's steps as the person. Each step is built when its turn comes
 * (so it finds what the steps before it made) and then runs the way a card of
 * its own would, through the ordinary RPCs.
 */

/** How one built step is applied; the chat card supplies its own, with operations. */
export type ApplyBuilt = (
  proposal: AssistantProposal,
) => Promise<PlanStepResult>

/** The everyday-action path, used when the caller has nothing for operation proposals. */
export function applyBuiltAction(client: DataClient): ApplyBuilt {
  return async (proposal) => {
    if (!proposal.action) {
      return {
        ok: false,
        message: 'That kind of change cannot run inside a plan yet.',
      }
    }

    try {
      const result = await runAssistantAction(client, proposal.action)

      return { ok: true, openHref: result?.openHref, note: result?.note }
    } catch (error) {
      return { ok: false, message: describeActionError(error) }
    }
  }
}

/** Builds one step, then applies it. */
export async function runPlanStep(
  workspaceId: string,
  step: PlanStep,
  apply: ApplyBuilt,
): Promise<PlanStepResult> {
  const built = await buildPlanStep({
    workspaceId,
    tool: step.tool,
    arguments: step.arguments,
  })

  if (!built.ok) return { ok: false, message: built.message }

  return apply(built.proposal)
}

/** The whole plan without a card: every step in order, pausing nowhere. */
export async function runPlanSteps(
  client: DataClient,
  action: PlanAction,
): Promise<FeatureActionResult | undefined> {
  const apply = applyBuiltAction(client)
  let note: string | undefined
  let openHref: string | undefined
  let failure: string | undefined

  const outcome = await runPlan({
    steps: action.steps,
    from: 0,
    pauseDestructive: false,
    runAll: true,
    execute: (step) => runPlanStep(action.workspaceId, step, apply),
    onUpdate: (_index, state) => {
      if (state.phase === 'failed') failure = state.message

      if (state.openHref) openHref = state.openHref

      if (state.note) note = state.note
    },
  })

  if (outcome.status === 'failed')
    throw new Error(failure ?? 'It did not work.')

  return { openHref, note }
}
