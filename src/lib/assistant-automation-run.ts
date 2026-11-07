import type { DataClient } from './data-client'
import { queueJob } from './robots'
import { acceptProposal, requestProposal } from './scheduler'
import type {
  AutomationAction,
  AutomationActionResult,
} from './assistant-automation'

/** Runs an automation card's action. Loaded only in the browser, when a button is pressed. */
export async function runAutomationAction(
  client: DataClient,
  action: AutomationAction,
): Promise<AutomationActionResult | undefined> {
  switch (action.kind) {
    case 'robot.send':
      await queueJob(client, {
        instrumentId: action.instrumentId,
        worklistId: action.worklistId,
        note: action.note ?? undefined,
      })
      return { openHref: `/instruments/${action.instrumentId}` }
    case 'schedule.plan':
      await requestProposal(client, action.recordId)
      return { openHref: `/experiments/${action.recordId}/summary` }
    case 'schedule.accept':
      await acceptProposal(client, action.proposalId)
      return { openHref: `/experiments/${action.recordId}/summary` }
  }
}
