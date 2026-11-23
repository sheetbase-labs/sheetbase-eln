import type { DataClient } from './data-client'
import { DataClientError } from './data-client'
import { fetchSheetInstance } from './sheet-instance-data'
import { createAdHocTextField, mutateSheetLocalState } from './sheet-local-data'
import type { LocalFieldChange } from './sheet-local-data'

/** The most columns one batch can add (the database allows 32 field changes). */
const MAX_COLUMNS = 32

/** The most rows in one batch, and the most cells (the database's limits). */
const MAX_ROWS_PER_BATCH = 200
const MAX_CELLS_PER_BATCH = 1_000

/**
 * A row address that keeps its place: the grid orders local rows by key, so
 * the first eight characters count the row and the rest is random.
 */
function orderedRowKey(index: number): string {
  const tail = crypto.randomUUID().split('-')

  return [
    index.toString(16).padStart(8, '0'),
    tail[1],
    `4${tail[2].slice(1)}`,
    `8${tail[3].slice(1)}`,
    tail[4],
  ].join('-')
}

/**
 * Fill a new ad hoc sheet with text columns and rows. The sheet starts with one
 * empty column; that column becomes the first heading and the rest are added.
 */
export async function writeGridToSheet(
  client: DataClient,
  instanceId: string,
  grid: { columns: string[]; rows: string[][] },
): Promise<void> {
  const instance = await fetchSheetInstance(instanceId, client)

  if (!instance) {
    throw new DataClientError('not_found', 'The new sheet was not found.', 404)
  }

  const first = instance.state.localFields.find(
    (field) => field.lifecycle === 'active',
  )

  if (!first) {
    throw new DataClientError(
      'invalid',
      'The new sheet has no column to start from.',
      422,
    )
  }

  const labels = grid.columns.slice(0, MAX_COLUMNS)
  const keys: string[] = []

  const fields = labels.map((label, index) => {
    const field = createAdHocTextField(label, keys)

    keys.push(field.key)

    return index === 0 ? { ...field, fieldId: first.fieldId } : field
  })

  const fieldChanges: LocalFieldChange[] = fields.map((field, index) => ({
    operation: index === 0 ? 'edit' : 'add',
    field,
  }))

  const perBatch = Math.max(
    1,
    Math.min(
      MAX_ROWS_PER_BATCH,
      Math.floor(MAX_CELLS_PER_BATCH / Math.max(fields.length, 1)),
    ),
  )

  let revision = instance.revision
  let sent = false

  for (let start = 0; start < grid.rows.length || !sent; start += perBatch) {
    const slice = grid.rows.slice(start, start + perBatch)

    const rows = slice.map((_, offset) => ({
      kind: 'local' as const,
      rowKey: orderedRowKey(start + offset + 1),
    }))

    const cells = slice.flatMap((row, offset) =>
      fields.flatMap((field, column) => {
        const value = row[column]

        return !value
          ? []
          : [{ rowKey: rows[offset].rowKey, fieldId: field.fieldId, value }]
      }),
    )

    const updated = await mutateSheetLocalState(
      {
        instanceId,
        expectedRevision: revision,
        retryToken: crypto.randomUUID(),
        fieldChanges: sent ? [] : fieldChanges,
        rows,
        cells,
      },
      client,
    )

    revision = updated.revision
    sent = true
  }
}
