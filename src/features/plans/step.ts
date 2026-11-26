import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import type { AssistantProposal } from '#/lib/assistant-proposals'

/**
 * Builds one step of an approved plan when its turn comes. The step is the
 * tool call the model listed; it is built exactly as if the model had made it
 * as a card of its own, but now, so it finds what the steps before it made.
 * The person's own session builds it, so what they may see and do still decides
 * what it finds. Nothing is written here: the card's runner does that.
 */

export const buildStepSchema = z.strictObject({
  workspaceId: z.string().uuid(),
  tool: z.string().min(1).max(120),
  arguments: z.record(z.string(), z.unknown()),
})

/** The built step travels as text: a card is a deep union the server-function types cannot follow. */
export type PlanStepAnswer =
  { ok: true; proposal: string } | { ok: false; message: string }

export type PlanStepBuild =
  { ok: true; proposal: AssistantProposal } | { ok: false; message: string }

export const buildPlanStepFn = createServerFn({ method: 'POST' })
  .validator((input: z.input<typeof buildStepSchema>) =>
    buildStepSchema.parse(input),
  )
  .handler(async ({ data }): Promise<PlanStepAnswer> => {
    const { buildPlanStepAnswer } = await import('./step.server')

    return buildPlanStepAnswer(data)
  })

/** Builds one step and hands back the card the model would have made for it. */
export async function buildPlanStep(input: {
  workspaceId: string
  tool: string
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- A step's arguments belong to the tool it names; the server decodes them when its turn comes.
  arguments: Record<string, unknown>
}): Promise<PlanStepBuild> {
  const answer = await buildPlanStepFn({ data: input })

  if (!answer.ok) return answer

  // SAFETY: the text is the JSON of a card this same server built a moment ago, and cards are plain data.
  const proposal: AssistantProposal = JSON.parse(answer.proposal)

  return { ok: true, proposal }
}
