import {
  approveRound,
  recordResults,
  requestRound,
  startCampaign,
} from './campaigns/data'
import { setModelFeature } from './features/data'
import type { DataClient } from './data-client'
import { applyPlan, createPlan } from './planner/data'
import type { PlannerAction, PlannerActionResult } from './assistant-planner'

/** Runs a planner or campaign card's action. Loaded only in the browser, when a button is pressed. */
export async function runPlannerAction(
  client: DataClient,
  action: PlannerAction,
): Promise<PlannerActionResult | undefined> {
  switch (action.kind) {
    case 'plan.apply': {
      const plan = await createPlan(client, {
        projectId: action.projectId,
        goal: action.goal,
        plan: action.plan,
        source: 'assistant',
      })
      const result = await applyPlan(client, plan.id)
      return { openHref: `/experiments/${result.recordId}` }
    }
    case 'model.feature':
      await setModelFeature(
        client,
        action.modelKey,
        action.feature,
        action.enabled,
      )
      return { openHref: '/models' }
    case 'campaign.start':
      await startCampaign(client, action.recordId)
      return { openHref: `/campaigns/${action.recordId}` }
    case 'campaign.round':
      await requestRound(client, action.recordId)
      return { openHref: `/campaigns/${action.recordId}` }
    case 'campaign.approve':
      await approveRound(client, action.roundId)
      return { openHref: `/campaigns/${action.recordId}` }
    case 'campaign.results':
      await recordResults(client, action.roundId, action.results)
      return { openHref: `/campaigns/${action.recordId}` }
  }
}
