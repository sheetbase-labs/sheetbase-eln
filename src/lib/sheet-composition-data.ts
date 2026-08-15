import { z } from 'zod'

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import { rowIdentityKey } from './row-identity'
import { projectBoundColumns } from './sheet-bound-columns'
import {
  parseSheetDefinitionConfiguration,
  sheetDefinitionUuidSchema as uuid,
} from './sheet-definition'
import type { SheetDefinitionConfiguration } from './sheet-definition'

const datasetSourceSchema = z
  .object({
    sourceKind: z.literal('dataset'),
    bindingId: uuid,
    datasetId: uuid,
    datasetRevision: z.number().int().positive(),
    rowId: uuid.nullable(),
    revision: z.number().int().nullable(),
    matched: z.boolean(),
    values: z.record(z.string(), z.unknown()),
  })
  .strict()

const recordSourceSchema = z
  .object({
    sourceKind: z.literal('record'),
    bindingId: uuid,
    recordId: uuid,
    metadataVersion: z.number().int().positive(),
    fieldNames: z.record(z.string(), z.string()),
    matched: z.literal(true),
    values: z.record(z.string(), z.unknown()),
  })
  .strict()

const sourceSchema = z.discriminatedUnion('sourceKind', [
  datasetSourceSchema,
  recordSourceSchema,
])

export const composedSheetWireSchema = z
  .object({
    instanceId: uuid,
    definitionVersionId: uuid.optional(),
    definitionConfiguration: z.unknown().optional(),
    revision: z.number().int().positive(),
    offset: z.number().int().min(0),
    limit: z.number().int().min(1).max(200),
    hasMore: z.boolean(),
    localFieldIds: z.array(uuid).max(256),
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

export type ComposedSheetRow = z.infer<
  typeof composedSheetWireSchema
>['rows'][number] & {
  rowKey: string
  compositionOffset?: number
}

export interface ComposedSheetSnapshot extends Omit<
  z.infer<typeof composedSheetWireSchema>,
  'definitionConfiguration' | 'rows'
> {
  definitionConfiguration?: SheetDefinitionConfiguration
  rows: ComposedSheetRow[]
  boundProjection?: ReturnType<typeof projectBoundColumns>
}

/**
 * Bounded server-authoritative composition with the pinned Definition's bound
 * column projection. Source rows remain available for existing CORE-03.6
 * consumers; the `boundProjection` adds canonical display metadata and value
 * provenance without adding a write path.
 */
export async function fetchComposedSheetRows(
  instanceId: string,
  options: { limit?: number; offset?: number } = {},
  client: DataClient = createDataClient(),
): Promise<ComposedSheetSnapshot> {
  const result = composedSheetWireSchema.parse(
    await client.rpc<unknown>('query_sheet_instance_rows', {
      p_instance_id: instanceId,
      p_limit: options.limit ?? 50,
      p_offset: options.offset ?? 0,
    }),
  )
  // All output rows use the Instance's immutable resolved identity spec. The
  // RPC returns only typed values; hashing remains exactly CORE-03.5's shared
  // implementation rather than duplicating its encoding in SQL.
  const rowKey = (
    row: z.infer<typeof composedSheetWireSchema>['rows'][number],
  ) => rowIdentityKey(result.identity, row.identityValues)
  const rows = result.rows.map((row) => ({
    ...row,
    rowKey: rowKey(row),
    compositionOffset: result.offset,
  }))
  const configuration = result.definitionConfiguration
    ? parseSheetDefinitionConfiguration(result.definitionConfiguration)
    : undefined
  const { definitionConfiguration: _, ...authoritative } = result
  return {
    ...authoritative,
    ...(configuration ? { definitionConfiguration: configuration } : {}),
    rows,
    ...(result.definitionVersionId && configuration
      ? {
          boundProjection: projectBoundColumns({
            definitionVersionId: result.definitionVersionId,
            configuration,
            rows,
          }),
        }
      : {}),
  }
}
