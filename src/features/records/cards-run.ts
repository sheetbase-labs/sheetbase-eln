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

    case 'material.stock':
      await client.rpc('record_reagent_movement', {
        p_reagent_record_id: action.recordId,
        p_operation: action.operation,
        p_expected_metadata_version: action.metadataVersion,
        p_quantity_delta: action.quantity,
        p_reason: action.reason,
      })

      return { openHref: '/materials' }

    case 'sample.edit':
      await client.rpc('edit_sample', {
        p_record_id: action.recordId,
        p_expected_metadata_version: action.metadataVersion,
        p_title: action.name,
        p_tags: action.tags,
        p_notes: action.notes,
      })

      return { openHref: '/samples' }

    case 'sample.restore':
      await client.rpc('restore_sample', {
        p_record_id: action.recordId,
        p_expected_metadata_version: action.metadataVersion,
        p_notes: action.notes,
      })

      return { openHref: '/samples' }

    case 'storage.update_location':
      await client.rpc('update_storage_location', {
        p_level: action.level,
        p_id: action.id,
        p_name: action.name,
        p_code: action.code,
        p_temperature_min_c: action.temperatureMinC,
        p_temperature_max_c: action.temperatureMaxC,
      })

      return { openHref: '/settings/lab/storage' }

    case 'storage.archive_location':
      await client.rpc('set_storage_location_archived', {
        p_level: action.level,
        p_id: action.id,
        p_archived: action.archived,
      })

      return { openHref: '/settings/lab/storage' }

    case 'dataset.archive':
    case 'dataset.restore':
      await client.rpc(
        action.kind === 'dataset.archive'
          ? 'archive_dataset'
          : 'restore_dataset',
        { p_dataset_id: action.id, p_expected_revision: action.revision },
      )

      return undefined

    case 'sheet.archive':
    case 'sheet.restore':
      await client.rpc(
        action.kind === 'sheet.archive'
          ? 'archive_sheet_instance'
          : 'restore_sheet_instance',
        { p_instance_id: action.id, p_expected_revision: action.revision },
      )

      return { openHref: `/sheets/${action.id}` }

    case 'sheet.duplicate':
      await client.rpc('duplicate_sheet_instance', {
        p_instance_id: action.id,
        p_expected_revision: action.revision,
        p_name: action.name,
      })

      return undefined
  }
}
