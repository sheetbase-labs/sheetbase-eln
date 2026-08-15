import { z } from 'zod'

import { createDataClient } from './data-client'
import type { DataClient } from './data-client'
import {
  sheetDefinitionUuidSchema as uuid,
  sheetFieldDefinitionSchema,
} from './sheet-definition'

const definitionSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('bound'), bindingId: uuid, sourceFieldId: uuid })
    .strict(),
  z.object({ kind: z.literal('declared') }).strict(),
  z.object({ kind: z.literal('calculated'), calculationId: uuid }).strict(),
])

const outputFieldSchema = z.discriminatedUnion('kind', [
  z
    .object({
      id: uuid,
      kind: z.literal('definition-column'),
      field: sheetFieldDefinitionSchema,
      source: definitionSourceSchema,
    })
    .strict(),
  z
    .object({
      id: uuid,
      kind: z.literal('local-field'),
      field: sheetFieldDefinitionSchema,
    })
    .strict(),
  z
    .object({
      id: uuid,
      kind: z.literal('instance-calculation'),
      field: sheetFieldDefinitionSchema,
      calculationId: uuid,
    })
    .strict(),
])

const sourceVersionSchema = z
  .object({
    bindingId: uuid,
    datasetId: uuid,
    datasetRevision: z.number().int().positive(),
    schemaVersionId: uuid,
    pinKind: z.enum(['live-snapshot', 'pinned-version']),
    datasetVersionId: uuid.nullable(),
    policy: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('live') }).strict(),
      z.object({ mode: z.literal('version'), datasetVersionId: uuid }).strict(),
    ]),
  })
  .strict()

const previewSchema = z
  .object({
    instanceId: uuid,
    instanceRevision: z.number().int().positive(),
    definitionVersionId: uuid,
    outputSchemaVersionId: uuid.nullable(),
    derivedOutputFields: z.array(outputFieldSchema).min(1),
    sourceVersions: z.array(sourceVersionSchema).min(1),
    previewDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

export type SheetMaterializationPreview = z.infer<typeof previewSchema>

const resultSchema = z
  .object({
    materializationId: uuid,
    datasetId: uuid,
    datasetVersionId: uuid,
    schemaVersionId: uuid.optional(),
    sourceVersions: z.array(sourceVersionSchema).optional(),
    idempotent: z.boolean(),
  })
  .strict()

export type SheetMaterializationResult = z.infer<typeof resultSchema>

/** Explicit server-side materialisation. Composition remains virtual unless a
 * caller first obtains this preview and then confirms it with its digest. */
export async function previewSheetMaterialization(
  input: {
    instanceId: string
    expectedRevision: number
    outputSchemaVersionId?: string | null
  },
  client: DataClient = createDataClient(),
): Promise<SheetMaterializationPreview> {
  return previewSchema.parse(
    await client.rpc('preview_sheet_materialization', {
      p_instance_id: uuid.parse(input.instanceId),
      p_expected_instance_revision: input.expectedRevision,
      p_output_schema_version_id: input.outputSchemaVersionId ?? null,
    }),
  )
}

export async function materializeSheetInstance(
  input: {
    instanceId: string
    expectedRevision: number
    outputName: string
    outputSchemaVersionId?: string | null
    previewDigest: string
    idempotencyKey: string
  },
  client: DataClient = createDataClient(),
): Promise<SheetMaterializationResult> {
  return resultSchema.parse(
    await client.rpc('materialize_sheet_instance', {
      p_instance_id: uuid.parse(input.instanceId),
      p_expected_instance_revision: input.expectedRevision,
      p_output_name: input.outputName,
      p_output_schema_version_id: input.outputSchemaVersionId ?? null,
      p_preview_digest: input.previewDigest,
      p_idempotency_key: uuid.parse(input.idempotencyKey),
    }),
  )
}
