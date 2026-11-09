import type { DataClient } from './data-client'
import type { SchemaAction, SchemaActionResult } from './assistant-schema'

/**
 * Runs a record type, sheet definition or template card's action as the
 * person. Loaded only in the browser, when a button is pressed.
 */
export async function runSchemaAction(
  client: DataClient,
  action: SchemaAction,
): Promise<SchemaActionResult | undefined> {
  switch (action.kind) {
    case 'schema.model_create':
      if (action.parentKey)
        await client.rpc('create_model_subtype', {
          p_workspace_id: action.workspaceId,
          p_parent_key: action.parentKey,
          p_key: action.key,
          p_name: action.name,
          p_identifier_prefix: action.prefix,
          p_description: action.description,
        })
      else
        await client.rpc('create_workspace_model', {
          p_workspace_id: action.workspaceId,
          p_key: action.key,
          p_name: action.name,
          p_identifier_prefix: action.prefix,
          p_description: action.description,
        })

      return { openHref: `/models/${action.key}` }
    case 'schema.field_retire':
      await client.rpc('retire_model_field', {
        p_definition_id: action.fieldId,
      })

      return
    case 'schema.option_add':
      await client.rpc('create_model_field_option', {
        p_definition_id: action.fieldId,
        p_key: action.key,
        p_label: action.label,
        p_display_order: action.order,
      })

      return
    case 'schema.option_rename':
      await client.rpc('update_model_field_option', {
        p_option_id: action.optionId,
        p_label: action.label,
        p_display_order: action.order,
      })

      return
    case 'schema.option_retire':
      await client.rpc('retire_model_field_option', {
        p_option_id: action.optionId,
      })

      return
    case 'schema.rule_add':
      await client.rpc('create_model_rule', {
        p_workspace_id: action.workspaceId,
        p_model_key: action.modelKey,
        p_name: action.name,
        p_field_keys: action.fieldKeys,
        p_condition: action.condition,
        p_effect: action.effect,
        p_message: action.message,
      })

      return
    case 'schema.rule_update':
      await client.rpc('update_model_rule', {
        p_rule_id: action.ruleId,
        p_patch: action.patch,
      })

      return
    case 'schema.rule_remove':
      await client.rpc('remove_model_rule', { p_rule_id: action.ruleId })

      return
    case 'schema.link_rule_set':
      await client.rpc('configure_model_relationship_rule', {
        p_workspace_id: action.workspaceId,
        p_source_model_key: action.sourceKey,
        p_link_type: action.linkType,
        p_target_model_key: action.targetKey,
        p_min_links: action.min,
        p_max_links: action.max,
        p_label: action.label,
      })

      return
    case 'schema.link_rule_remove':
      await client.rpc('remove_model_relationship_rule', {
        p_rule_id: action.ruleId,
      })

      return
    case 'schema.model_version_start':
      await client.rpc('create_record_model_version', {
        p_model_id: action.modelId,
        p_reason: action.reason,
      })

      return
    case 'schema.model_version_publish':
      await client.rpc('publish_record_model_version', {
        p_version_id: action.versionId,
      })

      return
    case 'schema.sheet_definition_publish':
      await client.rpc('publish_sheet_definition_version', {
        p_version_id: action.versionId,
        p_expected_revision: action.revision,
      })

      return
    case 'schema.sheet_definition_lifecycle':
      await client.rpc(
        action.retire ? 'retire_sheet_definition' : 'restore_sheet_definition',
        {
          p_definition_id: action.definitionId,
          p_expected_revision: action.revision,
        },
      )

      return
    case 'schema.template_publish':
      await client.rpc('publish_notebook_template_version', {
        p_version_id: action.versionId,
        p_expected_revision: action.revision,
        p_reason: action.reason,
      })

      return
    case 'schema.sheet_rename':
      await client.rpc('rename_sheet_instance', {
        p_instance_id: action.instanceId,
        p_expected_revision: action.revision,
        p_name: action.name,
      })

      return { openHref: `/sheets/${action.instanceId}` }
  }
}
