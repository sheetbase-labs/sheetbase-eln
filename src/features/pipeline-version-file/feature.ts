/**
 * Advanced mode: the version file, a pipeline version written as YAML text. It
 * adds no tables, operations or events of its own. The file is read and written
 * in the app and in the SDKs' `push` and `pull`, and it is saved through the
 * existing pipeline version operations (`create_pipeline_definition_version`,
 * `update_pipeline_definition_version_draft`), so tokens, MCP, the assistant
 * and webhooks already cover it. See docs/subsystems/pipelines.md.
 */
import { defineFeature } from '../define'

export const feature = defineFeature({ name: 'pipeline-version-file' })
