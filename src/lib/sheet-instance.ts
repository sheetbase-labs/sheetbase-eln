import { z } from 'zod'

import { rfc3339TimestampSchema } from './parameter'
import { sheetInstanceCalculationSchema } from './sheet-calculation'
import {
  sheetDefinitionUuidSchema as uuid,
  sheetFieldDefinitionSchema,
} from './sheet-definition'

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

const jsonScalar = z.union([
  z.string().max(100_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
])
const localValue = z.union([jsonScalar, z.array(jsonScalar).min(1).max(1_000)])
const presentationFilter = z
  .object({
    columnId: uuid,
    operator: z.enum(['equals', 'not-equals', 'is-empty', 'is-not-empty']),
    value: jsonScalar.optional(),
  })
  .strict()
  .superRefine((filter, context) => {
    if (
      (filter.operator === 'is-empty' || filter.operator === 'is-not-empty') !==
      (filter.value === undefined)
    )
      context.addIssue({
        code: 'custom',
        message: 'Only equality filters require a value.',
      })
  })
export const composedRowKeySchema = z.string().regex(/^sb-row-v1:[0-9a-f]{64}$/)
const localRow = z
  .record(uuid, localValue)
  .refine(
    (value) => Object.keys(value).length <= 256,
    'A local row may contain at most 256 values.',
  )

const datasetResolution = z
  .object({
    compatibilityMode: z.enum(['exact', 'lineage', 'semantic']),
    candidateSchemaVersionId: uuid,
    baselineSchemaVersionId: uuid.nullable(),
    requiredFieldIds: z.array(uuid).max(64),
  })
  .strict()

const binding = z.discriminatedUnion('kind', [
  z
    .object({
      bindingId: uuid,
      parameterId: uuid,
      kind: z.literal('dataset'),
      datasetId: uuid,
      resolution: datasetResolution.optional(),
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
      modelKey: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,59}$/)
        .optional(),
      policy: z.literal('live'),
    })
    .strict(),
])

const parameterValue = z
  .object({
    parameterId: uuid,
    kind: z.literal('scalar'),
    valueType: z.enum([
      'text',
      'integer',
      'decimal',
      'boolean',
      'date',
      'timestamp',
      'category',
      'reference',
    ]),
    value: jsonScalar,
    source: z.enum(['supplied', 'default']),
  })
  .strict()

const resolutionProvenance = z
  .object({
    sourceDefinitionVersionId: uuid,
    resolvedAt: rfc3339TimestampSchema,
    resolvedByUserId: z.string().min(1).max(1_000),
    parameters: z
      .array(
        z
          .object({
            parameterId: uuid,
            bindingId: uuid.nullable(),
            kind: z.enum(['scalar', 'record', 'dataset', 'dataset-version']),
            compatibilityMode: z
              .enum(['exact', 'lineage', 'semantic'])
              .nullable(),
            datasetId: uuid.nullable(),
            datasetVersionId: uuid.nullable(),
            candidateSchemaVersionId: uuid.nullable(),
            baselineSchemaVersionId: uuid.nullable(),
            requiredFieldIds: z.array(uuid).max(64),
          })
          .strict(),
      )
      .max(64),
  })
  .strict()

const resolvedRowIdentity = z
  .object({
    formatVersion: z.literal(1),
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
    sourceBindingId: uuid.nullable(),
    sourceFieldId: uuid.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = value.kind === 'composite' ? [2, 8] : [1, 1]
    if (
      value.columnIds.length < expected[0] ||
      value.columnIds.length > expected[1] ||
      value.columnIds.length !== value.logicalTypes.length ||
      new Set(value.columnIds).size !== value.columnIds.length ||
      (value.kind === 'local' && value.logicalTypes[0] !== 'reference')
    )
      context.addIssue({
        code: 'custom',
        message: 'Invalid resolved row identity columns.',
      })
    if (
      value.kind === 'source'
        ? value.sourceBindingId === null || value.sourceFieldId === null
        : value.sourceBindingId !== null || value.sourceFieldId !== null
    )
      context.addIssue({
        code: 'custom',
        message: 'Invalid resolved row identity provenance.',
      })
  })

export const sheetInstanceStateSchema = z
  .object({
    bindings: z.array(binding).max(64),
    parameterValues: z.array(parameterValue).max(64).optional(),
    localFields: z.array(sheetFieldDefinitionSchema).max(256),
    localValues: z
      .record(z.union([uuid, composedRowKeySchema]), localRow)
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
    instanceCalculations: z
      .array(sheetInstanceCalculationSchema)
      .max(128)
      .optional(),
    presentation: z
      .object({
        columnOrder: z.array(uuid).max(512),
        hiddenColumnIds: z.array(uuid).max(512),
        columnWidths: z.record(uuid, z.number().int().min(40).max(2_000)),
        frozenColumnCount: z.number().int().min(0).max(512),
        density: z.enum(['compact', 'standard', 'comfortable']),
        filters: z.array(presentationFilter).max(32).default([]),
        sorts: z
          .array(
            z
              .object({ columnId: uuid, direction: z.enum(['asc', 'desc']) })
              .strict(),
          )
          .max(8)
          .default([]),
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
    resolutionProvenance: resolutionProvenance.optional(),
    resolvedRowIdentity: resolvedRowIdentity.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [path, values] of [
      ['bindings.bindingId', value.bindings.map((item) => item.bindingId)],
      ['bindings.parameterId', value.bindings.map((item) => item.parameterId)],
      [
        'parameterValues.parameterId',
        value.parameterValues?.map((item) => item.parameterId) ?? [],
      ],
      ['localFields.fieldId', value.localFields.map((item) => item.fieldId)],
      [
        'instanceCalculations.id',
        value.instanceCalculations?.map((item) => item.id) ?? [],
      ],
    ] as const) {
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: 'custom',
          path: [path],
          message: `${path} must be unique.`,
        })
    }
    const localFields = new Map(
      value.localFields.map((item) => [item.fieldId, item]),
    )
    for (const [rowId, row] of Object.entries(value.localValues)) {
      for (const fieldId of Object.keys(row)) {
        const field = localFields.get(fieldId)
        if (!field)
          context.addIssue({
            code: 'custom',
            path: ['localValues', rowId, fieldId],
            message: 'Local value references an unknown local field.',
          })
        else if ((field.cardinality === 'many') !== Array.isArray(row[fieldId]))
          context.addIssue({
            code: 'custom',
            path: ['localValues', rowId, fieldId],
            message: 'Local value does not match field cardinality.',
          })
      }
    }
    if (utf8ByteLength(JSON.stringify(value)) > 1_048_576)
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
