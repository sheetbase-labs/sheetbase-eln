import type { DataClient } from './data-client'
import type {
  PipelinesAction,
  PipelinesActionResult,
} from './assistant-pipelines'

/**
 * Runs a pipeline or plugin card's action. Loaded only in the browser, when a
 * button is pressed: each one is the ordinary call, made as the person.
 */
export async function runPipelinesAction(
  client: DataClient,
  action: PipelinesAction,
): Promise<PipelinesActionResult | undefined> {
  switch (action.kind) {
    case 'pipeline.run': {
      const run = await client.rpc<{ id: string }>('run_pipeline_version', {
        p_version_id: action.versionId,
        p_parameters: action.parameters,
        p_input_versions: action.inputVersions,
      })

      return { openHref: `/pipelines/${action.definitionId}/runs/${run.id}` }
    }

    case 'pipeline.retry': {
      const run = await client.rpc<{ id: string }>('retry_pipeline_run', {
        p_run_id: action.runId,
      })

      return { openHref: `/pipelines/${action.definitionId}/runs/${run.id}` }
    }

    case 'pipeline.cancel':
      await client.rpc('cancel_pipeline_run', {
        p_workspace_id: action.workspaceId,
        p_run_id: action.runId,
      })

      return {
        openHref: `/pipelines/${action.definitionId}/runs/${action.runId}`,
      }
    case 'pipeline.publish':
      // Publishing needs an admin's approval: this asks for it. Deciding
      // stays with a person in the app.
      await client.rpc('request_pipeline_publish', {
        p_workspace_id: action.workspaceId,
        p_version_id: action.versionId,
        p_reason: action.reason,
      })

      return { openHref: `/pipelines/${action.definitionId}/steps` }
    case 'pipeline.retire':
      await client.rpc('update_pipeline_definition', {
        p_workspace_id: action.workspaceId,
        p_definition_id: action.definitionId,
        p_name: null,
        p_description: null,
        p_lifecycle: action.lifecycle,
      })

      return { openHref: `/pipelines/${action.definitionId}/steps` }
    case 'pipeline.convert':
      await client.rpc('convert_pipeline_to_standard', {
        p_workspace_id: action.workspaceId,
        p_definition_id: action.definitionId,
      })

      return { openHref: `/pipelines/${action.definitionId}/steps` }
    case 'pipeline.duplicate': {
      const created = await client.rpc<{ id: string }>(
        'duplicate_pipeline_definition',
        {
          p_workspace_id: action.workspaceId,
          p_version_id: action.versionId,
          p_key: action.key,
          p_name: action.name,
        },
      )

      return { openHref: `/pipelines/${created.id}` }
    }

    case 'pipeline.schedule_add':
      await client.rpc('create_pipeline_schedule', {
        p_workspace_id: action.workspaceId,
        p_definition_id: action.definitionId,
        p_kind: action.scheduleKind,
        p_spec: action.spec,
        p_enabled: true,
      })

      return { openHref: `/pipelines/${action.definitionId}/triggers` }
    case 'pipeline.schedule_switch':
      await client.rpc('update_pipeline_schedule', {
        p_workspace_id: action.workspaceId,
        p_schedule_id: action.scheduleId,
        p_kind: null,
        p_spec: null,
        p_enabled: action.enabled,
      })

      return { openHref: `/pipelines/${action.definitionId}/triggers` }
    case 'pipeline.schedule_delete':
      await client.rpc('delete_pipeline_schedule', {
        p_workspace_id: action.workspaceId,
        p_schedule_id: action.scheduleId,
      })

      return { openHref: `/pipelines/${action.definitionId}/triggers` }
    case 'plugin.switch':
      await client.rpc(
        action.enabled ? 'enable_extension' : 'disable_extension',
        {
          p_workspace_id: action.workspaceId,
          p_extension_id: action.extensionId,
        },
      )

      return { openHref: '/settings/workspace/plugins' }
    case 'plugin.remove':
      await client.rpc('remove_extension', {
        p_workspace_id: action.workspaceId,
        p_extension_id: action.extensionId,
      })

      return { openHref: '/settings/workspace/plugins' }
  }
}
