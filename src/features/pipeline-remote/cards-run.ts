import type { DataClient } from '#/lib/data-client'
import type { PipelineRemoteAction } from './cards'
import type { FeatureActionResult } from '../define'

/** Runs a card's action. Loaded only in the browser, when a button is pressed. */
export async function runPipelineRemoteAction(
  client: DataClient,
  action: PipelineRemoteAction,
): Promise<FeatureActionResult | undefined> {
  await client.rpc('set_pipeline_lakehouse_sql', {
    p_workspace_id: action.workspaceId,
    p_enabled: action.enabled,
  })

  return { openHref: '/settings/workspace/open-data' }
}
