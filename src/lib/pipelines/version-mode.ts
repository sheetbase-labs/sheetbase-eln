import { PIPELINE_MODES } from './config'
import type { PipelineMode } from './config'
import type { PipelineDefinitionVersionWire } from './types'

/** The mode a stored version was written in; versions from before modes were Standard. */
export function versionMode(
  version: PipelineDefinitionVersionWire,
): PipelineMode {
  const mode: unknown = version.configuration.mode

  return PIPELINE_MODES.find((m) => m === mode) ?? 'standard'
}
