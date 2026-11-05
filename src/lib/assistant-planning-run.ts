import type { DataClient } from './data-client'
import { createRecordComment } from './comments-data'
import { createRepeat } from './recurring'
import {
  createShipment,
  markShipmentInTransit,
  receiveShipment,
} from './shipments'
import { startStepTimer } from './step-timers'
import { instantiateTemplate } from './templates'
import { prepareTimerAlerts } from './step-timer-alert'
import type { PlanningAction, PlanningActionResult } from './assistant-planning'

/** Runs a planning card's action. Loaded only in the browser, when a button is pressed. */

/** Run a planning card's action through the ordinary RPCs. */
export async function runPlanningAction(
  client: DataClient,
  action: PlanningAction,
): Promise<PlanningActionResult | undefined> {
  switch (action.kind) {
    case 'experiment.start': {
      const made = await instantiateTemplate(client, {
        templateRecordId: action.templateRecordId,
        targetProjectId: action.projectId,
        targetKind: 'experiment',
        ...(action.title ? { title: action.title } : {}),
      })
      return { openHref: `/records/${made.record.id}` }
    }
    case 'record.assign':
      await client.rpc('assign_record', {
        p_record_id: action.recordId,
        p_expected_metadata_version: action.expectedMetadataVersion,
        p_assignee_user_id: action.userId,
      })
      return { openHref: `/records/${action.recordId}` }
    case 'record.comment':
      await createRecordComment(client, {
        recordId: action.recordId,
        body: action.body,
        mentions: action.mentions,
      })
      return { openHref: `/records/${action.recordId}` }
    case 'booking.repeat':
      await createRepeat(client, action.input)
      return { openHref: '/schedule' }
    case 'timer.start':
      // A browser only allows asking for alerts from the press itself.
      await prepareTimerAlerts()
      await startStepTimer(action.blockId, action.seconds ?? undefined, client)
      return undefined
    case 'shipment.create': {
      const made = await createShipment(client, action.input)
      if (action.markSent) {
        await markShipmentInTransit(client, {
          shipmentId: made.id,
          shippedOn: '',
          carrier: action.input.carrier,
          trackingReference: action.input.trackingReference,
          expectedOn: action.input.expectedOn,
        })
      }
      return { openHref: '/shipments' }
    }
    case 'shipment.receive':
      await receiveShipment(client, {
        shipmentId: action.shipmentId,
        results: action.results,
        conditionNote: action.conditionNote,
      })
      return { openHref: '/shipments' }
  }
}
