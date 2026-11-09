/**
 * Sample and storage operations a pipeline step can run. Their API entries are
 * in `lab-api-samples.ts`; the pipeline action is generated from these.
 *
 * Releasing a sample is not here: it is a person's decision in the app.
 */
import { defineOperations, input } from '../descriptor'
import type { OperationInput } from '../descriptor'

const record = (): OperationInput[] => [
  input('p_record_id', 'uuid'),
  input('p_expected_metadata_version', 'int'),
]
const notes = () => input('p_notes', 'text', false, true)

export const SAMPLE_OPERATIONS = defineOperations([
  {
    name: 'quarantine_sample',
    label: 'Quarantine a sample',
    description:
      'Holds a sample back from use while its quality is looked into.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [...record(), input('p_reason', 'text'), notes()],
    pipeline: {},
  },
  {
    name: 'dispose_sample',
    label: 'Dispose of a sample',
    description: 'Records that a sample was thrown away, and why.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [...record(), input('p_reason', 'text'), notes()],
    pipeline: {},
  },
  {
    name: 'withdraw_sample',
    label: 'Take a portion of a sample for an experiment',
    description:
      'Takes a quantity out of a sample for an experiment, and can make a new sample for the portion.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      input('p_record_id', 'uuid'),
      input('p_quantity', 'num'),
      input('p_expected_metadata_version', 'int'),
      input('p_purpose_experiment_id', 'uuid'),
      input('p_unit', 'text', false, true),
      notes(),
      input('p_new_container', 'json', false, true),
    ],
    pipeline: {},
  },
  {
    name: 'aliquot_sample',
    label: 'Split a sample into portions',
    description:
      'Makes several smaller samples from one and takes the total out of the source.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      input('p_record_id', 'uuid'),
      input('p_count', 'int'),
      input('p_quantity_each', 'num'),
      input('p_purpose_experiment_id', 'uuid'),
      input('p_expected_metadata_version', 'int'),
      input('p_unit', 'text', false, true),
      notes(),
      input('p_new_container', 'json', false, true),
    ],
    pipeline: {},
  },
  {
    name: 'pool_samples',
    label: 'Pool samples',
    description:
      'Combines samples into a new pooled sample for an experiment and records where each part came from.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      input('p_sources', 'json'),
      input('p_purpose_experiment_id', 'uuid'),
      input('p_unit', 'text', false, true),
      notes(),
      input('p_new_container', 'json', false, true),
    ],
    pipeline: {},
  },
  {
    name: 'create_sample_reservation',
    label: 'Hold part of a sample for an experiment',
    description: 'Sets aside a quantity so nobody else uses it.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      input('p_record_id', 'uuid'),
      input('p_experiment_id', 'uuid'),
      input('p_quantity', 'num'),
      input('p_unit', 'text', false, true),
      input('p_planned', 'bool', false),
      notes(),
    ],
    pipeline: {},
  },
  {
    name: 'cancel_sample_reservation',
    label: 'Cancel a sample reservation',
    description: 'Gives the held quantity back to the sample.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [input('p_reservation_id', 'uuid'), notes()],
    pipeline: {},
  },
  {
    name: 'record_sample_measurement',
    label: 'Record a measurement on a sample',
    description: 'Adds a measured value, such as a concentration, to a sample.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      input('p_sample_record_id', 'uuid'),
      input('p_name', 'text'),
      input('p_value', 'num'),
      input('p_unit', 'text', false, true),
      input('p_method', 'text', false, true),
      input('p_measured_at', 'text', false),
      notes(),
    ],
    pipeline: {},
  },
  {
    name: 'move_sample_to_position',
    label: 'Put a sample in a box position',
    description:
      'Places a sample in an empty box position, taking it out of the one it was in.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      input('p_record_id', 'uuid'),
      input('p_to_position_id', 'uuid'),
      input('p_expected_metadata_version', 'int'),
      notes(),
    ],
    pipeline: {},
  },
  {
    name: 'remove_sample_from_position',
    label: 'Take a sample out of its box position',
    description: 'Frees the box position the sample is in.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [...record(), notes()],
    pipeline: {},
  },
  {
    name: 'set_position_status',
    label: 'Mark a box position available, quarantined or missing',
    description: 'Changes the status of a box position that holds no sample.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      input('p_position_id', 'uuid'),
      input('p_status', 'text'),
      notes(),
    ],
    pipeline: {},
  },
  {
    name: 'create_storage_location',
    label: 'Add a storage location',
    description:
      'Adds a site, room, freezer, shelf or rack to the storage tree.',
    kind: 'write',
    api: 'elsewhere',
    inputs: [
      input('p_workspace_id', 'uuid'),
      input('p_level', 'text'),
      input('p_parent_location_id', 'uuid', false, true),
      input('p_name', 'text'),
      input('p_code', 'text', false, true),
      input('p_unit_type', 'text', false, true),
      input('p_temperature_min_c', 'num', false, true),
      input('p_temperature_max_c', 'num', false, true),
    ],
    pipeline: {},
  },
])
