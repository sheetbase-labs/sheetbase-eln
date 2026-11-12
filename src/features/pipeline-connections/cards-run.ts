import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import type { PipelineConnectionAction } from './cards'

const PAGE = '/settings/workspace/integrations'

/** Runs a connection card's action in the person's own session, when its button is pressed. */
export async function runPipelineConnectionAction(
  client: DataClient,
  action: PipelineConnectionAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'pipeline_connection.add':
      await client.rpc('create_pipeline_connection', {
        p_workspace_id: action.workspaceId,
        p_key: action.key,
        p_name: action.name,
        p_base_url: action.baseUrl,
        p_description: action.description,
        p_kind: action.connectionKind,
        p_settings: action.settings ?? undefined,
      })

      return { openHref: PAGE }
    case 'pipeline_connection.change':
      await client.rpc('update_pipeline_connection', {
        p_workspace_id: action.workspaceId,
        p_connection_id: action.connectionId,
        p_name: action.name,
        p_base_url: action.baseUrl,
        p_status: action.status,
        p_settings: action.settings ?? undefined,
      })

      return { openHref: PAGE }
    case 'pipeline_connection.remove':
      await client.rpc('delete_pipeline_connection', {
        p_workspace_id: action.workspaceId,
        p_connection_id: action.connectionId,
      })

      return { openHref: PAGE }
  }
}
