import { z } from 'zod'

import { parameterUuidSchema as uuid } from '#/lib/parameter'
import {
  parseSheetDefinitionUpgradeDecisions,
  parseSheetDefinitionUpgradePreview,
  sheetDefinitionUpgradePreviewSchema,
} from '#/lib/sheet-definition-upgrade'

const notebookConflictId = z.string().min(1).max(96)
const notebookOutcome = z.enum(['keep', 'retarget'])

export const notebookUpgradePreviewSchema = z
  .object({
    recordId: uuid,
    sourceVersionId: uuid,
    targetVersionId: uuid,
    automatic: z
      .array(
        z
          .object({
            kind: z.enum([
              'placement-removed',
              'placement-added',
              'sheet-definition-compatible',
            ]),
            placementId: uuid.optional(),
            instanceId: uuid.optional(),
            targetDefinitionVersionId: uuid.optional(),
            blockId: uuid.optional(),
          })
          .passthrough(),
      )
      .max(512),
    conflicts: z
      .array(
        z
          .object({
            id: notebookConflictId,
            kind: z.enum([
              'sheet-placement-unresolved',
              'sheet-definition-conflict',
            ]),
            placementId: uuid.optional(),
            instanceId: uuid.optional(),
            blockId: uuid.optional(),
            allowedOutcomes: z.array(notebookOutcome).min(1).max(2),
            instancePreview: sheetDefinitionUpgradePreviewSchema.optional(),
          })
          .passthrough(),
      )
      .max(512),
  })
  .strict()

export const notebookUpgradeDecisionSchema = z
  .object({
    conflictId: notebookConflictId,
    outcome: notebookOutcome,
    instanceDecisions: z
      .array(
        z.union([
          z.object({
            conflictId: z.string(),
            outcome: z.literal('retain-local'),
          }),
          z.object({
            conflictId: z.string(),
            outcome: z.literal('map'),
            targetId: uuid,
          }),
          z.object({ conflictId: z.string(), outcome: z.literal('defer') }),
        ]),
      )
      .max(512)
      .optional(),
  })
  .strict()

export const notebookUpgradeDecisionsSchema = z
  .array(notebookUpgradeDecisionSchema)
  .max(512)
  .refine(
    (items) =>
      new Set(items.map((item) => item.conflictId)).size === items.length,
    'Each notebook upgrade conflict must have at most one decision.',
  )

export type NotebookUpgradePreview = z.infer<
  typeof notebookUpgradePreviewSchema
>
export type NotebookUpgradeDecision = z.infer<
  typeof notebookUpgradeDecisionSchema
>

export function parseNotebookTemplateUpgradePreview(value: unknown) {
  return notebookUpgradePreviewSchema.parse(value)
}

export function parseNotebookTemplateUpgradeDecisions(value: unknown) {
  const parsed = notebookUpgradeDecisionsSchema.parse(value)
  for (const decision of parsed) {
    if (decision.instanceDecisions)
      parseSheetDefinitionUpgradeDecisions(decision.instanceDecisions)
  }
  return parsed
}

export type NotebookUpgradeDecisionDraft = {
  outcome?: 'keep' | 'retarget'
  instanceDecisionDrafts?: Record<
    string,
    SheetDefinitionUpgradeDecisionDraft | undefined
  >
  instanceParameterDrafts?: Record<string, string>
}

export function buildNotebookTemplateUpgradeDecisions(
  preview: NotebookUpgradePreview,
  drafts: Partial<Record<string, NotebookUpgradeDecisionDraft>>,
): NotebookUpgradeDecision[] {
  return preview.conflicts.map((conflict) => {
    const draft = drafts[conflict.id]
    if (!draft || !draft.outcome)
      throw new Error(`Choose an outcome for conflict "${conflict.id}".`)
    if (!conflict.allowedOutcomes.includes(draft.outcome))
      throw new Error(
        `Outcome "${draft.outcome}" is not allowed for "${conflict.id}".`,
      )
    if (draft.outcome === 'retarget') {
      if (!conflict.instancePreview)
        throw new Error(
          `Conflict "${conflict.id}" has no nested Sheet preview.`,
        )
      const instanceDecisions = buildSheetDefinitionUpgradeDecisions(
        conflict.instancePreview,
        draft.instanceDecisionDrafts ?? {},
      )
      return {
        conflictId: conflict.id,
        outcome: draft.outcome,
        instanceDecisions,
      }
    }
    return { conflictId: conflict.id, outcome: draft.outcome }
  })
}

export type SheetDefinitionUpgradeDecisionDraft = {
  outcome?: 'retain-local' | 'map' | 'defer'
  targetId?: string
}

export function buildSheetDefinitionUpgradeDecisions(
  preview: z.infer<typeof sheetDefinitionUpgradePreviewSchema>,
  drafts: Partial<Record<string, SheetDefinitionUpgradeDecisionDraft>>,
) {
  const decisions = preview.conflicts.map((conflict) => {
    const draft = drafts[conflict.id]
    if (!draft || !draft.outcome)
      throw new Error(`Choose an outcome for conflict "${conflict.id}".`)
    if (!conflict.allowedOutcomes.includes(draft.outcome))
      throw new Error(
        `Outcome "${draft.outcome}" is not allowed for "${conflict.id}".`,
      )
    if (draft.outcome === 'map') {
      const targetId = draft.targetId?.trim()
      if (!targetId)
        throw new Error(`Choose a target for conflict "${conflict.id}".`)
      if (!conflict.targetCandidates.includes(targetId))
        throw new Error(
          `Target "${targetId}" is not valid for "${conflict.id}".`,
        )
      return { conflictId: conflict.id, outcome: 'map' as const, targetId }
    }
    return { conflictId: conflict.id, outcome: draft.outcome }
  })
  return parseSheetDefinitionUpgradeDecisions(decisions)
}

export function requiredTargetParameterIds(
  preview: z.infer<typeof sheetDefinitionUpgradePreviewSchema>,
): string[] {
  return preview.conflicts
    .filter((conflict) => conflict.kind === 'parameter-required')
    .map((conflict) => conflict.sourceId)
    .filter((id): id is string => Boolean(id))
}

export function parseNotebookTemplateUpgradePreviewFromWire(value: unknown) {
  const parsed = parseNotebookTemplateUpgradePreview(value)
  for (const conflict of parsed.conflicts) {
    if (conflict.instancePreview)
      parseSheetDefinitionUpgradePreview(conflict.instancePreview)
  }
  return parsed
}
