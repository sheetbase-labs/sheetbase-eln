/** The plan card in the browser: which action is ours and its words. */
import { defineAssistant } from '../define'
import { isPlanAction } from './plan'
import type { PlanAction, PlanProposeToolName } from './plan'

export const assistant = defineAssistant<PlanAction, PlanProposeToolName>()({
  isAction: isPlanAction,
  async run(client, action) {
    // The chat shows a plan on its own card with a button per step. This path
    // runs the whole plan without one, pausing nowhere, for a caller that has
    // the person's approval for every step.
    const { runPlanSteps } = await import('./run')

    return runPlanSteps(client, action)
  },
  cardWords: {
    'plan.run': 'features.plans.cards.runPlan',
  },
})
