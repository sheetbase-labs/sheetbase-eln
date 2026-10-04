import { z } from 'zod'

import { composedRowKeySchema } from './sheet-instance'

const uuid = z.uuid()
const rowKey = z.union([uuid, composedRowKeySchema])
const target = z
  .object({
    instanceId: uuid,
    rowKeys: z.array(rowKey).min(1).max(500),
    fieldIds: z.array(uuid).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    for (const key of ['rowKeys', 'fieldIds'] as const) {
      if (new Set(value[key]).size !== value[key].length)
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Anchor identities must be unique.',
        })
    }
  })

export const sheetCommentAnchorSchema = z.discriminatedUnion('targetKind', [
  z
    .object({
      targetKind: z.literal('sheet_cell'),
      target: target.safeExtend({
        rowKeys: z.tuple([rowKey]),
        fieldIds: z.tuple([uuid]),
      }),
    })
    .strict(),
  z
    .object({
      targetKind: z.literal('sheet_row'),
      target: target.safeExtend({
        rowKeys: z.tuple([rowKey]),
        fieldIds: z.tuple([]),
      }),
    })
    .strict(),
  z
    .object({
      targetKind: z.literal('sheet_range'),
      target: target.safeExtend({ fieldIds: z.array(uuid).min(1).max(256) }),
    })
    .strict(),
])

export type SheetCommentAnchor = z.infer<typeof sheetCommentAnchorSchema>

/** The grid boundary supplies identities, never persisted display coordinates. */
export function sheetCommentAnchor(
  instanceId: string,
  targetKind: SheetCommentAnchor['targetKind'],
  rowKeys: readonly string[],
  fieldIds: readonly string[],
): SheetCommentAnchor {
  return sheetCommentAnchorSchema.parse({
    targetKind,
    target: {
      instanceId,
      rowKeys: [...rowKeys].sort(),
      fieldIds: [...fieldIds].sort(),
    },
  })
}

/** Mark only surviving identities; hidden/deleted targets are not reassigned. */
export function sheetCommentCells(
  anchor: SheetCommentAnchor,
  instanceId: string,
  rows: readonly { id: string }[],
  columns: readonly { id: string }[],
): Array<{ row: number; column: number }> {
  if (anchor.target.instanceId !== instanceId) return []
  return rows.flatMap((row, rowIndex) =>
    anchor.target.rowKeys.includes(row.id)
      ? columns.flatMap((column, columnIndex) =>
          anchor.targetKind === 'sheet_row' ||
          anchor.target.fieldIds.includes(column.id)
            ? [{ row: rowIndex, column: columnIndex }]
            : [],
        )
      : [],
  )
}
