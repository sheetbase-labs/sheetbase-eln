import { cancelAbsence, setAbsence } from './absences'
import { handOverWork } from './handover'
import { removeGroupMapping, setGroupMapping } from './group-roles'
import type { GroupRole } from './group-roles'
import type { DataClient } from './data-client'
import { setFollowing } from './follows'
import { markNotificationsRead } from './notifications-data'
import { cancelReagentOrder, markReagentOrdered } from './reagent-orders'
import {
  createSampleReservation,
  disposeSample,
  quarantineSample,
} from './samples'
import { cancelShipment } from './shipments'
import { logInstrumentService } from '../components/instruments/instruments-data'
import type { UpkeepAction, UpkeepActionResult } from './assistant-upkeep'

/** Runs an upkeep card's action. Loaded only in the browser, when a button is pressed. */

export async function runUpkeepAction(
  client: DataClient,
  action: UpkeepAction,
): Promise<UpkeepActionResult | undefined> {
  switch (action.kind) {
    case 'project.create': {
      const made = await client.rpc<{ id: string }>('create_project', {
        p_title: action.title,
        p_client_id: null,
        p_modality: null,
        p_stage: null,
        p_lead_user_id: null,
        p_default_reviewer_user_id: null,
        p_agreement_reference: null,
        p_started_on: action.startedOn,
      })
      return { openHref: `/projects/${made.id}` }
    }
    case 'follow.set':
      await setFollowing(client, action.target, action.id, action.following)
      return {
        openHref:
          action.target === 'project'
            ? `/projects/${action.id}`
            : `/records/${action.id}`,
      }
    case 'absence.set':
      await setAbsence(client, {
        workspaceId: action.workspaceId,
        startsOn: action.startsOn,
        endsOn: action.endsOn,
        delegateUserId: action.delegateUserId,
        note: action.note ?? '',
      })
      return { openHref: '/settings/account/away' }
    case 'handover.run':
      await handOverWork(client, {
        workspaceId: action.workspaceId,
        fromUserId: action.fromUserId,
        toUserId: action.toUserId,
        selection: action.selection,
      })
      return { openHref: '/settings/workspace/members' }
    case 'group_role.set':
      await setGroupMapping(client, {
        workspaceId: action.workspaceId,
        groupName: action.groupName,
        role: action.role as GroupRole,
      })
      return { openHref: '/settings/workspace/members' }
    case 'group_role.remove':
      await removeGroupMapping(client, action.mappingId)
      return { openHref: '/settings/workspace/members' }
    case 'absence.cancel':
      await cancelAbsence(client, action.absenceId)
      return { openHref: '/settings/account/away' }
    case 'notifications.read':
      await markNotificationsRead(client, null)
      return { openHref: '/inbox' }
    case 'reagent.ordered':
      await markReagentOrdered(client, {
        orderId: action.orderId,
        supplier: action.supplier,
        orderReference: action.orderReference,
        expectedOn: action.expectedOn,
      })
      return { openHref: '/materials' }
    case 'reagent.cancel':
      await cancelReagentOrder(client, action.orderId, action.reason)
      return { openHref: '/materials' }
    case 'shipment.cancel':
      await cancelShipment(client, action.shipmentId, action.reason)
      return { openHref: '/shipments' }
    case 'sample.reserve':
      await createSampleReservation(client, {
        recordId: action.recordId,
        experimentId: action.experimentId,
        quantity: action.quantity,
        unit: action.unit ?? undefined,
        notes: action.notes ?? undefined,
      })
      return { openHref: `/records/${action.recordId}` }
    case 'sample.quarantine':
      await quarantineSample(client, {
        recordId: action.recordId,
        expectedMetadataVersion: action.expectedMetadataVersion,
        reason: action.reason,
        notes: action.notes ?? undefined,
      })
      return { openHref: `/records/${action.recordId}` }
    case 'sample.dispose':
      await disposeSample(client, {
        recordId: action.recordId,
        expectedMetadataVersion: action.expectedMetadataVersion,
        reason: action.reason,
        notes: action.notes ?? undefined,
      })
      return { openHref: `/records/${action.recordId}` }
    case 'instrument.log':
      await logInstrumentService(
        {
          instrumentId: action.instrumentId,
          kind: action.serviceKind,
          visitedOn: action.visitedOn,
          summary: action.summary,
          details: action.details,
          performedBy: action.performedBy,
        },
        client,
      )
      return { openHref: '/instruments' }
  }
}
