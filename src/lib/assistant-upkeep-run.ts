import { z } from 'zod'

import { cancelAbsence, setAbsence } from './absences'
import { handOverWork } from './handover'
import { GROUP_ROLES, removeGroupMapping, setGroupMapping } from './group-roles'
import type { DataClient } from './data-client'
import { setFollowing } from './follows'
import { markNotificationsRead } from './notifications-data'
import { cancelReagentOrder, markReagentOrdered } from './reagent-orders'
import {
  archiveSample,
  cancelSampleReservation,
  createSampleReservation,
  disposeSample,
  quarantineSample,
  receiveSample,
  restoreSample,
} from './samples'
import { moveSampleToPosition } from './storage-positions'
import { cancelShipment } from './shipments'
import { addRule, runCheck } from './data-contracts/client'
import { startValidationRun } from './validation/client'
import { reproducePipelineRun } from './pipelines/data'
import { logInstrumentService } from '../components/instruments/instruments-data'
import {
  requestSignatureTimestamp,
  setTimestampSettings,
} from './timestamps/client'
import { requestPublication, setLakeSettings } from './open-data/client'
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
        role: z.enum(GROUP_ROLES).parse(action.role),
      })

      return { openHref: '/settings/workspace/members' }
    case 'group_role.remove':
      await removeGroupMapping(client, action.mappingId)

      return { openHref: '/settings/workspace/members' }
    case 'scim_token.revoke':
      await client.rpc('revoke_scim_token', { p_id: action.tokenId })

      return { openHref: '/settings/workspace/members' }
    case 'timestamps.set':
      await setTimestampSettings(client, {
        workspaceId: action.workspaceId,
        enabled: action.service !== 'off',
        authority: action.service === 'off' ? null : action.service,
        url: action.address,
      })

      return { openHref: '/settings/workspace/audit' }
    case 'timestamps.retry':
      await requestSignatureTimestamp(client, action.signatureId)

      return { openHref: '/settings/workspace/audit' }
    case 'contract.check':
      await runCheck(client, action.contractId)

      return { openHref: '/models' }
    case 'contract.rule_add':
      await addRule(client, action.contractId, action.rule)

      return { openHref: '/models' }
    case 'open_tables.set':
      await setLakeSettings(client, action.workspaceId, action.enabled)

      return { openHref: '/settings/workspace/open-data' }
    case 'publication.request':
      await requestPublication(client, {
        targetId: action.targetId,
        kind: action.objectKind,
        objectId: action.objectId,
        title: action.title,
        license: action.license,
      })

      return {
        openHref:
          action.objectKind === 'experiment'
            ? `/experiments/${action.objectId}`
            : undefined,
      }
    case 'validation.run':
      await startValidationRun()

      return { openHref: '/settings/workspace/validation' }
    case 'pipeline.reproduce':
      await reproducePipelineRun({ runId: action.runId })

      return {
        openHref: `/pipelines/${action.definitionId}/runs/${action.runId}#reproduce`,
      }
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
    case 'sample.receive':
      await receiveSample(client, {
        recordId: action.recordId,
        expectedMetadataVersion: action.expectedMetadataVersion,
        quantity: action.quantity,
        unit: action.unit ?? undefined,
        location: action.location ?? undefined,
        notes: action.notes ?? undefined,
      })

      return { openHref: `/records/${action.recordId}` }
    case 'sample.archive': {
      const input = {
        recordId: action.recordId,
        expectedMetadataVersion: action.expectedMetadataVersion,
        notes: action.notes ?? undefined,
      }

      if (action.archived) await archiveSample(client, input)
      else await restoreSample(client, input)

      return { openHref: `/records/${action.recordId}` }
    }

    case 'sample.reservation_cancel':
      await cancelSampleReservation(client, {
        reservationId: action.reservationId,
      })

      return { openHref: '/samples' }
    case 'storage.place':
      if (action.positionId) {
        await moveSampleToPosition(client, {
          recordId: action.recordId,
          positionId: action.positionId,
          expectedMetadataVersion: action.expectedMetadataVersion,
          notes: action.notes ?? undefined,
        })
      } else {
        await client.rpc('remove_sample_from_position', {
          p_record_id: action.recordId,
          p_expected_metadata_version: action.expectedMetadataVersion,
          p_notes: action.notes ?? null,
        })
      }

      return { openHref: `/records/${action.recordId}` }
    case 'storage.add_location':
      if (action.level === 'box') {
        await client.rpc('create_storage_box', {
          p_workspace_id: action.workspaceId,
          p_rack_id: action.parentId,
          p_name: action.name,
          p_code: action.code ?? action.name,
          p_rows: action.rows ?? 9,
          p_cols: action.cols ?? 9,
        })
      } else {
        await client.rpc('create_storage_location', {
          p_workspace_id: action.workspaceId,
          p_level: action.level,
          p_parent_location_id: action.parentId,
          p_name: action.name,
          p_code: action.code,
          p_unit_type: action.unitType,
        })
      }

      return { openHref: '/settings/lab/storage' }
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
