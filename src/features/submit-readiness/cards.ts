import { z } from 'zod'

import { assistantToolsFrom } from '#/lib/operations/descriptor'

import { SUBMIT_READINESS_OPERATIONS } from './operations'

/**
 * Submit readiness from the assistant: change whether open steps and a missing
 * decision stop a submission. A card, like every write: nothing happens until
 * the person presses its button, which calls `set_submit_readiness_mode` in
 * their own session.
 */

export const SUBMIT_READINESS_TOOL = 'sheetbase.submit_readiness.set'

export const SUBMIT_READINESS_PROPOSE_TOOL_NAMES: readonly string[] =
  assistantToolsFrom(SUBMIT_READINESS_OPERATIONS, 'propose')

export type SubmitReadinessProposeToolName = typeof SUBMIT_READINESS_TOOL

export const SUBMIT_READINESS_MODES = ['off', 'warn', 'block'] as const

export type SubmitReadinessMode = (typeof SUBMIT_READINESS_MODES)[number]

export const proposeSubmitReadinessSchema = z.strictObject({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
  mode: z
    .enum(SUBMIT_READINESS_MODES)
    .describe(
      '`off` does not check, `warn` lists open steps and a missing decision but lets the submit through, `block` refuses the submit until they are cleared.',
    ),
})

/** What the card does when its button is pressed. */
export type SubmitReadinessAction = {
  kind: 'submit_readiness.set'
  workspaceId: string
  mode: SubmitReadinessMode
}

export function isSubmitReadinessAction(action: {
  kind: string
}): action is SubmitReadinessAction {
  return action.kind === 'submit_readiness.set'
}
