/**
 * Simple pipelines: a recipe, Convert to Standard, History and Duplicate, on the
 * API, MCP, the assistant, pipelines and webhooks. A Simple version is written
 * through `create_pipeline_definition_version` like any other, with `mode:
 * "simple"` and a `recipe`; see `docs/api/pipelines-simple-api.md`.
 */
import { PIPELINE_SIMPLE_OPERATIONS } from './operations'
import { defineFeature } from '../define'

export const feature = defineFeature({
  name: 'pipeline-simple',
  operations: PIPELINE_SIMPLE_OPERATIONS,
})
