import { z } from 'zod'

import type { StepCall, StepState } from '#/lib/assistant-steps'

/** What a finished call sent back to the browser besides "it worked". */
const outputSchema = z.looseObject({ refs: z.array(z.string()).optional() })

/** The step list's view of one tool part of a streamed message. */
export function stepCallOf(part: {
  toolName: string
  input?: unknown
  state: string
  output?: unknown
  errorText?: string
}): StepCall {
  const state: StepState =
    part.state === 'output-error'
      ? 'failed'
      : part.state === 'output-available'
        ? 'done'
        : 'running'

  return {
    toolName: part.toolName,
    input: part.input,
    state,
    refs: outputSchema.safeParse(part.output).data?.refs,
    error: part.errorText,
  }
}
