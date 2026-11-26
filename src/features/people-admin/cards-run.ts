import { runRpcAction } from '#/lib/assistant-admin-cards'
import type { DataClient } from '#/lib/data-client'
import { invitationLink } from '#/lib/workspace-admin'

import type { FeatureActionResult } from '../define'
import { PEOPLE_ADMIN_RPC } from './cards'
import type { PeopleAdminAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runPeopleAdminAction(
  client: Pick<DataClient, 'rpc'>,
  action: PeopleAdminAction,
): Promise<FeatureActionResult | undefined> {
  if (action.kind === 'people_admin.reissue_invitation') {
    const made = await client.rpc<{ token: string }>(
      PEOPLE_ADMIN_RPC[action.kind],
      { ...action.params },
    )

    // The new link is shown once, to the person who pressed the button.
    return {
      openHref: action.openHref ?? undefined,
      note: invitationLink(window.location.origin, made.token),
    }
  }

  return runRpcAction(client, PEOPLE_ADMIN_RPC, action)
}
