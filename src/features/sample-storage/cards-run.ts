import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import type { SampleStorageAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runSampleStorageAction(
  client: Pick<DataClient, 'rpc'>,
  action: SampleStorageAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'sample.withdraw':
      await client.rpc('withdraw_sample', {
        p_record_id: action.recordId,
        p_quantity: action.quantity,
        p_expected_metadata_version: action.metadataVersion,
        p_purpose_experiment_id: action.experimentId,
        p_unit: action.unit,
        p_notes: action.notes,
        p_new_container: action.newContainer
          ? { title: action.newContainer }
          : null,
      })

      return { openHref: `/records/${action.recordId}` }

    case 'sample.label_printed':
      await client.rpc('record_sample_label_print', {
        p_record_id: action.recordId,
        p_expected_metadata_version: action.metadataVersion,
        p_note: `Printed label ${action.identifier}`,
      })

      return undefined

    case 'sample.match_locations': {
      const result = await client.rpc<{ matched: number; unmatched: number }>(
        'match_sample_locations',
        { p_workspace_id: action.workspaceId },
      )

      return {
        openHref: '/samples',
        note: `${result.matched} filed, ${result.unmatched} left as text.`,
      }
    }

    case 'storage.position_status':
      await client.rpc('set_position_status', {
        p_position_id: action.positionId,
        p_status: action.status,
        p_notes: action.notes,
      })

      return { openHref: '/settings/lab/storage' }

    case 'stocktake.scan':
      await client.rpc('record_stocktake_scan', {
        p_stocktake_id: action.stocktakeId,
        p_record_id: action.recordId,
        p_box_id: action.boxId,
      })

      return { openHref: `/stocktake/${action.stocktakeId}` }

    case 'stocktake.resolve':
      await client.rpc('resolve_stocktake_item', {
        p_item_id: action.itemId,
        p_action: action.action,
        p_notes: action.notes,
      })

      return { openHref: `/stocktake/${action.stocktakeId}` }

    case 'stocktake.cancel':
      await client.rpc('cancel_stocktake', {
        p_stocktake_id: action.stocktakeId,
      })

      return { openHref: '/stocktake' }

    case 'shipment.dispatch':
      await client.rpc('mark_shipment_in_transit', {
        p_shipment_id: action.shipmentId,
        p_shipped_on: action.shippedOn,
        p_carrier: action.carrier,
        p_tracking_reference: action.trackingReference,
        p_expected_on: action.expectedOn,
      })

      return { openHref: '/shipments' }

    case 'shipment.update':
      await client.rpc('update_shipment', {
        p_shipment_id: action.shipmentId,
        p_counterparty: action.counterparty,
        p_carrier: action.carrier,
        p_tracking_reference: action.trackingReference,
        p_expected_on: action.expectedOn,
        p_notes: action.notes,
      })

      return { openHref: '/shipments' }

    case 'material.safety':
      await client.rpc('set_material_safety', {
        p_record_id: action.recordId,
        p_pictograms: action.pictograms,
        p_signal_word: action.signalWord,
        p_hazard_statements: action.hazardStatements,
        p_all_lots: action.allLots,
      })

      return { openHref: '/materials' }

    case 'sample_workflow.save':
      await client.rpc('save_sample_workflow', {
        p_workflow_id: action.workflowId,
        p_definition: action.definition,
      })

      return { openHref: '/settings/lab/workflows' }

    case 'sample_workflow.set_status':
      await client.rpc('set_sample_workflow_status', {
        p_workflow_id: action.workflowId,
        p_status: action.status,
      })

      return { openHref: '/settings/lab/workflows' }

    case 'release_rules.set':
      await client.rpc('set_sample_release_rules', {
        p_workspace_id: action.workspaceId,
        p_sample_type: action.sampleType,
        p_rules: action.rules,
      })

      return { openHref: '/settings/lab/release' }
  }
}
