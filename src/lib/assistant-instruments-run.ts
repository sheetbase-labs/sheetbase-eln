import type { DataClient } from './data-client'
import type {
  InstrumentsAction,
  InstrumentsActionResult,
} from './assistant-instruments'

/** Runs an instrument card's action. Loaded only in the browser, when a button is pressed. */
export async function runInstrumentsAction(
  client: DataClient,
  action: InstrumentsAction,
): Promise<InstrumentsActionResult | undefined> {
  switch (action.kind) {
    case 'instrument.add': {
      await client.rpc('create_instrument', {
        p_workspace_id: action.workspaceId,
        p_name: action.name,
        // JSON serialisation drops an absent type, so the call carries it only when set.
        p_instrument_type: action.instrumentType || undefined,
        p_model: action.model,
        p_serial_number: action.serialNumber,
        p_vendor: action.vendor,
        p_location: action.location,
      })

      return { openHref: '/instruments' }
    }

    case 'instrument.retire':
      await client.rpc('set_instrument_retired', {
        p_instrument_id: action.instrumentId,
        p_retired: action.retired,
      })

      return { openHref: '/instruments' }
    case 'instrument.calibrate':
      await client.rpc('record_instrument_calibration', {
        p_instrument_id: action.instrumentId,
        p_performed_at: action.performedAt,
        p_due_at: action.dueAt,
        p_notes: action.notes,
      })

      return { openHref: '/instruments' }
    case 'instrument.qualify':
      if (action.validUntil === null) {
        await client.rpc('revoke_instrument_qualification', {
          p_instrument_id: action.instrumentId,
          p_user_id: action.userId,
        })
      } else {
        await client.rpc('set_instrument_qualification', {
          p_instrument_id: action.instrumentId,
          p_user_id: action.userId,
          p_valid_until: action.validUntil,
          p_qualified_for: action.qualifiedFor,
        })
      }

      return { openHref: '/instruments' }
    case 'run.create':
      await client.rpc('create_instrument_run', {
        p_workspace_id: action.workspaceId,
        p_name: action.name,
        p_run_identifier: action.runIdentifier,
        p_instrument_id: action.instrumentId,
        p_protocol_name: action.protocolName,
        p_operator: action.operator,
      })

      return { openHref: '/instruments' }
    case 'run.update': {
      const args = {
        p_workspace_id: action.workspaceId,
        p_run_id: action.runId,
      }

      if (action.status === 'running')
        await client.rpc('start_instrument_run', args)
      else if (action.status === 'completed')
        await client.rpc('complete_instrument_run', args)
      else
        await client.rpc('fail_instrument_run', {
          ...args,
          p_error_message: action.error,
        })

      return { openHref: '/instruments' }
    }

    case 'connector.set':
      await client.rpc('update_connector', {
        p_workspace_id: action.workspaceId,
        p_connector_id: action.connectorId,
        p_status: action.status,
      })

      return { openHref: '/settings/workspace/integrations' }
  }
}
