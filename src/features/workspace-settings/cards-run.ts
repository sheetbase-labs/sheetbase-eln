import { runRpcAction } from '#/lib/assistant-admin-cards'
import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import { WORKSPACE_SETTINGS_RPC } from './cards'
import type { WorkspaceSettingsAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runWorkspaceSettingsAction(
  client: Pick<DataClient, 'rpc'>,
  action: WorkspaceSettingsAction,
): Promise<FeatureActionResult | undefined> {
  if (action.kind === 'workspace_settings.ai') {
    // The app's own save checks the provider and keeps the audit record.
    const { updateAiSettingsFn } = await import('#/lib/ai-settings-actions')
    const { updateAiSettingsSchema } = await import('#/lib/ai-settings')

    await updateAiSettingsFn({
      data: updateAiSettingsSchema.parse(action.params),
    })

    return action.openHref ? { openHref: action.openHref } : undefined
  }

  if (action.kind === 'workspace_settings.access') {
    // One RPC per role, as the roles page does; stop at the first refusal.
    const { roles, ...rest } = action.params

    for (const role of Array.isArray(roles) ? roles : []) {
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Stop at the first refused role write; later roles must not change after an earlier permission failure.
      await client.rpc(WORKSPACE_SETTINGS_RPC[action.kind], {
        ...rest,
        p_role: role,
      })
    }

    return action.openHref ? { openHref: action.openHref } : undefined
  }

  return runRpcAction(client, WORKSPACE_SETTINGS_RPC, action)
}
