import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import type { PipelineStartsAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runPipelineStartsAction(
  client: DataClient,
  action: PipelineStartsAction,
): Promise<FeatureActionResult | undefined> {
  await client.rpc('set_pipeline_start_rules', {
    p_workspace_id: action.workspaceId,
    p_definition_id: action.definitionId,
    p_rules: action.rules,
  })

  return { openHref: `/pipelines/${action.definitionId}/starts` }
}
