/** The automation cards in the browser: which actions are ours, how they run, their words. */
import { rpcActionGuard } from '#/lib/assistant-call-cards'

import { defineAssistant } from '../define'
import { AUTOMATION_ADMIN_CARDS } from './cards'
import type {
  AutomationAdminAction,
  AutomationAdminProposeToolName,
} from './cards'

export const assistant = defineAssistant<
  AutomationAdminAction,
  AutomationAdminProposeToolName
>()({
  isAction: rpcActionGuard(AUTOMATION_ADMIN_CARDS),
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runAutomationAdminAction } = await import('./cards-run')

    return runAutomationAdminAction(client, action)
  },
  cardWords: {
    'pipeline.version_retire': 'features.automationAdmin.cards.retireVersion',
    'pipeline.run_remind': 'features.automationAdmin.cards.remind',
    'recurring.create': 'features.automationAdmin.cards.repeat',
    'search.update': 'features.automationAdmin.cards.save',
    'search.delete': 'features.automationAdmin.cards.delete',
    'webhook.update': 'features.automationAdmin.cards.save',
    'webhook.delete': 'features.automationAdmin.cards.delete',
    'webhook.replay_delivery': 'features.automationAdmin.cards.replay',
    'webhook.replay_deliveries': 'features.automationAdmin.cards.replay',
    'schedule.request_proposal': 'features.automationAdmin.cards.planSchedule',
    'schedule.dismiss_proposal': 'features.automationAdmin.cards.dismissPlan',
    'watcher.run': 'features.automationAdmin.cards.runWatcher',
    'events.retention': 'features.automationAdmin.cards.save',
  },
})
