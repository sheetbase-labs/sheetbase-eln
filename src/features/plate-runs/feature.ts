/**
 * Plate runs in experiments: a run belongs to an experiment, shows in its
 * notebook as a live block, and is on the API, MCP, the assistant, pipelines and
 * webhooks like everything else the lab does.
 */
import { PLATE_RUN_OPERATIONS } from './operations'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'plate-runs',
  operations: PLATE_RUN_OPERATIONS,
  eventLabels: {
    'plate_run.linked': 'A plate run is added to an experiment',
    'plate_run.unlinked': 'A plate run is taken out of an experiment',
  },
})
