/** The template version cards in the browser. */
import { defineAssistant } from '../define'
import { isTemplateVersionsAction } from './cards'
import type {
  TemplateVersionsAction,
  TemplateVersionsProposeToolName,
} from './cards'

export const assistant = defineAssistant<
  TemplateVersionsAction,
  TemplateVersionsProposeToolName
>()({
  isAction: isTemplateVersionsAction,
  async run(client, action) {
    const { runTemplateVersionsAction } = await import('./cards-run')

    return runTemplateVersionsAction(client, action)
  },
  cardWords: {
    'template.use': 'features.templateVersions.cards.use',
    'template.upgrade_notebook': 'features.templateVersions.cards.upgrade',
  },
})
