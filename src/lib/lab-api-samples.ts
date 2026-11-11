/**
 * The sample and storage part of the lab API: receiving, using, moving,
 * splitting and disposing of samples, reserving them for an experiment, and
 * the freezers, boxes and positions they sit in.
 *
 * It is spread into `lab-api-surface.ts`, so the token allowlist, the OpenAPI
 * document, the docs, MCP (`canonical.read` and `sheetbase.lab.act`), the
 * Python and TypeScript SDKs and the integration guard all read it from there.
 *
 * Releasing a sample is left out on purpose: it is a quality decision a person
 * makes in the app, checked against the release rules, like signing.
 */
import type { LabRpc, LabTable } from './lab-api-surface'

const TIMESTAMPS = [
  ['created_at', 'ts', 1],
  ['updated_at', 'ts', 1],
] as const

const HIERARCHY_COMMON = [
  ['id', 'uuid', 1],
  ['workspace_id', 'uuid', 1],
] as const

export const SAMPLE_LAB_TABLES = {
  sample_events: {
    summary:
      'The history of a sample: every receive, use, move, edit, release, quarantine and disposal, with the quantity before and after. Written only by the sample actions, never edited.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['operation', 'text', 1],
      ['quantity_delta', 'num', 0],
      ['quantity_before', 'num', 0],
      ['quantity_after', 'num', 0],
      ['quantity_unit', 'text', 0],
      ['from_location', 'text', 0],
      ['to_location', 'text', 0],
      ['actor_user_id', 'text', 0],
      ['purpose_record_id', 'uuid', 0],
      ['notes', 'text', 0],
      ['created_at', 'ts', 1],
    ],
  },
  sample_reservations: {
    summary:
      'Volume of a sample held for an experiment. `state` is active, cancelled or fulfilled.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['sample_record_id', 'uuid', 1],
      ['experiment_record_id', 'uuid', 1],
      ['quantity', 'num', 1],
      ['unit', 'text', 0],
      ['planned', 'bool', 1],
      ['state', 'text', 1],
      ['notes', 'text', 0],
      ['created_by_user_id', 'text', 0],
      ['cancelled_by_user_id', 'text', 0],
      ['cancelled_at', 'ts', 0],
      ...TIMESTAMPS,
    ],
  },
  sample_measurements: {
    summary:
      'A value measured on a sample, with its unit, method and when it was measured.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['sample_record_id', 'uuid', 1],
      ['name', 'text', 1],
      ['value', 'num', 1],
      ['unit', 'text', 0],
      ['method', 'text', 0],
      ['measured_at', 'ts', 1],
      ['notes', 'text', 0],
      ['created_by_user_id', 'text', 0],
      ...TIMESTAMPS,
    ],
  },
  sample_release_rules: {
    summary:
      'The checks a sample of a type must pass before it can be released. A row with no sample type is the workspace default.',
    columns: [
      ['workspace_id', 'uuid', 1],
      ['sample_type', 'text', 0],
      ['rules', 'json', 1],
      ['updated_by_user_id', 'text', 0],
      ...TIMESTAMPS,
    ],
  },
  storage_sites: {
    summary:
      'A site: the building or campus a freezer is in. The top of the storage tree.',
    columns: [
      ...HIERARCHY_COMMON,
      ['name', 'text', 1],
      ['code', 'text', 1],
      ['description', 'text', 0],
      ['temperature_min_c', 'num', 0],
      ['temperature_max_c', 'num', 0],
      ['capacity', 'int', 1],
      ['metadata', 'json', 1],
      ['archived_at', 'ts', 0],
      ...TIMESTAMPS,
    ],
  },
  storage_rooms: {
    summary: 'A room inside a site.',
    columns: [
      ...HIERARCHY_COMMON,
      ['site_id', 'uuid', 1],
      ['name', 'text', 1],
      ['code', 'text', 1],
      ['temperature_min_c', 'num', 0],
      ['temperature_max_c', 'num', 0],
      ['capacity', 'int', 1],
      ['metadata', 'json', 1],
      ['archived_at', 'ts', 0],
      ...TIMESTAMPS,
    ],
  },
  storage_units: {
    summary:
      'A freezer, fridge, incubator or other storage unit inside a room. `unit_type` is freezer, fridge, cryo, incubator, ambient, dewar or cabinet.',
    columns: [
      ...HIERARCHY_COMMON,
      ['room_id', 'uuid', 1],
      ['name', 'text', 1],
      ['code', 'text', 1],
      ['unit_type', 'text', 1],
      ['temperature_min_c', 'num', 0],
      ['temperature_max_c', 'num', 0],
      ['capacity', 'int', 1],
      ['metadata', 'json', 1],
      ['archived_at', 'ts', 0],
      ...TIMESTAMPS,
    ],
  },
  storage_shelves: {
    summary: 'A shelf inside a storage unit.',
    columns: [
      ...HIERARCHY_COMMON,
      ['unit_id', 'uuid', 1],
      ['name', 'text', 1],
      ['position', 'int', 1],
      ['capacity', 'int', 1],
      ['metadata', 'json', 1],
      ['archived_at', 'ts', 0],
      ...TIMESTAMPS,
    ],
  },
  storage_racks: {
    summary: 'A rack on a shelf.',
    columns: [
      ...HIERARCHY_COMMON,
      ['shelf_id', 'uuid', 1],
      ['name', 'text', 1],
      ['position', 'int', 1],
      ['capacity', 'int', 1],
      ['metadata', 'json', 1],
      ['archived_at', 'ts', 0],
      ...TIMESTAMPS,
    ],
  },
  storage_boxes: {
    summary:
      'A box in a rack, with a grid of positions (`rows` by `cols`, at most 26 each).',
    columns: [
      ...HIERARCHY_COMMON,
      ['rack_id', 'uuid', 1],
      ['name', 'text', 1],
      ['code', 'text', 1],
      ['rows', 'int', 1],
      ['cols', 'int', 1],
      ['capacity', 'int', 1],
      ['metadata', 'json', 1],
      ['archived_at', 'ts', 0],
      ...TIMESTAMPS,
    ],
  },
  storage_positions: {
    summary:
      'One position in a box (A1, B3 and so on). `status` is available, occupied, quarantined or missing; `occupied_record_id` is the sample in it.',
    columns: [
      ...HIERARCHY_COMMON,
      ['box_id', 'uuid', 1],
      ['row_index', 'int', 1],
      ['col_index', 'int', 1],
      ['label', 'text', 1],
      ['status', 'text', 1],
      ['occupied_record_id', 'uuid', 0],
      ['metadata', 'json', 1],
      ...TIMESTAMPS,
    ],
  },
  storage_movements: {
    summary:
      'Every time a sample was placed in, moved between or taken out of a storage position (`operation` is place, move or remove), with where from and to.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['record_id', 'uuid', 1],
      ['operation', 'text', 1],
      ['from_position_id', 'uuid', 0],
      ['to_position_id', 'uuid', 0],
      ['from_path', 'text', 0],
      ['to_path', 'text', 0],
      ['actor_user_id', 'text', 0],
      ['notes', 'text', 0],
      ['created_at', 'ts', 1],
    ],
  },
} satisfies Readonly<Record<string, LabTable>>

