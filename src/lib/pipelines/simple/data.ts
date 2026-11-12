import type { DataClient } from '#/lib/data-client'
import type {
  PipelineDefinitionVersionWire,
  PipelineDefinitionWire,
} from '../types'

/** Convert a Simple pipeline to Standard. One way; the database keeps the rule. */
export function convertPipelineToStandard(
  client: DataClient,
  input: { workspaceId: string; definitionId: string },
): Promise<PipelineDefinitionVersionWire> {
  return client.rpc('convert_pipeline_to_standard', {
    p_workspace_id: input.workspaceId,
    p_definition_id: input.definitionId,
  })
}

/** Copy one version of a pipeline into a new pipeline, in the mode it was written in. */
export function duplicatePipelineDefinition(
  client: DataClient,
  input: { workspaceId: string; versionId: string; key: string; name: string },
): Promise<PipelineDefinitionWire> {
  return client.rpc('duplicate_pipeline_definition', {
    p_workspace_id: input.workspaceId,
    p_version_id: input.versionId,
    p_key: input.key,
    p_name: input.name,
  })
}
