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
  /**
   * Bulk import: run the action once for each row of a list, such as the rows the step
   * before it returned (`{ "$ref": "previous" }`). Arguments name a value from the current
   * row with `{ "$ref": "row.column" }`. All the rows succeed or none do, and a person
   * decides each one when the action proposes.
   */
  forEach?: { $ref: string }
}

/** The most rows one action may run for. A larger import is split into several runs. */
export const PIPELINE_ACTION_ROW_LIMIT = 500

/** Where a row loop may take its rows from. */
export const PIPELINE_ACTION_ROW_SOURCES = [
  'previous',
  'parameters',
  'output',
  'actions',
]
export type PipelineActionArgumentType =
  | 'uuid'
  | 'text'
  | 'boolean'
  | 'date'
  | 'integer'
  | 'bigint'
  | 'numeric'
  | 'jsonb'
  | 'text[]'
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
    'mark_reagent_ordered',
    t('data.pipelineActions.markOrderPlaced'),
    t('data.pipelineActions.markOrderPlacedWithPrice'),
    [
      arg('p_order_id', 'uuid'),
      arg('p_order_reference', 'text', false, true),
      arg('p_expected_on', 'date', false, true),
      arg('p_supplier', 'text', false, true),
      arg('p_supplier_record_id', 'uuid', false, true),
      arg('p_total_price', 'numeric', false, true),
      arg('p_currency', 'text', false, true),
    ],
    'reagent_order.mark_ordered',
  ),
  definition(
    'set_reagent_order_price',
    t('data.pipelineActions.setOrderPrice'),
    t('data.pipelineActions.setOrderPriceDescription'),
    [
      arg('p_order_id', 'uuid'),
      arg('p_total_price', 'numeric', true, true),
      arg('p_currency', 'text', false, true),
    ],
    'reagent_order.set_price',
  ),
  definition(
    'set_instrument_rate',
    t('data.pipelineActions.setInstrumentRate'),
    t('data.pipelineActions.setInstrumentRateDescription'),
    [
      arg('p_instrument_id', 'uuid'),
      arg('p_rate_per_hour', 'numeric', true, true),
      arg('p_currency', 'text', true, true),
    ],
    'instrument_rate.set',
  ),
  definition(
    'queue_instrument_job',
    t('data.pipelineActions.sendWorklistToInstrument'),
    t('data.pipelineActions.sendWorklistToInstrumentDescription'),
    [
      arg('p_instrument_id', 'uuid'),
      arg('p_worklist_id', 'uuid'),
      arg('p_note', 'text', false, true),
    ],
  ),
  definition(
    'request_schedule_proposal',
    t('data.pipelineActions.requestSchedule'),
    t('data.pipelineActions.requestScheduleDescription'),
    [
      arg('p_record_id', 'uuid'),
      arg('p_reason', 'text', false, true),
      arg('p_slipped_part_id', 'uuid', false, true),
    ],
  ),
  definition(
    'request_pipeline_reproduction',
    t('data.pipelineActions.reproduceRun'),
    t('data.pipelineActions.reproduceRunDescription'),
    [arg('p_run_id', 'uuid')],
  ),
  definition(
    'set_step_done',
    t('data.pipelineActions.finishStep'),
    t('data.pipelineActions.finishStepDescription'),
    [
      arg('p_block_id', 'uuid'),
      arg('p_done', 'boolean', false),
      arg('p_note', 'text', false, true),
    ],
  ),
  definition(
    'set_part_done',
    t('data.pipelineActions.finishPart'),
    t('data.pipelineActions.finishPartDescription'),
    [arg('p_part_id', 'uuid'), arg('p_done', 'boolean')],
  ),
  definition(
    'set_part_gate',
    t('data.pipelineActions.setPartGate'),
    t('data.pipelineActions.setPartGateDescription'),
    [
      arg('p_part_id', 'uuid'),
      arg('p_conditions', 'jsonb', false, true),
      arg('p_gate_mode', 'text', false, true),
      arg('p_steps_in_order', 'boolean', false, true),
    ],
  ),
  definition(
    'add_compound_lot',
    t('data.pipelineActions.addCompoundLot'),
    t('data.pipelineActions.addCompoundLotDescription'),
    [
      arg('p_compound_id', 'uuid'),
      arg('p_project_id', 'uuid', false, true),
      arg('p_title', 'text', false, true),
      arg('p_custom_fields', 'jsonb', false, true),
    ],
  ),
  definition(
    'add_step_result',
    t('data.pipelineActions.addStepResult'),
    t('data.pipelineActions.addStepResultDescription'),
    [
      arg('p_block_id', 'uuid'),
      arg('p_label', 'text'),
      arg('p_value', 'text'),
      arg('p_unit', 'text', false, true),
    ],
  ),
  definition(
    'add_series_member',
    t('data.pipelineActions.addSeriesMember'),
    t('data.pipelineActions.addSeriesMemberDescription'),
    [
      arg('p_series_record_id', 'uuid'),
      arg('p_member_record_id', 'uuid'),
      arg('p_position', 'numeric', false, true),
      arg('p_planned_on', 'date', false, true),
    ],
  ),
  definition(
    'remove_series_member',
    t('data.pipelineActions.removeSeriesMember'),
    t('data.pipelineActions.removeSeriesMemberDescription'),
    [arg('p_member_record_id', 'uuid')],
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
    'create_plate_run',
    t('data.pipelineActions.addPlateRun'),
    t('data.pipelineActions.addPlateRunDescription'),
    [
      arg('p_name', 'text'),
      arg('p_format', 'text'),
      arg('p_wells', 'jsonb'),
      arg('p_readout', 'jsonb'),
      arg('p_config', 'jsonb', false),
      arg('p_project_id', 'uuid', false, true),
      arg('p_record_id', 'uuid', false, true),
      arg('p_design_id', 'uuid', false, true),
    ],
  ),
  definition(
    'create_plate_worklist',
    t('data.pipelineActions.makeWorklist'),
    t('data.pipelineActions.makeWorklistDescription'),
    [
      arg('p_name', 'text'),
      arg('p_format', 'text'),
      arg('p_mode', 'text'),
      arg('p_source_plate', 'text'),
      arg('p_source_format', 'text'),
      arg('p_dest_plate', 'text'),
      arg('p_dest_format', 'text'),
      arg('p_transfers', 'jsonb'),
      arg('p_plate_run_id', 'uuid', false, true),
      arg('p_record_id', 'uuid', false, true),
      arg('p_options', 'jsonb', false),
    ],
  ),
  definition(
    'complete_plate_worklist',
    t('data.pipelineActions.completeWorklist'),
    t('data.pipelineActions.completeWorklistDescription'),
    [
      arg('p_worklist_id', 'uuid'),
      arg('p_reconciled', 'jsonb'),
      arg('p_purpose_record_id', 'uuid', false, true),
      arg('p_record_withdrawals', 'boolean', false),
    ],
  ),
  definition(
    'archive_plate_run',
    t('data.pipelineActions.archivePlateRun'),
    t('data.pipelineActions.archivePlateRunDescription'),
    [arg('p_plate_run_id', 'uuid')],
  ),
  definition(
    'record_instrument_run_document',
    t('data.pipelineActions.keepAsmDocument'),
    t('data.pipelineActions.keepAsmDocumentDescription'),
    [
      arg('p_run_id', 'uuid'),
      arg('p_document', 'jsonb'),
      arg('p_converter', 'text'),
      arg('p_converter_version', 'text', false, true),
      arg('p_image_digest', 'text', false, true),
      arg('p_vendor', 'text', false, true),
      arg('p_technique', 'text', false, true),
      arg('p_manifest', 'text', false, true),
      arg('p_measurements', 'integer', false),
      arg('p_device', 'jsonb', false),
    ],
  ),
  definition(
    'record_qc_point',
    t('data.pipelineActions.addQcPoint'),
    t('data.pipelineActions.addQcPointDescription'),
    [
      arg('p_series_id', 'uuid'),
      arg('p_value', 'numeric'),
      arg('p_at', 'text', false, true),
      arg('p_label', 'text', false, true),
      arg('p_instrument_run_id', 'uuid', false, true),
    ],
  ),
  definition(
    'acknowledge_qc_point',
    t('data.pipelineActions.acknowledgeQcPoint'),
    t('data.pipelineActions.acknowledgeQcPointDescription'),
    [
      arg('p_point_id', 'uuid'),
      arg('p_note', 'text', false, true),
      arg('p_exclude', 'boolean', false),
    ],
  ),
  definition(
    'restore_dataset',
    t('data.pipelineActions.restoreDataset'),
    t('data.pipelineActions.restoreArchivedDatasetExpected'),
    [arg('p_dataset_id', 'uuid'), arg('p_expected_revision', 'bigint')],
  ),
  definition(
    'run_contract_check',
    t('data.pipelineActions.checkContract'),
    t('data.pipelineActions.checkContractDescription'),
    [arg('p_contract_id', 'uuid'), arg('p_dataset_id', 'uuid', false, true)],
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
    const forEach: unknown = item.forEach
    if (forEach !== undefined) {
      const reference =
        forEach !== null &&
        typeof forEach === 'object' &&
        !Array.isArray(forEach) &&
        Object.keys(forEach).length === 1
          ? (forEach as { $ref?: unknown }).$ref
          : undefined
      const parts = typeof reference === 'string' ? reference.split('.') : []
      if (
        parts.length === 0 ||
        !PIPELINE_ACTION_ROW_SOURCES.includes(parts[0]) ||
        parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
      )
        errors.push(
          t('data.pipelineActions.actionRowLoopNeedsList', {
            value: index + 1,
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
