import type { DataClient } from '#/lib/data-client'

import type { FeatureActionResult } from '../define'
import type { AiPreferenceAction } from './cards'

const PAGE = '/settings/account/ai-preferences'

/**
 * Runs a preference card's action. Loaded only in the browser, when a button
 * is pressed, so it runs in the person's own session: they, not the
 * assistant, are the one saving.
 */
export async function runAiPreferenceAction(
  client: DataClient,
  action: AiPreferenceAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'ai_preference.save':
      await client.rpc('save_ai_preference', {
        p_body: action.body,
        p_scope: action.scope,
        p_topic: action.topic,
      })

      return { openHref: PAGE }
    case 'ai_preference.update':
      await client.rpc('update_ai_preference', {
        p_preference_id: action.preferenceId,
        p_body: action.body,
        p_topic: action.topic,
      })

      return { openHref: PAGE }
    case 'ai_preference.delete':
      await client.rpc('delete_ai_preference', {
        p_preference_id: action.preferenceId,
      })

      return { openHref: PAGE }
  }
}
