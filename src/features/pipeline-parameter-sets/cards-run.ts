import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import type { ParameterSetAction } from './cards'

/**
 * Runs a parameter set card's action. Loaded only in the browser, when a
 * button is pressed, so it runs in the person's own session.
 */
export async function runParameterSetAction(
  client: DataClient,
  action: ParameterSetAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'parameter_set.save':
      await client.rpc('save_pipeline_parameter_set', {
        p_workspace_id: action.workspaceId,
        p_key: action.key,
        p_name: action.name,
        p_parameters: action.parameters,
        p_description: action.description,
      })

      return { openHref: '/pipelines/parameter-sets' }
    case 'parameter_set.delete':
      await client.rpc('delete_pipeline_parameter_set', {
        p_workspace_id: action.workspaceId,
        p_set_id: action.setId,
      })

      return { openHref: '/pipelines/parameter-sets' }
  }
}
