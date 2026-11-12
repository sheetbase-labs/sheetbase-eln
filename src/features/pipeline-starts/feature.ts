/**
 * Pipeline starts and runs: the rules across a pipeline's starts, and the log
 * of what each start did, on the API, MCP, the assistant and webhooks.
 *
 * The schedules, webhook and run calls the tab edits are the `pipelines`
 * feature's; this one adds the rules and the cards that change them.
 */
import { defineFeature } from '../define'
import { PIPELINE_STARTS_OPERATIONS } from './operations'

export const feature = defineFeature({
  name: 'pipeline-starts',
  operations: PIPELINE_STARTS_OPERATIONS,
  notExposed: {
    remind_pipeline_run:
      'A nudge to a named colleague is sent by a person from the run’s panel; tokens, agents and pipelines never message people on their own. The run waiting for them already shows in their inbox.',
  },
})
