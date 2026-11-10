import { z } from 'zod'

import { parameterSchema } from './parameter'
import {
  parseSheetDefinitionConfiguration,
  sheetDefinitionUuidSchema as uuid,
} from './sheet-definition'

const key = z.string().regex(/^[a-z][a-z0-9_]{0,59}$/)
const uniqueIds = (values: string[]) => new Set(values).size === values.length

export const sheetDefinitionExtractionSelectionSchema = z
  .strictObject({
    bindings: z
      .array(
        z.strictObject({
          bindingId: uuid,
          key,
          parameter: parameterSchema,
        }),
      )
      .max(64),
    columnIds: z.array(uuid).max(256),
    joinIds: z.array(uuid).max(16),
    localFieldIds: z.array(uuid).max(256),
    calculationIds: z.array(uuid).max(128),
    rowIdentity: z.strictObject({
      kind: z.enum(['source', 'composite', 'local']),
      columnIds: z.array(uuid).min(1).max(8),
    }),
    includePresentation: z.boolean(),
  })
  .superRefine((selection, context) => {
    for (const [path, ids] of [
      ['bindings.bindingId', selection.bindings.map((item) => item.bindingId)],
      [
        'bindings.parameter.id',
        selection.bindings.map((item) => item.parameter.id),
      ],
      ['bindings.key', selection.bindings.map((item) => item.key)],
      ['columnIds', selection.columnIds],
      ['joinIds', selection.joinIds],
      ['localFieldIds', selection.localFieldIds],
      ['calculationIds', selection.calculationIds],
      ['rowIdentity.columnIds', selection.rowIdentity.columnIds],
    ] as const) {
      if (!uniqueIds(ids))
        context.addIssue({
          code: 'custom',
          path: [path],
          message: `${path} must be unique.`,
        })
    }
  })

const reusableManifestSchema = z.strictObject({
  parameterIds: z.array(uuid).max(64),
  bindingIds: z.array(uuid).max(64),
  sourceColumnIds: z.array(uuid).max(256),
  joinIds: z.array(uuid).max(16),
  localFieldIds: z.array(uuid).max(256),
  calculationIds: z.array(uuid).max(128),
  presentationDefaultsIncluded: z.boolean(),
})

const excludedManifestSchema = z.strictObject({
  concreteBindingValueBindingIds: z.array(uuid).max(64),
  unselectedSourceColumnIds: z.array(uuid).max(256),
  unselectedJoinIds: z.array(uuid).max(16),
  unselectedLocalFieldIds: z.array(uuid).max(256),
  unselectedCalculationIds: z.array(uuid).max(128),
  localValues: z.strictObject({
    rowCount: z.number().int().min(0),
    cellCount: z.number().int().min(0),
  }),
  calculationOverrideIds: z.array(uuid).max(128),
  calculationResults: z.literal('all'),
  writeBackRuleIds: z.array(uuid).max(64),
  actionIds: z.array(uuid).max(64),
  presentationValueFilterCount: z.number().int().min(0).max(32),
  presentationOutOfRangeWidthColumnIds: z.array(uuid).max(256),
  rowIdentitiesDerivedFromValues: z.literal('all'),
})

export const sheetDefinitionExtractionPreviewSchema = z
  .strictObject({
    source: z.strictObject({
      instanceId: uuid,
      instanceRevision: z.number().int().positive(),
    }),
    selection: sheetDefinitionExtractionSelectionSchema,
    configuration: z.unknown(),
    manifest: z.strictObject({
      reusable: reusableManifestSchema,
      excluded: excludedManifestSchema,
    }),
  })
  .transform((preview) => ({
    ...preview,
    configuration: parseSheetDefinitionConfiguration(preview.configuration),
  }))

export type SheetDefinitionExtractionSelection = z.infer<
  typeof sheetDefinitionExtractionSelectionSchema
>

export type SheetDefinitionExtractionPreview = z.output<
  typeof sheetDefinitionExtractionPreviewSchema
>

export function parseSheetDefinitionExtractionSelection(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The schema boundary itself: `sheetDefinitionExtractionSelectionSchema` decides what an extraction selection is, so its input cannot be typed before it runs.
  value: unknown,
) {
  return sheetDefinitionExtractionSelectionSchema.parse(value)
}

export function parseSheetDefinitionExtractionPreview(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The schema boundary itself: `sheetDefinitionExtractionPreviewSchema` decides what an extraction preview is, so its input cannot be typed before it runs.
  value: unknown,
) {
  return sheetDefinitionExtractionPreviewSchema.parse(value)
}
