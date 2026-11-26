import type { DataClient } from '#/lib/data-client'
import { SUPPLIER_STARTER } from '#/lib/suppliers'

import type { FeatureActionResult } from '../define'
import type { ModelsAction } from './cards'

/** Runs the card in the person's own session, so their access applies. */
export async function runModelsAction(
  client: Pick<DataClient, 'rpc'>,
  action: ModelsAction,
): Promise<FeatureActionResult | undefined> {
  switch (action.kind) {
    case 'model.registry_create':
      await client.rpc('create_registry_model', {
        p_key: action.key,
        p_name: action.name,
        p_prefix: action.prefix,
        p_description: action.description,
        p_fields: action.fields,
        p_key_fields: action.keyFields,
        p_sequence_field: action.sequenceField,
      })

      return { openHref: `/models/${action.key}` }

    case 'model.request_create':
      await client.rpc('create_request_model', {
        p_key: action.key,
        p_name: action.name,
        p_prefix: action.prefix,
        p_description: action.description,
        p_fields: action.fields,
        p_intro: action.intro,
      })

      return { openHref: `/models/${action.key}` }

    case 'model.starter_create':
      await client.rpc('create_starter_model', {
        p_key: action.key,
        p_name: action.name,
        p_prefix: action.prefix,
        p_description: action.description,
        p_fields: action.fields,
        p_incident_log: action.incidentLog,
      })

      return { openHref: `/models/${action.key}` }

    case 'model.supplier_create':
      await client.rpc('create_supplier_model', {
        p_key: SUPPLIER_STARTER.key,
        p_name: SUPPLIER_STARTER.name,
        p_prefix: SUPPLIER_STARTER.prefix,
        p_description: SUPPLIER_STARTER.description,
        p_fields: SUPPLIER_STARTER.fields,
      })

      return { openHref: `/models/${SUPPLIER_STARTER.key}` }

    case 'model.registry_set':
      await client.rpc('set_model_registry', {
        p_model_key: action.key,
        p_is_registry: action.registry,
        p_key_fields: action.keyFields,
        p_sequence_field: action.sequenceField,
      })

      return { openHref: `/models/${action.key}` }

    case 'model.registry_lot_kind':
      await client.rpc('set_registry_lot_kind', {
        p_model_key: action.key,
        p_lot_kind: action.lotKind,
      })

      return { openHref: `/models/${action.key}` }

    case 'model.registry_sameness':
      await client.rpc('set_registry_sameness_rule', {
        p_model_key: action.key,
        p_plugin_item: action.rule,
      })

      return { openHref: `/models/${action.key}` }

    case 'model.incident_log_set':
      await client.rpc('set_model_incident_log', {
        p_model_key: action.key,
        p_enabled: action.enabled,
      })

      return { openHref: `/models/${action.key}` }

    case 'model.request_form_set':
      await client.rpc('set_request_form', {
        p_model_key: action.key,
        p_accepts: action.accepts,
        p_intro: action.intro,
        p_handler_user_ids: action.handlerUserIds,
      })

      return { openHref: `/models/${action.key}` }

    case 'model.supplier_list_set':
      await client.rpc('set_model_supplier_list', {
        p_model_key: action.key,
        p_enabled: action.enabled,
      })

      return { openHref: `/models/${action.key}` }

    case 'model_field.draft':
      await client.rpc('create_model_field', {
        p_workspace_id: action.workspaceId,
        p_model_key: action.modelKey,
        p_field_name: action.fieldName,
        p_label: action.label,
        p_logical_type: action.logicalType,
        p_nullable: action.nullable,
        p_unit: action.unit,
        p_description: action.description,
      })

      return { openHref: `/models/${action.modelKey}` }

    case 'model_field.add':
      await client.rpc('create_and_activate_model_field', {
        p_workspace_id: action.workspaceId,
        p_model_key: action.modelKey,
        p_field_name: action.fieldName,
        p_label: action.label,
        p_logical_type: action.logicalType,
        p_nullable: action.nullable,
        p_default_value: null,
        p_validation: {},
        p_options: action.options ?? [],
        p_unit: action.unit,
        p_description: action.description,
      })

      return { openHref: `/models/${action.modelKey}` }

    case 'model_field.activate':
      await client.rpc('activate_model_field', {
        p_definition_id: action.fieldId,
      })

      return { openHref: `/models/${action.modelKey}` }

    case 'model_field.update':
      await client.rpc('update_model_field', {
        p_definition_id: action.fieldId,
        p_patch: action.patch,
      })

      return { openHref: `/models/${action.modelKey}` }

    case 'model_field.semantics':
      // A value left undefined is left out of the call, so a column the person
      // did not mention keeps what it has.
      await client.rpc('configure_model_field_semantics', {
        p_definition_id: action.fieldId,
        p_quantity: action.quantity ?? undefined,
        p_cardinality: action.cardinality ?? undefined,
        p_relationship: action.relationship ?? undefined,
      })

      return { openHref: `/models/${action.modelKey}` }

    case 'model_field.evolve':
      await client.rpc('apply_model_field_evolution', {
        p_definition_id: action.fieldId,
        p_action: action.action,
        p_patch: action.patch,
        p_confirm: action.confirm,
      })

      return { openHref: `/models/${action.modelKey}` }

    case 'model_field.plugin_type':
      await client.rpc('set_field_plugin_type', {
        p_kind: action.modelKey,
        p_field_name: action.fieldName,
        p_plugin_key: action.pluginKey,
        p_type_id: action.typeId,
      })

      return { openHref: `/models/${action.modelKey}` }

    case 'model_field.promote':
      await client.rpc('promote_local_field', {
        p_instance_id: action.instanceId,
        p_field_id: action.fieldId,
        p_target: 'model_field',
        p_schema_definition_id: null,
        p_idempotency_key: action.idempotencyKey,
        p_model_key: action.modelKey,
        p_expected_revision: action.revision,
      })

      return { openHref: `/sheets/${action.instanceId}` }

    case 'record.set_type':
      await client.rpc('set_model_type', {
        p_host: action.host,
        p_id: action.id,
        p_model_key: action.modelKey,
        p_custom_fields: action.customFields,
      })

      return undefined

    case 'registry.remove_parent':
      await client.rpc('remove_registry_parent', {
        p_entry_id: action.entryId,
        p_parent_id: action.parentId,
      })

      return { openHref: `/records/${action.entryId}` }
  }
}
