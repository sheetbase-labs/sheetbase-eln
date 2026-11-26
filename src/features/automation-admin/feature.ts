/**
 * Pipelines and automation from the assistant: retire a pipeline version,
 * repeating work, saved searches, webhooks and their deliveries, schedule
 * plans, watchers and event-stream retention. The operations are declared
 * with the pipeline and integration operations; this folder holds the cards.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'automation-admin',
})
