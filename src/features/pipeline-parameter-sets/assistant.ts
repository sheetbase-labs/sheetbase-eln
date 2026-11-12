/** Parameter set cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isParameterSetAction } from './cards'
import type { ParameterSetAction, ParameterSetProposeToolName } from './cards'

const words = (key: string) => `features.pipelineParameterSets.cards.${key}`

export const assistant = defineAssistant<
  ParameterSetAction,
  ParameterSetProposeToolName
>()({
  isAction: isParameterSetAction,
  async run(client, action) {
    const { runParameterSetAction } = await import('./cards-run')

    return runParameterSetAction(client, action)
  },
  cardWords: {
    'parameter_set.save': words('saveParameterSet'),
    'parameter_set.delete': words('deleteParameterSet'),
  },
})
