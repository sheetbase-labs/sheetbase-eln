/**
 * Plate runs in experiments. One declaration gives the token API entry, the MCP
 * action, the pipeline action and the webhook events (see
 * `docs/development/adding-an-operation.md`). Showing a run in the notebook is
 * the existing `insert_block` with the `plate_run` block type, so nothing more
 * is needed for that on the API.
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
])
