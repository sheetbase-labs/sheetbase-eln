import { z } from 'zod'

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import { rowIdentityKey } from './row-identity'
import { sheetDefinitionUuidSchema as uuid } from './sheet-definition'

const sourceSchema = z
  .object({
    bindingId: uuid,
    datasetId: uuid,
    rowId: uuid.nullable(),
    revision: z.number().int().nullable(),
    matched: z.boolean(),
    values: z.record(z.string(), z.unknown()),
  })
  .strict()

const wireSchema = z
  .object({
    instanceId: uuid,
    revision: z.number().int().positive(),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(200),
    hasMore: z.boolean(),
    identity: z
      .object({
        kind: z.enum(['source', 'composite', 'local']),
        columnIds: z.array(uuid).min(1).max(8),
        logicalTypes: z
          .array(
            z.enum([
              'text',
              'integer',
              'decimal',
              'boolean',
              'date',
              'timestamp',
              'category',
              'reference',
            ]),
          )
          .min(1)
          .max(8),
      })
      .strict(),
    rows: z.array(
      z
        .object({
          identityValues: z.array(z.unknown()).min(1).max(8),
          sources: z.array(sourceSchema).min(1).max(17),
        })
        .strict(),
    ),
  })
  .strict()

export type ComposedSheetRow = z.infer<typeof wireSchema>['rows'][number] & {
  rowKey: string
}

/** Bounded virtual composition; this deliberately does not project Sheet columns. */
export async function fetchComposedSheetRows(
  instanceId: string,
  options: { limit?: number; offset?: number } = {},
  client: DataClient = createDataClient(),
) {
  const result = wireSchema.parse(
    await client.rpc<unknown>('query_sheet_instance_rows', {
      p_instance_id: instanceId,
      p_limit: options.limit ?? 50,
      p_offset: options.offset ?? 0,
    }),
  )
  // All output rows use the Instance's immutable resolved identity spec. The
  // RPC returns only typed values; hashing remains exactly CORE-03.5's shared
  // implementation rather than duplicating its encoding in SQL.
  const rowKey = (row: z.infer<typeof wireSchema>['rows'][number]) =>
    rowIdentityKey(result.identity, row.identityValues)
  return {
    ...result,
    rows: result.rows.map((row) => ({ ...row, rowKey: rowKey(row) })),
  }
}
