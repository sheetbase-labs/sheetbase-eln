/** Pipeline and plugin cards in the browser: which actions are ours, how they run, their words. */
import { isPipelinesAction } from '#/lib/assistant-pipelines'
import type {
  PipelinesAction,
  PipelinesProposeToolName,
} from '#/lib/assistant-pipelines'
import { defineAssistant } from '../define'

const words = (key: string) => `features.pipelines.cards.${key}`

export const assistant = defineAssistant<
  PipelinesAction,
  PipelinesProposeToolName
>()({
  isAction: isPipelinesAction,
  async run(client, action) {
    // Pipeline and plugin jobs load only when a card's button is pressed.
    const { runPipelinesAction } = await import('#/lib/assistant-pipelines-run')

    return runPipelinesAction(client, action)
  },
  cardWords: {
    'pipeline.run': words('runPipeline'),
    'pipeline.retry': words('retryPipelineRun'),
    'pipeline.cancel': words('cancelPipelineRun'),
    'pipeline.publish': words('publishPipeline'),
    'pipeline.retire': words('retirePipeline'),
    'pipeline.convert': 'features.pipelineSimple.cards.convertPipeline',
    'pipeline.duplicate': 'features.pipelineSimple.cards.duplicatePipeline',
    'inbox.leave_item': 'features.pipelineSimple.cards.leaveInboxItem',
    'inbox.list_expiring': 'features.pipelineSimple.cards.listExpiringStock',
    'pipeline.schedule_add': words('addPipelineSchedule'),
    'pipeline.schedule_switch': words('switchPipelineSchedule'),
    'pipeline.schedule_delete': words('deletePipelineSchedule'),
    'plugin.switch': words('switchPlugin'),
    'plugin.remove': words('removePlugin'),
  },
})
