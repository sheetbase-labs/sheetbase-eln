/** Pipeline connection cards in the browser: which actions are ours, how they run, their words. */
import { defineAssistant } from '../define'
import { isPipelineConnectionAction } from './cards'
import type {
  PipelineConnectionAction,
  PipelineConnectionProposeToolName,
} from './cards'

const words = (key: string) => `features.pipelineConnections.cards.${key}`

export const assistant = defineAssistant<
  PipelineConnectionAction,
  PipelineConnectionProposeToolName
>()({
  isAction: isPipelineConnectionAction,
  async run(client, action) {
    // Loaded only when a card's button is pressed, in the person's session.
    const { runPipelineConnectionAction } = await import('./cards-run')

    return runPipelineConnectionAction(client, action)
  },
  cardWords: {
    'pipeline_connection.add': words('addConnection'),
    'pipeline_connection.change': words('changeConnection'),
    'pipeline_connection.remove': words('removeConnection'),
  },
})
