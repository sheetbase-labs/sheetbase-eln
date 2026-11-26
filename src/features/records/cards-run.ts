import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import type { RecordsAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runRecordsAction(
  client: Pick<DataClient, 'rpc'>,
  action: RecordsAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'records.create': {
      await client.rpc('create_model_record', {
        p_project_id: action.projectId,
        p_kind: action.recordKind,
        p_title: action.title,
        p_status: action.recordKind === 'material' ? 'available' : 'draft',
        p_tags: [],
        p_properties: action.properties,
        p_custom_fields: action.customFields,
      })

      return action.recordKind === 'material'
        ? { openHref: '/materials' }
        : undefined
    }

    case 'records.archive':
      await client.rpc('archive_record', {
        p_record_id: action.recordId,
        p_expected_metadata_version: action.metadataVersion,
      })

      return undefined

    case 'records.restore':
      await client.rpc('restore_record', {
        p_record_id: action.recordId,
        p_expected_metadata_version: action.metadataVersion,
      })

      return undefined

    case 'records.link':
      await client.rpc('create_record_link', {
        p_source_record_id: action.sourceId,
        p_target_kind: action.targetKind,
        p_target_identifier: action.targetIdentifier,
        p_link_type: action.linkType,
        p_target_record_id: action.targetId,
      })

      return undefined

    case 'material.add_lot':
      await client.rpc('register_replacement_lot', {
        p_reagent_record_id: action.recordId,
        p_lot: action.lot,
        p_expiry: action.expiry,
        p_quantity: action.quantity,
        p_unit: action.unit,
        p_reason: action.reason,
      })

      return { openHref: '/materials' }
  }
}
