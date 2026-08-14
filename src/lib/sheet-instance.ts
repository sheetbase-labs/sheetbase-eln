import { z } from 'zod'

import {
  sheetDefinitionUuidSchema as uuid,
  sheetFieldDefinitionSchema,
} from './sheet-definition'

const jsonScalar = z.union([
  z.string().max(100_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
])
const localRow = z
  .record(uuid, jsonScalar)
  .refine(
    (value) => Object.keys(value).length <= 256,
    'A local row may contain at most 256 values.',
  )

const binding = z.discriminatedUnion('kind', [
  z
    .object({
      bindingId: uuid,
      parameterId: uuid,
      kind: z.literal('dataset'),
      datasetId: uuid,
      policy: z.discriminatedUnion('mode', [
        z.object({ mode: z.literal('live') }).strict(),
        z
          .object({ mode: z.literal('version'), datasetVersionId: uuid })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      bindingId: uuid,
      parameterId: uuid,
      kind: z.literal('record'),
      recordId: uuid,
      policy: z.literal('live'),
    })
    .strict(),
])

export const sheetInstanceStateSchema = z
  .object({
    bindings: z.array(binding).max(64),
    localFields: z.array(sheetFieldDefinitionSchema).max(256),
    localValues: z
      .record(uuid, localRow)
      .refine((value) => Object.keys(value).length <= 10_000),
    calculationOverrides: z
      .record(
        uuid,
        z
          .object({
            enabled: z.boolean(),
            expression: z
              .object({
                language: z.literal('sheetbase-formula-v1'),
                source: z.string().trim().min(1).max(8_192),
              })
              .strict(),
          })
          .strict(),
      )
      .refine((value) => Object.keys(value).length <= 128),
    presentation: z
      .object({
        columnOrder: z.array(uuid).max(512),
        hiddenColumnIds: z.array(uuid).max(512),
        columnWidths: z.record(uuid, z.number().int().min(40).max(2_000)),
        frozenColumnCount: z.number().int().min(0).max(512),
        density: z.enum(['compact', 'standard', 'comfortable']),
      })
      .strict(),
    provenance: z.discriminatedUnion('createdFrom', [
      z.object({ createdFrom: z.literal('ad_hoc') }).strict(),
      z.object({ createdFrom: z.literal('definition_version') }).strict(),
      z
        .object({
          createdFrom: z.literal('duplicate'),
          duplicatedFromInstanceId: uuid,
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [path, values] of [
      ['bindings.bindingId', value.bindings.map((item) => item.bindingId)],
      ['bindings.parameterId', value.bindings.map((item) => item.parameterId)],
      ['localFields.fieldId', value.localFields.map((item) => item.fieldId)],
    ] as const) {
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: 'custom',
          path: [path],
          message: `${path} must be unique.`,
        })
    }
    const localFieldIds = new Set(value.localFields.map((item) => item.fieldId))
    for (const [rowId, row] of Object.entries(value.localValues)) {
      for (const fieldId of Object.keys(row)) {
        if (!localFieldIds.has(fieldId))
          context.addIssue({
            code: 'custom',
            path: ['localValues', rowId, fieldId],
            message: 'Local value references an unknown local field.',
          })
      }
    }
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 1_048_576)
      context.addIssue({
        code: 'custom',
        message: 'Sheet Instance state exceeds 1 MiB.',
      })
  })

export type SheetInstanceState = z.infer<typeof sheetInstanceStateSchema>
export type SheetInstanceParseResult = ReturnType<
  typeof safeParseSheetInstanceState
>

export function safeParseSheetInstanceState(value: unknown) {
  return sheetInstanceStateSchema.safeParse(value)
}

export function parseSheetInstanceState(value: unknown): SheetInstanceState {
  return sheetInstanceStateSchema.parse(value)
}