export const SAMPLE_LAB_PARAM_NOTES = {
  p_record_id: 'Record id (for a sample action, the sample).',
  p_location: 'Where the sample is, as free text such as `Freezer 2, shelf 3`.',
  p_to_location: 'Where the sample goes, as free text.',
  p_count: 'How many portions to make.',
  p_quantity_each: 'The quantity in each portion.',
  p_samples:
    'JSON array of the samples to register, each `{ title, quantity, unit, location, properties, customFields }`.',
  p_barcode: 'The barcode printed on the sample label.',
  p_position_id: 'Storage position id.',
  p_to_position_id: 'Storage position the sample goes to.',
  p_rack_id: 'The rack the box goes in.',
  p_cols: 'Number of columns in the box (1 to 26).',
  p_level:
    'Which kind of location: `site`, `room`, `unit`, `shelf`, `rack` or `box`.',
  p_parent_location_id:
    'The location it goes inside: the site for a room, the room for a unit, the unit for a shelf, the shelf for a rack. Leave out for a site.',
  p_location_id: 'Id of the site, room, unit, shelf, rack or box.',
  p_code: 'A short code, such as `F2`.',
  p_unit_type:
    '`freezer`, `fridge`, `cryo`, `incubator`, `ambient`, `dewar` or `cabinet`.',
  p_temperature_min_c: 'Lowest allowed temperature in °C.',
  p_temperature_max_c: 'Highest allowed temperature in °C.',
  p_archived: '`true` takes it out of use, `false` brings it back.',
  p_sample_type: 'The sample type, or leave out for the workspace default.',
  p_reservation_id: 'Reservation id.',
  p_experiment_id: 'The experiment the sample is used or held for.',
  p_planned: '`true` for an experiment not yet run (default).',
  p_method: 'How it was measured.',
  p_measured_at: 'When it was measured (default now).',
  p_sample_record_id: 'The sample.',
  p_source_record_id: 'The sample to repeat a measurement for.',
  p_scheduled_at: 'When the repeat is planned.',
  p_planned_row_count: 'How many rows the repeat will add (default 1).',
  p_source_row_id: 'The dataset row being repeated.',
  p_source_field_id: 'The dataset field being repeated.',
  p_properties: 'Properties of the sample, keyed by name.',
  p_planned_key: 'A key that makes asking again return the same request.',
  p_tags: 'Tags.',
} satisfies Readonly<Record<string, string>>

