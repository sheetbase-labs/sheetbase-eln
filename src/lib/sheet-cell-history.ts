/**
 * Show changes: what each cell of a sheet held before and after every write.
 *
 * `api.sheet_cell_history` reads two records the database already keeps on
 * every write: the sheet's own writes (for its own columns) and dataset row
 * edits (for the dataset columns it shows). It runs as the caller, so the
 * sheet's read authority decides what comes back.
 */
import { z } from 'zod'

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import { pipelineJsonValueSchema } from './pipelines/types'

const changeSchema = z.object({
  at: z.string(),
  actorUserId: z.string().nullable(),
  source: z.enum(['sheet', 'dataset']),
  rowKey: z.string().nullable(),
  fieldId: z.string(),
  datasetId: z.string().nullable(),
  datasetRowId: z.string().nullable(),
  before: pipelineJsonValueSchema,
  after: pipelineJsonValueSchema,
  beforeKnown: z.boolean(),
  reason: z.string().nullable(),
})

export type SheetCellChange = z.infer<typeof changeSchema>

export async function fetchSheetCellHistory(
  instanceId: string,
  client: DataClient = createDataClient(),
): Promise<SheetCellChange[]> {
  return z.array(changeSchema).parse(
    await client.rpc<unknown>('sheet_cell_history', {
      p_instance_id: instanceId,
    }),
  )
}

/** Where a dataset column's cell sits, by the dataset row and field it shows. */
export function datasetCellKey(
  datasetId: string,
  rowId: string,
  fieldId: string,
): string {
  return `${datasetId}|${rowId}|${fieldId}`
}

export interface GridCellAddress {
  rowKey: string
  columnId: string
}

/** A change, placed on the sheet's own row and column. */
export interface PlacedSheetCellChange extends SheetCellChange {
  cell: GridCellAddress
}

/**
 * Puts each change on the cell that shows it. A sheet change names its row
 * and column already; a dataset change is found through the dataset row and
 * field each bound cell shows. Changes to rows this sheet does not show are
 * left out.
 */
export function placeSheetCellChanges(
  changes: readonly SheetCellChange[],
  input: {
    columnIds: ReadonlySet<string>
    rowKeys: ReadonlySet<string>
    datasetCells: ReadonlyMap<string, GridCellAddress>
  },
): PlacedSheetCellChange[] {
  return changes.flatMap((change) => {
    if (change.source === 'sheet') {
      return change.rowKey &&
        input.rowKeys.has(change.rowKey) &&
        input.columnIds.has(change.fieldId)
        ? [
            {
              ...change,
              cell: { rowKey: change.rowKey, columnId: change.fieldId },
            },
          ]
        : []
    }

    const cell =
      change.datasetId && change.datasetRowId
        ? input.datasetCells.get(
            datasetCellKey(
              change.datasetId,
              change.datasetRowId,
              change.fieldId,
            ),
          )
        : undefined

    return cell ? [{ ...change, cell }] : []
  })
}

function startOfDay(now: Date): number {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)

  return day.getTime()
}

/** Whether a change was made today, in the viewer's time zone. */
export function changedToday(change: SheetCellChange, now: Date): boolean {
  return Date.parse(change.at) >= startOfDay(now)
}

export function cellAddressKey(cell: GridCellAddress): string {
  return `${cell.rowKey}|${cell.columnId}`
}

/**
 * What each cell changed today held before its first change today, for the
 * struck-through value in the cell. A cell whose earlier value is not known
 * is left out: it shows the new value alone.
 */
export function valuesBeforeToday(
  changes: readonly PlacedSheetCellChange[],
  now: Date,
): Map<string, SheetCellChange['before']> {
  const before = new Map<string, SheetCellChange['before']>()

  // Newest first, so the last write to the map is the earliest change today.
  for (const change of changes) {
    if (!changedToday(change, now)) continue
    const key = cellAddressKey(change.cell)

    if (change.beforeKnown) before.set(key, change.before)
    else before.delete(key)
  }

  return before
}
