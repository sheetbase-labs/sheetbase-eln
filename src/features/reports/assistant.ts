/** The report cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isReportsAction } from './cards'
import type { ReportsAction, ReportsProposeToolName } from './cards'

export const assistant = defineAssistant<
  ReportsAction,
  ReportsProposeToolName
>()({
  isAction: isReportsAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed.
    const { runReportsAction } = await import('./cards-run')

    return runReportsAction(client, action)
  },
  cardWords: {
    'report.create': 'features.reports.cards.create',
    'report.update': 'features.reports.cards.edit',
    'report.section_add': 'features.reports.cards.addSection',
    'report.section_update': 'features.reports.cards.edit',
    'report.section_bind': 'features.reports.cards.bind',
    'report.section_remove': 'features.reports.cards.removeSection',
    'report.sections_reorder': 'features.reports.cards.reorder',
    'report.schedule_save': 'features.reports.cards.saveSchedule',
    'report.schedule_active': 'features.reports.cards.setActive',
    'report.schedule_send': 'features.reports.cards.sendNow',
    'report.schedule_delete': 'features.reports.cards.deleteSchedule',
  },
})
