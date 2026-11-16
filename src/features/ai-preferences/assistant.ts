/** Preference cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isAiPreferenceAction } from './cards'
import type { AiPreferenceAction, AiPreferenceProposeToolName } from './cards'

const words = (key: string) => `features.aiPreferences.cards.${key}`

export const assistant = defineAssistant<
  AiPreferenceAction,
  AiPreferenceProposeToolName
>()({
  isAction: isAiPreferenceAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed, in the person's session.
    const { runAiPreferenceAction } = await import('./cards-run')

    return runAiPreferenceAction(client, action)
  },
  cardWords: {
    'ai_preference.save': words('save'),
    'ai_preference.update': words('update'),
    'ai_preference.delete': words('forget'),
  },
})
