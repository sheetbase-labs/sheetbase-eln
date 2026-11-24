/**
 * One kind of result across datasets. A measurement table says what a result
 * looks like; many datasets are built on it. These reads return its rows across
 * every dataset the person can open, live or pinned to snapshots, with the
 * dataset and snapshot each row came from. Declared once, so the public API,
 * the SDKs, MCP (`sheetbase.lab.act`), the assistant, pipeline actions and the
 * Results tab on a measurement table all use the same call.
 *
 * Both act as the person (or personal token) that calls them, so a dataset
 * they cannot open is never read.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

import { MEASUREMENT_RESULTS_READ_TOOL } from './tool'

const note = (field: OperationInput, description: string): OperationInput => ({
  ...field,
  description,
})

const DOCS = 'measurement-results-api.md'

export const MEASUREMENT_RESULTS_OPERATIONS = defineOperations([
  {
    name: 'measurement_table_sources',
    label: 'List the datasets that hold one kind of result',
    summary: 'The datasets, and their snapshots, that hold a measurement table',
    description:
      'Every dataset you can open that is built on a measurement table (and, unless `p_include_subtypes` is false, on a table that extends it), with its row count and the snapshots it has, so you can choose what `query_measurement_table_rows` reads. A dataset you cannot open is not listed.',
    kind: 'read',
    scope: 'datasets:read',
    inputs: [
      note(
        input('p_schema_definition_id', 'uuid'),
        'The measurement table (`dataset_schema_definitions.id`).',
      ),
      note(
        input('p_include_subtypes', 'bool', false),
        'Count datasets on a table that extends this one. True if left out.',
      ),
    ],
    result: 'json',
    docsPage: DOCS,
  },
  {
    name: 'query_measurement_table_rows',
    label: 'Read one kind of result across datasets',
    summary: 'Rows of a measurement table across every dataset that holds it',
    description:
      'One read for the rows of a measurement table across all the datasets you can open, live or pinned to snapshots, with the dataset and snapshot each row came from. Values are keyed by the column keys of the table’s latest published version; datasets still on an older version line up by field, and a column a dataset did not have reads as missing. `p_query` may hold `mode` (`live`, the default, or `latest_snapshot`, which leaves out and reports datasets with no snapshot), `datasets` (only these dataset ids), `pins` (`{ dataset id: dataset version id }`, read that snapshot whatever the mode), `includeSubtypes` (default true), `recordId` (only rows that link to this record in any link column), `filters` (up to eight `{ field, operator, value }`, `field` a column key or field id, `operator` `eq`, `gt`, `gte`, `lt` or `lte`) and `sort` (`{ field, direction }`). `p_limit` is 1 to 1000 (default 200). Returns `{ tableId, tableKey, columns, sources, skipped, totalCount, hasMore, rows }`; each row has `rowId`, `datasetId`, `datasetDisplayId`, `datasetName`, `datasetVersionId`, `snapshotLabel`, `live`, `datasetRevision` and `values`.',
    kind: 'read',
    scope: 'datasets:read',
    inputs: [
      note(
        input('p_schema_definition_id', 'uuid'),
        'The measurement table (`dataset_schema_definitions.id`).',
      ),
      note(
        input('p_query', 'json', false),
        'What to read: `{ mode?, datasets?, pins?, includeSubtypes?, recordId?, filters?, sort? }`. Everything is optional; `{}` reads every dataset you can open, live.',
      ),
      note(
        input('p_limit', 'int', false),
        'Page size, 1 to 1000. 200 if left out.',
      ),
      note(input('p_offset', 'int', false), 'Rows to skip. 0 if left out.'),
    ],
    result: 'json',
    assistant: {
      tool: MEASUREMENT_RESULTS_READ_TOOL,
      presentation: 'answer',
      vocabulary: 'read',
    },
    pipeline: {},
    docsPage: DOCS,
  },
])
