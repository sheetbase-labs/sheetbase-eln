import type { DataClient } from './data-client'
import type {
  DatasetsAction,
  DatasetsActionResult,
  TableField,
} from './assistant-datasets'

const tableHref = (definitionId: string) => `/models/${definitionId}`
const datasetHref = (datasetId: string) => `/datasets/${datasetId}`

/** Runs a dataset or measurement table card's action. Loaded only in the browser, when a button is pressed. */
export async function runDatasetsAction(
  client: DataClient,
  action: DatasetsAction,
): Promise<DatasetsActionResult | undefined> {
  switch (action.kind) {
    case 'measurement_table.create': {
      const created = await client.rpc<{
        schema_definition_id: string
        schema_version_id: string
      }>(
        action.parentId
          ? 'create_dataset_schema_subtype'
          : 'create_dataset_schema_definition',
        action.parentId
          ? {
              p_parent_id: action.parentId,
              p_key: action.key,
              p_name: action.name,
              p_description: action.description,
            }
          : {
              p_workspace_id: action.workspaceId,
              p_key: action.key,
              p_name: action.name,
              p_description: action.description,
              p_fields: action.fields,
            },
      )

      if (action.parentId && action.fields.length > 0) {
        // A table that extends another starts with the parent's columns; its
        // own come after them.
        const inherited = await client.list<TableField>(
          'dataset_schema_version_fields',
          `?schema_version_id=eq.${encodeURIComponent(created.schema_version_id)}&order=display_order.asc`,
        )

        await client.rpc('replace_dataset_schema_version_fields', {
          p_schema_version_id: created.schema_version_id,
          p_fields: [...inherited, ...action.fields],
        })
      }

      return { openHref: tableHref(created.schema_definition_id) }
    }

    case 'measurement_table.edit': {
      let versionId = action.draftVersionId
      let expectedRevision = action.expectedRevision

      if (!versionId) {
        const next = await client.rpc<{ schema_version_id: string }>(
          'create_next_dataset_schema_version',
          { p_schema_definition_id: action.definitionId },
        )

        versionId = next.schema_version_id
        expectedRevision = null
      }

      await client.rpc('replace_dataset_schema_version_fields', {
        p_schema_version_id: versionId,
        p_fields: action.fields,
        p_expected_revision: expectedRevision,
      })

      return { openHref: tableHref(action.definitionId) }
    }

    case 'measurement_table.publish':
      await client.rpc('publish_dataset_schema_version', {
        p_schema_version_id: action.versionId,
      })

      return { openHref: tableHref(action.definitionId) }
    case 'measurement_table.discard_draft':
      await client.rpc('delete_dataset_schema_version', {
        p_schema_version_id: action.versionId,
      })

      return { openHref: tableHref(action.definitionId) }
    case 'measurement_table.retire':
      await client.rpc('retire_dataset_schema_definition', {
        p_schema_definition_id: action.definitionId,
      })

      return { openHref: tableHref(action.definitionId) }
    case 'measurement_table.restore':
      await client.rpc('restore_dataset_schema_definition', {
        p_schema_definition_id: action.definitionId,
      })

      return { openHref: tableHref(action.definitionId) }
    case 'dataset.upgrade_table':
      await client.rpc('apply_dataset_model_upgrade', {
        p_dataset_id: action.datasetId,
        p_target_version_id: action.targetVersionId,
        p_expected_revision: action.expectedRevision,
      })

      return { openHref: datasetHref(action.datasetId) }
    case 'dataset.flag_value':
      await client.rpc('flag_dataset_value', {
        p_dataset_id: action.datasetId,
        p_row_id: action.rowId,
        p_field_id: action.fieldId,
        p_kind: action.flagKind,
        p_reason: action.reason,
        p_comment: action.comment,
      })

      return { openHref: datasetHref(action.datasetId) }
    case 'dataset.clear_flag':
      await client.rpc('clear_dataset_value_flag', {
        p_flag_id: action.flagId,
        p_reason: action.reason,
      })

      return { openHref: datasetHref(action.datasetId) }
    case 'dataset.set_unit':
      await client.rpc('set_dataset_column_unit', {
        p_dataset_id: action.datasetId,
        p_field_key: action.fieldKey,
        p_unit: action.unit,
        p_reason: action.reason,
      })

      return { openHref: datasetHref(action.datasetId) }
    case 'dataset.set_intended_use':
      await client.rpc('set_dataset_intended_use', {
        p_dataset_id: action.datasetId,
        p_intended_use: action.use,
        p_reason: action.reason,
      })

      return { openHref: datasetHref(action.datasetId) }
    case 'dataset.keep_snapshot':
      await client.rpc('keep_dataset_version', {
        p_version_id: action.versionId,
        p_reason: action.reason,
      })

      return { openHref: `/datasets/${action.datasetId}/snapshots` }
    case 'dataset.plan_rows':
      // react-doctor-disable-next-line react-doctor/async-await-in-loop -- Each planned key is its own write; they stay one at a time so a refusal stops the loop and the keys after it stay unplanned.
      for (const key of action.keys)
        await client.rpc('plan_dataset_row', {
          p_dataset_id: action.datasetId,
          p_scheduled_at: action.scheduledAt,
          p_planned_key: key,
        })

      return { openHref: datasetHref(action.datasetId) }
    case 'intake.resolve':
      await client.rpc('resolve_intake_failure', {
        p_failure_id: action.failureId,
        p_resolution: action.resolution,
      })

      return undefined
  }
}
