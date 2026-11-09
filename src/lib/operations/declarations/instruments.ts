/**
 * Instrument, booking and run operations a pipeline step can run. Their API
 * entries are in `lab-api-instruments.ts`; the pipeline action is generated
 * from the declaration here. The workspace is the run's own, filled in by the
 * server, so a pipeline never names it.
 */
import { t } from '#/copy'

import { defineOperations, input } from '../descriptor'
import type { OperationInput } from '../descriptor'

const workspace = (): OperationInput => ({
  ...input('p_workspace_id', 'uuid'),
  server: 'workspace',
})

export const INSTRUMENT_OPERATIONS = defineOperations([
  {
    name: 'create_instrument',
    label: t('data.pipelineActions.addInstrument'),
    description: t('data.pipelineActions.addInstrumentDescription'),
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      workspace(),
      input('p_name', 'text'),
      input('p_instrument_type', 'text', false),
      input('p_model', 'text', false, true),
      input('p_serial_number', 'text', false, true),
      input('p_vendor', 'text', false, true),
      input('p_location', 'text', false, true),
    ],
    pipeline: {},
  },
  {
    name: 'set_instrument_retired',
    label: t('data.pipelineActions.retireInstrument'),
    description: t('data.pipelineActions.retireInstrumentDescription'),
    kind: 'write',
    api: 'elsewhere',
    inputs: [input('p_instrument_id', 'uuid'), input('p_retired', 'bool')],
    pipeline: {},
  },
  {
    name: 'record_instrument_calibration',
    label: t('data.pipelineActions.calibrateInstrument'),
    description: t('data.pipelineActions.calibrateInstrumentDescription'),
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      input('p_instrument_id', 'uuid'),
      input('p_performed_at', 'ts'),
      input('p_due_at', 'ts'),
      input('p_notes', 'text', false, true),
    ],
    pipeline: {},
  },
  {
    name: 'set_instrument_qualification',
    label: t('data.pipelineActions.qualifyOnInstrument'),
    description: t('data.pipelineActions.qualifyOnInstrumentDescription'),
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      input('p_instrument_id', 'uuid'),
      input('p_user_id', 'text'),
      input('p_valid_until', 'ts'),
      input('p_qualified_for', 'text', false, true),
    ],
    pipeline: {},
  },
  {
    name: 'revoke_instrument_qualification',
    label: t('data.pipelineActions.removeQualification'),
    description: t('data.pipelineActions.removeQualificationDescription'),
    kind: 'write',
    api: 'elsewhere',
    inputs: [input('p_instrument_id', 'uuid'), input('p_user_id', 'text')],
    pipeline: {},
  },
  {
    name: 'create_booking',
    label: t('data.pipelineActions.bookInstrument'),
    description: t('data.pipelineActions.bookInstrumentDescription'),
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      workspace(),
      input('p_resource_id', 'uuid'),
      input('p_title', 'text'),
      input('p_starts_at', 'ts'),
      input('p_ends_at', 'ts'),
      input('p_timezone', 'text', false),
      input('p_notes', 'text', false, true),
      input('p_project_id', 'uuid', false, true),
      input('p_linked_experiment_record_id', 'uuid', false, true),
    ],
    pipeline: {},
  },
  {
    name: 'cancel_booking',
    label: t('data.pipelineActions.cancelBooking'),
    description: t('data.pipelineActions.cancelBookingDescription'),
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      input('p_booking_id', 'uuid'),
      input('p_expected_metadata_version', 'int', false, true),
    ],
    pipeline: {},
  },
  {
    name: 'create_instrument_run',
    label: t('data.pipelineActions.startRunRecord'),
    description: t('data.pipelineActions.startRunRecordDescription'),
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      workspace(),
      input('p_name', 'text'),
      input('p_run_identifier', 'text'),
      input('p_instrument_id', 'uuid'),
      input('p_protocol_name', 'text', false, true),
      input('p_project_id', 'uuid', false, true),
      input('p_plate_format', 'text', false),
      input('p_operator', 'text', false, true),
    ],
    pipeline: {},
  },
  {
    name: 'start_instrument_run',
    label: t('data.pipelineActions.markRunRunning'),
    description: t('data.pipelineActions.markRunRunningDescription'),
    kind: 'write',
    api: 'elsewhere',
    inputs: [workspace(), input('p_run_id', 'uuid')],
    pipeline: {},
  },
  {
    name: 'complete_instrument_run',
    label: t('data.pipelineActions.markRunCompleted'),
    description: t('data.pipelineActions.markRunCompletedDescription'),
    kind: 'write',
    api: 'elsewhere',
    inputs: [workspace(), input('p_run_id', 'uuid')],
    pipeline: {},
  },
  {
    name: 'fail_instrument_run',
    label: t('data.pipelineActions.markRunFailed'),
    description: t('data.pipelineActions.markRunFailedDescription'),
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      workspace(),
      input('p_run_id', 'uuid'),
      input('p_error_message', 'text', false, true),
    ],
    pipeline: {},
  },
  {
    name: 'link_run_record',
    label: t('data.pipelineActions.linkRunToRecord'),
    description: t('data.pipelineActions.linkRunToRecordDescription'),
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      workspace(),
      input('p_run_id', 'uuid'),
      input('p_linked_record_id', 'uuid'),
      input('p_link_type', 'text', false),
    ],
    pipeline: {},
  },
])
