/** Cards in the browser: which actions are ours, how they run, their words. */
import { isPipelineRemoteAction } from './cards'
import type {
  PipelineRemoteAction,
  PipelineRemoteProposeToolName,
} from './cards'
import { defineAssistant } from '../define'

const words = (key: string) => `features.pipelineRemote.cards.${key}`

export const assistant = defineAssistant<
  PipelineRemoteAction,
  PipelineRemoteProposeToolName
>()({
  isAction: isPipelineRemoteAction,
  async run(client, action) {
    const { runPipelineRemoteAction } = await import('./cards-run')

    return runPipelineRemoteAction(client, action)
  },
  cardWords: {
    'pipeline.lakehouse_sql': words('switchLakehouseSql'),
  },
})
