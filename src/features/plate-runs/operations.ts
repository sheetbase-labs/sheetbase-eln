/**
 * Plate runs in experiments, and the assay setup a design remembers. One
 * declaration gives the token API entry, the MCP action, the pipeline action
 * and the webhook events (see `docs/development/adding-an-operation.md`).
 * Showing a run in the notebook is the existing `insert_block` with the
 * `plate_run` block type, so nothing more is needed for that on the API.
 * Remembering a setup takes a JSON setup, which a pipeline action cannot, so it
 * is not a pipeline step; a pipeline can still start on its event.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'

export const PLATE_RUN_OPERATIONS = defineOperations([
  {
    name: 'link_plate_run',
    label: 'Add a plate run to an experiment',
    summary: 'Add a plate run to an experiment',
    description:
      'Attaches a plate run to an experiment, moves it to another, or detaches it when no experiment is given. The run takes the experiment’s project. Show it in the notebook with `insert_block` and the block type `plate_run` (payload `{ "runId": "<id>" }`). Returns the run. Sends `plate_run.linked` or `plate_run.unlinked`.',
    kind: 'write',
    inputs: [
      input('p_plate_run_id', 'uuid'),
      {
        ...input('p_record_id', 'uuid', false, true),
        description:
          'The experiment. Leave it out to take the run out of its experiment.',
      },
    ],
    result: 'row:plate_runs',
    pipeline: {},
    events: [
      {
        name: 'plate_run.linked',
        family: 'inventory',
        summary: 'A plate run was added to an experiment.',
        producer: {
          entityType: 'plate_run',
          operation: 'update',
          when: { key: 'change', equals: 'linked' },
        },
        notes:
          'Payload carries plateRunId, reference, name, recordId (the experiment) and previousRecordId.',
      },
      {
        name: 'plate_run.unlinked',
        family: 'inventory',
        summary: 'A plate run was taken out of an experiment.',
        producer: {
          entityType: 'plate_run',
          operation: 'update',
          when: { key: 'change', equals: 'unlinked' },
        },
        notes:
          'Payload carries plateRunId, reference, name and previousRecordId.',
      },
    ],
  },
  {
    name: 'save_plate_design_assay_setup',
    label: 'Remember an assay setup',
    summary: 'Remember an assay setup on its design',
    description:
      'Saves how an assay is read on its plate design, so the next plate of the same assay is analysed the same way without anything typed again. The setup is `{ "config": { normalisation, effectDirection, subtractBlank, hit, qc, curveModel }, "negativeColumns": "1", "positiveColumns": "12" }`; only `config` is required. When a plate run is given it is pointed at the design too. Returns the design. Sends `plate_design.assay_setup_saved`.',
    kind: 'write',
    inputs: [
      input('p_design_id', 'uuid'),
      {
        ...input('p_setup', 'json'),
        description:
          'The setup: `config` (the plate assay settings), and optionally `negativeColumns` and `positiveColumns` (the control columns, such as "1" or "11-12").',
      },
      {
        ...input('p_plate_run_id', 'uuid', false, true),
        description:
          'A plate run to point at the design as well, so its settings are the ones remembered.',
      },
    ],
    result: 'row:plate_designs',
    assistant: { tool: 'sheetbase.plate.remember_setup' },
    events: [
      {
        name: 'plate_design.assay_setup_saved',
        family: 'inventory',
        summary: 'An assay setup was remembered on a plate design.',
        producer: {
          entityType: 'plate_design',
          operation: 'update',
          when: { key: 'change', equals: 'assay_setup_saved' },
        },
        notes:
          'Payload carries plateDesignId, name, plateRunId, normalisation and curveModel.',
      },
    ],
  },
  {
    name: 'add_step_plate_run',
    label: 'Put a plate run in a protocol step',
    summary: 'Put a plate run in a protocol step',
    description:
      'Puts a plate run in the protocol step it was run for. The run joins the step’s experiment, its plate run block goes straight after the step (or after the step’s last piece of data), and the step reads in progress. A block the notebook already had for the run is moved into the step. Finish the step with `set_step_done` once its last plate is in. Returns `{ block_id, step_block_id, record_id, plate_run_id, already_there }`. Sends `step_result` with `resultType` `plate_run`.',
    kind: 'write',
    inputs: [
      {
        ...input('p_block_id', 'uuid'),
        description: 'The protocol step (a `procedure_step` block).',
      },
      input('p_plate_run_id', 'uuid'),
    ],
    result: 'json',
    pipeline: {},
  },
  {
    name: 'publish_plate_run_measurements',
    label: 'Give a plate run’s results to its samples',
    summary: 'Give a plate run’s results to its samples',
    description:
      'Writes what a quantified plate run read for each sample (its concentration, dilution already applied) to that sample as a measurement, so the result shows on the sample page. Only samples that read inside the standard curve get one. Running it again replaces the measurements this run wrote earlier; measurements from anywhere else are left alone. Returns `{ published, skipped }`. Sends `plate_run.measurements_published`.',
    kind: 'write',
    inputs: [
      input('p_plate_run_id', 'uuid'),
      {
        ...input('p_name', 'text', false, true),
        description:
          'What the measurement is called on the sample, such as "Capsid titre". Defaults to the assay design’s name, else the run’s.',
      },
    ],
    result: 'json',
    assistant: { tool: 'sheetbase.plate.publish_measurements' },
    pipeline: {},
    events: [
      {
        name: 'plate_run.measurements_published',
        family: 'inventory',
        summary: 'A plate run’s results were written to its samples.',
        producer: {
          entityType: 'plate_run',
          operation: 'update',
          when: { key: 'change', equals: 'measurements_published' },
        },
        notes:
          'Payload carries plateRunId, reference, name, recordId (the experiment), published and skipped.',
      },
    ],
  },
])
