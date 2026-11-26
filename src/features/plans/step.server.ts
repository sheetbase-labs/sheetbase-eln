import type { z } from 'zod'

import type { PlanStepAnswer, buildStepSchema } from './step'

/**
 * The server half of building one plan step: finds the tool the model listed,
 * runs it as the person (so what they may see decides what it finds) and hands
 * back the card it made. Nothing is written here.
 */
export async function buildPlanStepAnswer(
  data: z.input<typeof buildStepSchema>,
  headers?: Headers,
): Promise<PlanStepAnswer> {
  const [{ resolveAssistantRuntime }, { planStepTools }, catalogue] =
    await Promise.all([
      import('#/lib/assistant-actions'),
      import('./plan.server'),
      import('#/lib/agent-tool-catalogue'),
    ])

  if (!planStepTools().has(data.tool)) {
    return { ok: false, message: 'That is not a step a plan can run.' }
  }

  const runtime = await resolveAssistantRuntime(data.workspaceId, headers)

  if (!runtime.ok) {
    return {
      ok: false,
      message: 'The assistant is not available for this workspace.',
    }
  }

  const toolkit = runtime.deps.toolkit

  if (!toolkit) {
    return { ok: false, message: 'Changes from the assistant are off.' }
  }

  const result = await toolkit.run(
    catalogue.toWireToolName(data.tool),
    JSON.stringify(data.arguments),
  )

  return result.proposal && !result.isError
    ? { ok: true, proposal: JSON.stringify(result.proposal) }
    : { ok: false, message: result.text }
}
