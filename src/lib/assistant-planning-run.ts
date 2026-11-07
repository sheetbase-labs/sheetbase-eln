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
    case 'step.done':
      await client.rpc('set_step_done', {
        p_block_id: action.blockId,
        p_done: action.done,
        ...(action.note !== null ? { p_note: action.note } : {}),
      })
      return undefined
    case 'part.add':
      await client.rpc('create_experiment_part', {
        p_record_id: action.recordId,
        p_title: action.title,
        ...(action.dayOffset !== null
          ? { p_day_offset: action.dayOffset }
          : {}),
      })
      return undefined
    case 'part.update':
      await client.rpc('update_experiment_part', {
        p_part_id: action.partId,
        ...(action.title !== null ? { p_title: action.title } : {}),
        ...(action.dayOffset !== null
          ? { p_day_offset: action.dayOffset }
          : {}),
        ...(action.assigneeUserId !== null
          ? { p_assignee_user_id: action.assigneeUserId }
          : {}),
        ...(action.clearAssignee ? { p_clear_assignee: true } : {}),
      })
      return undefined
    case 'part.done':
      await client.rpc('set_part_done', {
        p_part_id: action.partId,
        p_done: action.done,
      })
      return undefined
    case 'gate.go_on':
      await client.rpc('override_gate', {
        ...(action.blockId
          ? { p_gate_block_id: action.blockId }
          : { p_gate_part_id: action.partId }),
        p_reason: action.reason,
      })
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
      await client.rpc('add_step_result', {
        p_block_id: action.blockId,
        p_label: action.label,
        p_value: action.value,
        ...(action.unit !== null ? { p_unit: action.unit } : {}),
      })
      return undefined
    case 'series.add':
      await client.rpc('add_series_member', {
        p_series_record_id: action.seriesRecordId,
        p_member_record_id: action.memberRecordId,
        ...(action.plannedOn !== null
          ? { p_planned_on: action.plannedOn }
          : {}),
      })
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
