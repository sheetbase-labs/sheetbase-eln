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

/** The arguments `update_experiment_part` takes; a call sets only the ones it changes. */
type UpdateExperimentPartArgs = {
  p_part_id: string
  p_title?: string
  p_day_offset?: number
  p_assignee_user_id?: string
  p_clear_assignee?: true
}

/** Run a planning card's action through the ordinary RPCs. */
export async function runPlanningAction(
  client: DataClient,
  action: PlanningAction,
): Promise<PlanningActionResult | undefined> {
  switch (action.kind) {
    case 'experiment.start': {
      const made = await instantiateTemplate(
        client,
        action.title
          ? {
              templateRecordId: action.templateRecordId,
              targetProjectId: action.projectId,
              targetKind: 'experiment',
              title: action.title,
            }
          : {
              templateRecordId: action.templateRecordId,
              targetProjectId: action.projectId,
              targetKind: 'experiment',
            },
      )

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
    case 'step.done':
      await client.rpc(
        'set_step_done',
        action.note !== null
          ? {
              p_block_id: action.blockId,
              p_done: action.done,
              p_note: action.note,
            }
          : { p_block_id: action.blockId, p_done: action.done },
      )

      return undefined
    case 'part.add':
      await client.rpc(
        'create_experiment_part',
        action.dayOffset !== null
          ? {
              p_record_id: action.recordId,
              p_title: action.title,
              p_day_offset: action.dayOffset,
            }
          : { p_record_id: action.recordId, p_title: action.title },
      )

      return undefined
    case 'part.update': {
      const args: UpdateExperimentPartArgs = { p_part_id: action.partId }

      if (action.title !== null) args.p_title = action.title

      if (action.dayOffset !== null) args.p_day_offset = action.dayOffset

      if (action.assigneeUserId !== null)
        args.p_assignee_user_id = action.assigneeUserId

      if (action.clearAssignee) args.p_clear_assignee = true

      await client.rpc('update_experiment_part', args)

      return undefined
    }

    case 'part.done':
      await client.rpc('set_part_done', {
        p_part_id: action.partId,
        p_done: action.done,
      })

      return undefined
    case 'gate.go_on':
      await client.rpc(
        'override_gate',
        action.blockId
          ? { p_reason: action.reason, p_gate_block_id: action.blockId }
          : { p_reason: action.reason, p_gate_part_id: action.partId },
      )

      return undefined
    case 'part.signoff_request':
      await client.rpc('request_part_signoff', {
        p_part_id: action.partId,
        p_user_id: action.userId,
        p_note: action.note,
        p_due_at: null,
      })

      return undefined
    case 'step.result':
      await client.rpc(
        'add_step_result',
        action.unit !== null
          ? {
              p_block_id: action.blockId,
              p_label: action.label,
              p_value: action.value,
              p_unit: action.unit,
            }
          : {
              p_block_id: action.blockId,
              p_label: action.label,
              p_value: action.value,
            },
      )

      return undefined
    case 'series.add':
      await client.rpc(
        'add_series_member',
        action.plannedOn !== null
          ? {
              p_series_record_id: action.seriesRecordId,
              p_member_record_id: action.memberRecordId,
              p_planned_on: action.plannedOn,
            }
          : {
              p_series_record_id: action.seriesRecordId,
              p_member_record_id: action.memberRecordId,
            },
      )

      return { openHref: `/experiments/${action.seriesRecordId}/series` }
    case 'series.remove':
      await client.rpc('remove_series_member', {
        p_member_record_id: action.memberRecordId,
      })

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
