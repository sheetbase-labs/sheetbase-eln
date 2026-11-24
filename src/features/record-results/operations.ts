/**
 * Every result on a record: the dataset rows whose link column holds it,
 * grouped by the measurement table they follow. Declared once, so the public
 * API, the SDKs, MCP (`sheetbase.lab.act`), the assistant and pipeline actions
 * come from this entry.
 *
 * It only reads. The person (or the token) sees the datasets they may see, and
 * nothing else.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

export const RECORD_RESULTS_READ_TOOL = 'sheetbase.record_results.read'

const note = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
): OperationInput => ({ ...input(name, type, required), description })

export const RECORD_RESULTS_OPERATIONS = defineOperations([
  {
    name: 'record_results',
    label: 'Read every result on a record',
    summary: 'Every result on a record, by measurement table',
    description:
      'Returns `{ total, rows }`: each dataset row whose link column holds the record, newest first, with its measurement table (`tableId`, `tableKey`, `tableName`), its dataset, `source` (`live`, or `snapshot` with `snapshotId` and `snapshotLabel`) and every value as `{ key, label, type, unit, value, linksHere }`. A link column’s value is the linked record’s id. Only datasets you may see are included. Changes nothing.',
    kind: 'read',
    scope: 'datasets:read',
    inputs: [
      note(
        'p_record_id',
        'uuid',
        'The record: a sample, material, experiment or any record type.',
      ),
      note(
        'p_include_snapshots',
        'bool',
        'Also return the rows kept in dataset snapshots. Default false: live rows only.',
        false,
      ),
      note('p_limit', 'int', 'Rows to return, 1 to 1000. Default 500.', false),
      note('p_offset', 'int', 'Rows to skip. Default 0.', false),
    ],
    result: 'json',
    assistant: {
      tool: RECORD_RESULTS_READ_TOOL,
      presentation: 'answer',
      vocabulary: 'read',
    },
    pipeline: {},
    docsPage: 'record-results-api.md',
  },
])
