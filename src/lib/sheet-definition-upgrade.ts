import { z } from 'zod'

import { sheetDefinitionUuidSchema as uuid } from './sheet-definition'

const automaticKind = z.enum([
  'column-added',
  'column-label-renamed',
  'parameter-added',
  'parameter-label-renamed',
  'binding-added',
  'join-added',
  'calculation-added',
  'write-back-added',
  'action-added',
])

const conflictKind = z.enum([
  'column-removed',
  'column-incompatible',
  'parameter-removed',
  'parameter-changed',
  'parameter-required',
  'binding-removed',
  'binding-changed',
  'row-identity-changed',
  'join-removed',
  'join-changed',
  'calculation-removed',
  'calculation-changed',
  'write-back-removed',
  'write-back-changed',
  'action-removed',
  'action-changed',
  'local-identity-collision',
  'instance-calculation-collision',
])

const outcome = z.enum(['retain-local', 'map', 'defer'])

const conflictId = z
  .string()
  .regex(/^[a-z-]+:[0-9a-f]{8}-[0-9a-f-]{27,}$/)
  .max(96)

const versionRef = z.strictObject({
  definitionId: uuid,
  versionId: uuid,
  version: z.number().int().positive(),
})

export const sheetDefinitionUpgradePreviewSchema = z.strictObject({
  source: versionRef
    .extend({
      instanceId: uuid,
      instanceRevision: z.number().int().positive(),
    })
    .strict(),
  target: versionRef,
  automaticChanges: z
    .array(z.strictObject({ kind: automaticKind, objectId: uuid }))
    .max(512),
  conflicts: z
    .array(
      z.strictObject({
        id: conflictId,
        kind: conflictKind,
        sourceId: uuid.nullable(),
        targetCandidates: z.array(uuid).max(256),
        allowedOutcomes: z.array(outcome).min(1).max(3),
        instanceReferences: z.strictObject({
          localField: z.boolean(),
          localValueCount: z.number().int().min(0).max(10_000),
          calculationIds: z.array(uuid).max(128),
          calculationOverride: z.boolean(),
          presentation: z.boolean(),
        }),
      }),
    )
    .max(512),
  preserved: z.strictObject({
    localFieldIds: z.array(uuid).max(256),
    localValueRowCount: z.number().int().min(0).max(10_000),
    instanceCalculationIds: z.array(uuid).max(128),
    calculationOverrideIds: z.array(uuid).max(128),
    presentationOwnedByInstance: z.literal(true),
    bindingProvenanceRevalidated: z.literal(true),
    writeOwnershipFromTarget: z.literal(true),
  }),
})

export const sheetDefinitionUpgradeDecisionSchema = z.discriminatedUnion(
  'outcome',
  [
    z.strictObject({ conflictId, outcome: z.literal('retain-local') }),
    z.strictObject({ conflictId, outcome: z.literal('map'), targetId: uuid }),
    z.strictObject({ conflictId, outcome: z.literal('defer') }),
  ],
)

export const sheetDefinitionUpgradeDecisionsSchema = z
  .array(sheetDefinitionUpgradeDecisionSchema)
  .max(512)
  .refine(
    (items) =>
      new Set(items.map((item) => item.conflictId)).size === items.length,
    'Each upgrade conflict must have at most one decision.',
  )

export type SheetDefinitionUpgradePreview = z.infer<
  typeof sheetDefinitionUpgradePreviewSchema
>

export type SheetDefinitionUpgradeDecision = z.infer<
  typeof sheetDefinitionUpgradeDecisionSchema
>

export function parseSheetDefinitionUpgradePreview(value: unknown) {
  return sheetDefinitionUpgradePreviewSchema.parse(value)
}

export function parseSheetDefinitionUpgradeDecisions(value: unknown) {
  return sheetDefinitionUpgradeDecisionsSchema.parse(value)
}