export const SAMPLE_LAB_RPCS = {
  receive_sample: {
    summary: 'Receive stock of a sample',
    description:
      'Adds a quantity to a sample (a delivery, a top-up) and optionally records where it is. Sends `sample.received`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_quantity', 'num', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_unit', 'text', 0],
      ['p_location', 'text', 0],
      ['p_notes', 'text', 0],
    ],
    result: 'row:records',
  },
  consume_sample: {
    summary: 'Use up part of a sample',
    description:
      'Takes a quantity out of a sample, optionally for an experiment. Refused when less than that is left. Sends `sample.consumed`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_quantity', 'num', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_notes', 'text', 0],
      ['p_experiment_id', 'uuid', 0],
      ['p_purpose_record_id', 'uuid', 0],
    ],
    result: 'row:records',
  },
  transfer_sample: {
    summary: 'Move a sample to another place',
    description:
      'Records that a sample moved, by free-text location. To put it in a box position use `move_sample_to_position`. Sends `sample.moved`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_to_location', 'text', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_notes', 'text', 0],
    ],
    result: 'row:records',
  },
  edit_sample: {
    summary: 'Edit a sample’s details',
    description:
      'Changes the title, properties, tags or custom fields of a sample, and notes why. Sends `sample.edited`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_title', 'text', 1],
      ['p_properties', 'json', 1],
      ['p_tags', 'text[]', 1],
      ['p_notes', 'text', 1],
      ['p_custom_fields', 'json', 1],
    ],
    result: 'row:records',
  },
  archive_sample: {
    summary: 'Archive a sample',
    description:
      'Takes a sample out of the active list. Its history stays. Sends `sample.archived`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_notes', 'text', 0],
    ],
    result: 'row:records',
  },
  restore_sample: {
    summary: 'Restore an archived sample',
    description: 'Brings an archived sample back. Sends `sample.restored`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_notes', 'text', 0],
    ],
    result: 'row:records',
  },
  quarantine_sample: {
    summary: 'Quarantine a sample',
    description:
      'Holds a sample back from use while its quality is looked into. Sends `sample.quarantined`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_reason', 'text', 1],
      ['p_notes', 'text', 0],
    ],
    result: 'row:records',
  },
  dispose_sample: {
    summary: 'Dispose of a sample',
    description:
      'Records that a sample was thrown away, and why. Sends `sample.disposed`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_reason', 'text', 1],
      ['p_notes', 'text', 0],
    ],
    result: 'row:records',
  },
  withdraw_sample: {
    summary: 'Take a portion of a sample for an experiment',
    description:
      'Takes a quantity out of a sample for an experiment, and can make a new sample for the portion. Returns `{ source, created }`. Sends `sample.consumed`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_quantity', 'num', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_purpose_experiment_id', 'uuid', 1],
      ['p_unit', 'text', 0],
      ['p_notes', 'text', 0],
      ['p_new_container', 'json', 0],
    ],
    result: 'json',
  },
  aliquot_sample: {
    summary: 'Split a sample into portions',
    description:
      'Makes several smaller samples from one, each with its own record, and takes the total out of the source. Returns `{ source, aliquots }`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_count', 'int', 1],
      ['p_quantity_each', 'num', 1],
      ['p_purpose_experiment_id', 'uuid', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_unit', 'text', 0],
      ['p_notes', 'text', 0],
      ['p_new_container', 'json', 0],
    ],
    result: 'json',
  },
  register_samples: {
    summary: 'Register several samples at once',
    description:
      'Creates sample records in a project, such as a batch that has just arrived. Returns the new samples.',
    scope: 'lab:write',
    params: [
      ['p_project_id', 'uuid', 1],
      ['p_samples', 'json', 1],
    ],
    result: 'row:records',
  },
  request_repeat: {
    summary: 'Ask for a measurement to be repeated',
    description:
      'Plans a repeat of a measurement for a sample, as a new planned row in the dataset. Returns the request.',
    scope: 'lab:write',
    params: [
      ['p_source_record_id', 'uuid', 1],
      ['p_dataset_id', 'uuid', 1],
      ['p_scheduled_at', 'ts', 0],
      ['p_planned_row_count', 'int', 0],
      ['p_source_row_id', 'uuid', 0],
      ['p_source_field_id', 'uuid', 0],
      ['p_title', 'text', 0],
      ['p_properties', 'json', 0],
      ['p_planned_key', 'text', 0],
    ],
    result: 'json',
  },
  create_sample_reservation: {
    summary: 'Hold part of a sample for an experiment',
    description:
      'Sets aside a quantity so nobody else uses it. Refused when less than that is free. Sends `sample.reserved`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_experiment_id', 'uuid', 1],
      ['p_quantity', 'num', 1],
      ['p_unit', 'text', 0],
      ['p_planned', 'bool', 0],
      ['p_notes', 'text', 0],
    ],
    result: 'row:sample_reservations',
  },
  cancel_sample_reservation: {
    summary: 'Cancel a reservation',
    description:
      'Gives the held quantity back to the sample. Sends `sample.reservation_cancelled`.',
    scope: 'lab:write',
    params: [
      ['p_reservation_id', 'uuid', 1],
      ['p_notes', 'text', 0],
    ],
    result: 'row:sample_reservations',
  },
  record_sample_label_print: {
    summary: 'Record that a sample label was printed',
    description:
      'Adds a print to the sample’s history, so there is a trace of who labelled what. Sends `sample.label_printed`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_expected_metadata_version', 'bigint', 1],
      ['p_note', 'text', 1],
    ],
    result: 'json',
  },
  record_sample_measurement: {
    summary: 'Record a measurement on a sample',
    description:
      'Adds a measured value (concentration, purity and so on) to a sample.',
    scope: 'lab:write',
    params: [
      ['p_sample_record_id', 'uuid', 1],
      ['p_name', 'text', 1],
      ['p_value', 'num', 1],
      ['p_unit', 'text', 0],
      ['p_method', 'text', 0],
      ['p_measured_at', 'ts', 0],
      ['p_notes', 'text', 0],
    ],
    result: 'row:sample_measurements',
  },
  set_sample_release_rules: {
    summary: 'Set the checks a sample must pass before release',
    description:
      'Sets the release checks for a sample type, or the workspace default. Needs permission to change lab settings.',
    scope: 'lab:write',
    params: [
      ['p_workspace_id', 'uuid', 1],
      ['p_sample_type', 'text', 0],
      ['p_rules', 'json', 1],
    ],
    result: 'row:sample_release_rules',
  },
  move_sample_to_position: {
    summary: 'Put a sample in a box position',
    description:
      'Places a sample in an empty position, taking it out of the one it was in. Refused when the position is taken or blocked. Sends `storage.placed` or `storage.moved`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_to_position_id', 'uuid', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_notes', 'text', 0],
    ],
    result: 'row:records',
  },
  remove_sample_from_position: {
    summary: 'Take a sample out of its box position',
    description:
      'Frees the position the sample is in. Sends `storage.removed`.',
    scope: 'lab:write',
    params: [
      ['p_record_id', 'uuid', 1],
      ['p_expected_metadata_version', 'int', 1],
      ['p_notes', 'text', 0],
    ],
    result: 'row:records',
  },
  set_position_status: {
    summary: 'Mark a box position available, quarantined or missing',
    description:
      'Changes a position that holds no sample. `p_status` is `available`, `quarantined` or `missing`. Blocking it sends `storage.position.quarantined` or `storage.position.missing`.',
    scope: 'lab:write',
    params: [
      ['p_position_id', 'uuid', 1],
      ['p_status', 'text', 1],
      ['p_notes', 'text', 0],
    ],
    result: 'row:storage_positions',
  },
  match_sample_locations: {
    summary: 'Match free-text sample locations to box positions',
    description:
      'Looks at samples whose location is typed text and puts them in the box position of the same name, where there is one. Returns `{ matched, unmatched }`.',
    scope: 'lab:write',
    params: [['p_workspace_id', 'uuid', 1]],
    result: 'json',
  },
  create_storage_box: {
    summary: 'Add a box to a rack',
    description:
      'Makes a box with a grid of positions (`p_rows` by `p_cols`, at most 26 each). Needs permission to manage storage. Sends `storage.box.created`.',
    scope: 'lab:write',
    params: [
      ['p_workspace_id', 'uuid', 1],
      ['p_rack_id', 'uuid', 1],
      ['p_name', 'text', 1],
      ['p_code', 'text', 1],
      ['p_rows', 'int', 1],
      ['p_cols', 'int', 1],
      ['p_metadata', 'json', 0],
    ],
    result: 'row:storage_boxes',
  },
  create_storage_location: {
    summary: 'Add a site, room, freezer, shelf or rack',
    description:
      'Adds one level of the storage tree. Needs permission to manage storage. A site has no parent; a room goes in a site, a unit (freezer, fridge and so on) in a room, a shelf in a unit and a rack on a shelf. Returns `{ id, level, name, code }`. Sends `storage.<level>.created`.',
    scope: 'lab:write',
    params: [
      ['p_workspace_id', 'uuid', 1],
      ['p_level', 'text', 1],
      ['p_parent_location_id', 'uuid', 0],
      ['p_name', 'text', 1],
      ['p_code', 'text', 0],
      ['p_unit_type', 'text', 0],
      ['p_temperature_min_c', 'num', 0],
      ['p_temperature_max_c', 'num', 0],
    ],
    result: 'json',
  },
  update_storage_location: {
    summary: 'Rename or change a storage location',
    description:
      'Changes the name, code, type or temperature limits of a site, room, unit, shelf, rack or box. Anything left out stays as it was.',
    scope: 'lab:write',
    params: [
      ['p_level', 'text', 1],
      ['p_location_id', 'uuid', 1],
      ['p_name', 'text', 0],
      ['p_code', 'text', 0],
      ['p_unit_type', 'text', 0],
      ['p_temperature_min_c', 'num', 0],
      ['p_temperature_max_c', 'num', 0],
    ],
    result: 'json',
  },
  set_storage_location_archived: {
    summary: 'Take a storage location out of use, or bring it back',
    description:
      'Archives or restores a site, room, unit, shelf, rack or box. A location that holds a sample cannot be archived.',
    scope: 'lab:write',
    params: [
      ['p_level', 'text', 1],
      ['p_location_id', 'uuid', 1],
      ['p_archived', 'bool', 1],
    ],
    result: 'json',
  },
  lookup_sample_by_barcode: {
    summary: 'Find a sample by its barcode',
    description: 'Returns the sample whose label has this barcode, if any.',
    scope: 'lab:read',
    params: [['p_barcode', 'text', 1]],
    result: 'row:records',
  },
  sample_quantity_balances: {
    summary: 'How much of a sample is left, used and held',
    description:
      'Returns `{ quantity, unit, used, reserved, available }` for a sample, worked out from its history and active reservations.',
    scope: 'lab:read',
    params: [['p_record_id', 'uuid', 1]],
    result: 'json',
  },
  storage_path: {
    summary: 'Where a position is, as a path',
    description:
      'Returns the path of a position, such as `Main site / Room 1 / Freezer 2 / Shelf 3 / Rack A / Box 7 / B4`.',
    scope: 'lab:read',
    params: [['p_position_id', 'uuid', 1]],
    result: 'text',
  },
  sample_measurement_provenance: {
    summary: 'Where a sample’s measured values came from',
    description:
      'Returns each measured value on a sample with the experiment and dataset it came from.',
    scope: 'lab:read',
    params: [['p_sample_record_id', 'uuid', 1]],
    result: 'json',
  },
  sample_release_check_status: {
    summary: 'Whether a sample passes its release checks',
    description:
      'Returns each release check for the sample and whether it passes now. Releasing the sample is a person’s decision in the app.',
    scope: 'lab:read',
    params: [['p_record_id', 'uuid', 1]],
    result: 'json',
  },
} satisfies Readonly<Record<string, LabRpc>>
