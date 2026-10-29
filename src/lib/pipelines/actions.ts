import { t } from '#/copy'
/** Browser-safe catalogue of governed ELN operations available to pipeline actions. */
export interface PipelineAction {
  name: string
  operation: string
  arguments: Record<string, unknown>
  /**
   * PIPE-03.1 — what the step does with the action. `execute` (the default) calls the
   * canonical RPC; `propose` writes a proposal instead, so a person decides. Only an
   * operation with a `proposalKind` can be proposed, because a proposal's operation has
   * to be something the proposal contract can validate and execute.
   */
  mode?: 'execute' | 'propose'
}
export type PipelineActionArgumentType =
  'uuid' | 'text' | 'integer' | 'bigint' | 'numeric' | 'jsonb' | 'text[]'
export interface PipelineActionArgument {
  name: string
  type: PipelineActionArgumentType
  required: boolean
  nullable?: boolean
  server?: 'idempotency'
}
export interface PipelineActionDefinition {
  operation: string
  rpc: string
  label: string
  description: string
  arguments: PipelineActionArgument[]
  /** The proposal kind this operation becomes when a step proposes it. */
  proposalKind?: string
}
const arg = (
  name: string,
  type: PipelineActionArgumentType,
  required = true,
  nullable = false,
): PipelineActionArgument => ({ name, type, required, nullable })
const record = () => [
  arg('p_record_id', 'uuid'),
  arg('p_expected_metadata_version', 'integer'),
]
const notes = () => arg('p_notes', 'text', false, true)
const definition = (
  operation: string,
  label: string,
  description: string,
  args: PipelineActionArgument[],
  proposalKind?: string,
): PipelineActionDefinition => ({
  operation,
  rpc: operation,
  label,
  description,
  arguments: args,
  proposalKind,
})
export const PIPELINE_ACTIONS: PipelineActionDefinition[] = [
  definition(
    'insert_block',
    t('data.pipelineActions.insertNotebookBlock'),
    t('data.pipelineActions.insertBlockIntoNotebook'),
    [
      arg('p_record_id', 'uuid'),
      arg('p_type', 'text'),
      arg('p_payload', 'jsonb'),
      arg('p_payload_schema_version', 'integer', false),
      arg('p_after_block_id', 'uuid', false, true),
      arg('p_expected_structure_version', 'integer', false),
      arg('p_before_block_id', 'uuid', false, true),
    ],
    'notebook_block.insert',
  ),
  definition(
    'create_project',
    t('data.pipelineActions.createProject'),
    t('data.pipelineActions.createProjectRunWorkspace'),
    [arg('p_title', 'text')],
  ),
  definition(
    'create_model_record',
    t('data.pipelineActions.createRecord'),
    t('data.pipelineActions.createExperimentSampleMaterial'),
    [
      arg('p_project_id', 'uuid'),
      arg('p_kind', 'text'),
      arg('p_title', 'text'),
      arg('p_status', 'text', false),
      arg('p_tags', 'text[]', false),
      arg('p_properties', 'jsonb', false),
      arg('p_custom_fields', 'jsonb', false),
    ],
  ),
  definition(
    'update_record_custom_fields',
    t('data.pipelineActions.updateRecordProperties'),
    t('data.pipelineActions.updateWorkspacePropertiesUsing'),
    [...record(), arg('p_values', 'jsonb')],
  ),
  definition(
    'archive_record',
    t('data.pipelineActions.archiveRecord'),
    t('data.pipelineActions.archiveRecordUsingCurrent'),
    record(),
  ),
  definition(
    'restore_record',
    t('data.pipelineActions.restoreRecord'),
    t('data.pipelineActions.restoreArchivedRecordUsing'),
    record(),
  ),
  definition(
    'create_record_link',
    t('data.pipelineActions.linkRecords'),
    t('data.pipelineActions.createLinkFromSource'),
    [
      arg('p_source_record_id', 'uuid'),
      arg('p_target_kind', 'text'),
      arg('p_target_identifier', 'text'),
      arg('p_link_type', 'text'),
      arg('p_target_record_id', 'uuid', false, true),
      arg('p_label', 'text', false, true),
    ],
  ),
  definition(
    'transfer_sample',
    t('data.pipelineActions.moveSample'),
    t('data.pipelineActions.recordSampleStorageTransfer'),
    [...record(), arg('p_to_location', 'text'), notes()],
  ),
  definition(
    'receive_sample',
    t('data.pipelineActions.receiveSampleStock'),
    t('data.pipelineActions.addSampleStockRecord'),
    [
      ...record(),
      arg('p_quantity', 'numeric'),
      arg('p_unit', 'text', false, true),
      arg('p_location', 'text', false, true),
      notes(),
    ],
  ),
  definition(
    'consume_sample',
    t('data.pipelineActions.consumeSampleStock'),
    t('data.pipelineActions.reduceSampleStockRecord'),
    [...record(), arg('p_quantity', 'numeric'), notes()],
  ),
  definition(
    'edit_sample',
    t('data.pipelineActions.updateSampleDetails'),
    t('data.pipelineActions.updateSampleMetadataWithout'),
    [
      ...record(),
      arg('p_title', 'text', true, true),
      arg('p_properties', 'jsonb', true, true),
      arg('p_tags', 'text[]', true, true),
      arg('p_notes', 'text', true, true),
      arg('p_custom_fields', 'jsonb', true, true),
    ],
  ),
  definition(
    'archive_sample',
    t('data.pipelineActions.archiveSample'),
    t('data.pipelineActions.archiveSampleCustodyEvidence'),
    [...record(), notes()],
  ),
  definition(
    'restore_sample',
    t('data.pipelineActions.restoreSample'),
    t('data.pipelineActions.restoreArchivedSampleCustody'),
    [...record(), notes()],
  ),
  definition(
    'record_reagent_movement',
    t('data.pipelineActions.recordMaterialMovement'),
    t('data.pipelineActions.receiveConsumeAdjustMaterial'),
    [
      arg('p_reagent_record_id', 'uuid'),
      arg('p_expected_metadata_version', 'integer'),
      arg('p_operation', 'text'),
      arg('p_quantity_delta', 'numeric', false),
      arg('p_reason', 'text', false, true),
    ],
  ),
  definition(
    'commit_dataset_row_batch',
    t('data.pipelineActions.commitDatasetRows'),
    t('data.pipelineActions.commitValidatedRowBatch'),
    [
      arg('p_dataset_id', 'uuid'),
      arg('p_expected_dataset_revision', 'bigint'),
      arg('p_rows', 'jsonb'),
      { ...arg('p_idempotency_key', 'text'), server: 'idempotency' },
    ],
  ),
  definition(
    'snapshot_dataset',
    t('data.pipelineActions.snapshotDataset'),
    t('data.pipelineActions.createImmutableDatasetVersion'),
    [
      arg('p_dataset_id', 'uuid'),
      arg('p_expected_dataset_revision', 'bigint'),
      arg('p_label', 'text'),
    ],
  ),
  definition(
    'archive_dataset',
    t('data.pipelineActions.archiveDataset'),
    t('data.pipelineActions.archiveDatasetThroughDependency'),
    [arg('p_dataset_id', 'uuid'), arg('p_expected_revision', 'bigint')],
  ),
  definition(
    'restore_dataset',
    t('data.pipelineActions.restoreDataset'),
    t('data.pipelineActions.restoreArchivedDatasetExpected'),
    [arg('p_dataset_id', 'uuid'), arg('p_expected_revision', 'bigint')],
  ),
]
const actionName = /^[a-z][a-z0-9_]{0,47}$/
export function validatePipelineActions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20)
    return [t('data.pipelineActions.useArrayUp20')]
  const errors: string[] = []
  const names = new Set<string>()
  for (const [index, action] of value.entries()) {
    if (!action || typeof action !== 'object') {
      errors.push(
        t('data.pipelineActions.actionMustObject', { value: index + 1 }),
      )
      continue
    }
    const item = action as Partial<PipelineAction>
    if (
      typeof item.name !== 'string' ||
      !actionName.test(item.name) ||
      ['__proto__', 'constructor', 'prototype'].includes(item.name) ||
      names.has(item.name)
    )
      errors.push(
        t('data.pipelineActions.actionNeedsUniqueName', { value: index + 1 }),
      )
    if (typeof item.name === 'string') names.add(item.name)
    // The item is unvalidated JSON: check the raw mode before narrowing it.
    const mode: unknown = item.mode
    if (mode !== undefined && mode !== 'execute' && mode !== 'propose')
      errors.push(
        t('data.pipelineActions.actionHasUnknownMode', { value: index + 1 }),
      )
    const operation = PIPELINE_ACTIONS.find(
      (entry) => entry.operation === item.operation,
    )
    if (!operation) {
      errors.push(
        t('data.pipelineActions.actionUsesUnsupportedOperation', {
          value: index + 1,
        }),
      )
      continue
    }
    if (
      !item.arguments ||
      typeof item.arguments !== 'object' ||
      Array.isArray(item.arguments)
    ) {
      errors.push(
        t('data.pipelineActions.actionNeedsArgumentsObject', {
          value: index + 1,
        }),
      )
      continue
    }
    for (const key of Object.keys(item.arguments)) {
      if (
        !operation.arguments.some(
          (entry) => entry.name === key && !entry.server,
        )
      )
        errors.push(
          t('data.pipelineActions.actionEditableArgument', {
            value: index + 1,
            key,
          }),
        )
    }
    for (const field of operation.arguments) {
      if (
        field.required &&
        !field.server &&
        !Object.hasOwn(item.arguments, field.name)
      )
        errors.push(
          t('data.pipelineActions.actionRequires', {
            value: index + 1,
            name: field.name,
          }),
        )
    }
    if (item.mode === 'propose' && !operation.proposalKind)
      errors.push(
        t('data.pipelineActions.actionCannotProposeHas', {
          value: index + 1,
          operation: operation.operation,
        }),
      )
  }
  return errors
}
