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
    'Insert a notebook block',
    'Insert a block into a notebook record, after a named block. A step may propose this instead of doing it.',
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
    'Create project',
    'Create a project in the run workspace.',
    [arg('p_title', 'text')],
  ),
  definition(
    'create_model_record',
    'Create record',
    'Create an experiment, sample, reagent, report or supported model record in a project.',
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
    'Update record properties',
    'Update workspace properties using the current record metadata version.',
    [...record(), arg('p_values', 'jsonb')],
  ),
  definition(
    'archive_record',
    'Archive record',
    'Archive a record using the current metadata version.',
    record(),
  ),
  definition(
    'restore_record',
    'Restore record',
    'Restore an archived record using the current metadata version.',
    record(),
  ),
  definition(
    'create_record_link',
    'Link records',
    'Create a link from a source record to a target record in the workspace.',
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
    'Move sample',
    'Record a sample storage transfer with chain-of-custody evidence.',
    [...record(), arg('p_to_location', 'text'), notes()],
  ),
  definition(
    'receive_sample',
    'Receive sample stock',
    'Add sample stock and record the receipt.',
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
    'Consume sample stock',
    'Reduce sample stock and record its use.',
    [...record(), arg('p_quantity', 'numeric'), notes()],
  ),
  definition(
    'edit_sample',
    'Update sample details',
    'Update sample metadata without bypassing custody operations.',
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
    'Archive sample',
    'Archive a sample with custody evidence.',
    [...record(), notes()],
  ),
  definition(
    'restore_sample',
    'Restore sample',
    'Restore an archived sample with custody evidence.',
    [...record(), notes()],
  ),
  definition(
    'record_reagent_movement',
    'Record reagent movement',
    'Receive, consume or adjust reagent stock through its governed movement operation.',
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
    'Commit dataset rows',
    'Commit a validated row batch at the expected dataset revision.',
    [
      arg('p_dataset_id', 'uuid'),
      arg('p_expected_dataset_revision', 'bigint'),
      arg('p_rows', 'jsonb'),
      { ...arg('p_idempotency_key', 'text'), server: 'idempotency' },
    ],
  ),
  definition(
    'snapshot_dataset',
    'Snapshot dataset',
    'Create an immutable dataset version with a label.',
    [
      arg('p_dataset_id', 'uuid'),
      arg('p_expected_dataset_revision', 'bigint'),
      arg('p_label', 'text'),
    ],
  ),
  definition(
    'archive_dataset',
    'Archive dataset',
    'Archive a dataset through dependency and revision checks.',
    [arg('p_dataset_id', 'uuid'), arg('p_expected_revision', 'bigint')],
  ),
  definition(
    'restore_dataset',
    'Restore dataset',
    'Restore an archived dataset at the expected revision.',
    [arg('p_dataset_id', 'uuid'), arg('p_expected_revision', 'bigint')],
  ),
]
const actionName = /^[a-z][a-z0-9_]{0,47}$/
export function validatePipelineActions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20)
    return ['Use an array of up to 20 ELN actions.']
  const errors: string[] = []
  const names = new Set<string>()
  for (const [index, action] of value.entries()) {
    if (!action || typeof action !== 'object') {
      errors.push(`Action ${index + 1} must be an object.`)
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
        `Action ${index + 1} needs a unique name using letters, numbers and underscores.`,
      )
    if (typeof item.name === 'string') names.add(item.name)
    if (
      item.mode !== undefined &&
      item.mode !== 'execute' &&
      item.mode !== 'propose'
    )
      errors.push(`Action ${index + 1} has an unknown mode.`)
    const operation = PIPELINE_ACTIONS.find(
      (entry) => entry.operation === item.operation,
    )
    if (!operation) {
      errors.push(`Action ${index + 1} uses an unsupported operation.`)
      continue
    }
    if (
      !item.arguments ||
      typeof item.arguments !== 'object' ||
      Array.isArray(item.arguments)
    ) {
      errors.push(`Action ${index + 1} needs an arguments object.`)
      continue
    }
    for (const key of Object.keys(item.arguments)) {
      if (
        !operation.arguments.some(
          (entry) => entry.name === key && !entry.server,
        )
      )
        errors.push(`Action ${index + 1}: ${key} is not an editable argument.`)
    }
    for (const field of operation.arguments) {
      if (
        field.required &&
        !field.server &&
        !Object.hasOwn(item.arguments, field.name)
      )
        errors.push(`Action ${index + 1} requires ${field.name}.`)
    }
    if (item.mode === 'propose' && !operation.proposalKind)
      errors.push(
        `Action ${index + 1} cannot propose ${operation.operation}: it has no proposal form.`,
      )
  }
  return errors
}
