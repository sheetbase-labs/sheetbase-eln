import type { DataClient } from './data-client'
import { createPlannedExperiment } from './planner/data'
import type { PlannerAction, PlannerActionResult } from './assistant-planner'

/** Runs a planner card's action. Loaded only in the browser, when a button is pressed. */
export async function runPlannerAction(
  client: DataClient,
  action: PlannerAction,
): Promise<PlannerActionResult | undefined> {
  const result = await createPlannedExperiment(client, {
    projectId: action.projectId,
    plan: action.plan,
  })
  return { openHref: `/experiments/${result.recordId}` }
}
