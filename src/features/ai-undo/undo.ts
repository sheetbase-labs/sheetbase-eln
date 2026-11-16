import { z } from 'zod'

/**
 * Undo for what the assistant changed.
 *
 * A change set remembers the stretch of the audit trail that one assistant
 * card, or one multi-step plan, wrote as the person who approved it. The
 * preview says what undoing would do and what stops it; the undo does it as
 * that person, all or nothing, so nothing is half put back.
 *
 * What can be taken back: records and projects the set made (archived),
 * bookings (cancelled), notebook blocks it added to older records (removed) and
 * the fields it edited on an older record (put back). Anything signed, locked,
 * submitted for review, changed afterwards by anyone, or of a kind that cannot
 * be taken back stops the whole undo.
 */

export const CHANGES_RECENT_TOOL = 'sheetbase.changes.recent'
export const CHANGES_UNDO_TOOL = 'sheetbase.changes.undo'

export const CHANGES_READ_TOOL_NAMES = [CHANGES_RECENT_TOOL] as const
export const CHANGES_PROPOSE_TOOL_NAMES = [CHANGES_UNDO_TOOL] as const

export type ChangesProposeToolName = (typeof CHANGES_PROPOSE_TOOL_NAMES)[number]

/**
 * Card tools whose changes the audit trail carries in full, so what they did
 * can be read back and undone. A step with any other tool is listed in the
 * preview as something that stays, which stops the undo.
 */
const UNDOABLE_TOOLS: ReadonlySet<string> = new Set([
  'sheetbase.planner.plan_experiment',
  'sheetbase.project.create',
  'sheetbase.booking.create',
  'sheetbase.record.assign',
  'sheetbase.record.custom_fields.update',
  'sheetbase.record.create',
  'sheetbase.sample.log',
  'sheetbase.notebook.insert',
  'sheetbase.notebook_block.insert',
])

export function isUndoableTool(tool: string): boolean {
  return UNDOABLE_TOOLS.has(tool)
}

export const previewItemSchema = z.object({
  key: z.string(),
  kind: z.enum(['record', 'project', 'booking', 'block', 'fields', 'other']),
  action: z.string(),
  verb: z.string(),
  label: z.string(),
  href: z.string().nullable().optional(),
  state: z.enum(['ok', 'already', 'blocked']),
  reason: z.string().nullable().optional(),
  recordKind: z.string().optional(),
  changes: z
    .array(
      z.object({
        field: z.string(),
        from: z.string().nullable().optional(),
        to: z.string().nullable().optional(),
      }),
    )
    .optional(),
})

export const undoPreviewSchema = z.object({
  setId: z.string().uuid(),
  title: z.string(),
  kind: z.enum(['card', 'plan']),
  status: z.enum(['open', 'applied', 'undone']),
  canUndo: z.boolean(),
  items: z.array(previewItemSchema),
  blocked: z.number().int(),
  toUndo: z.number().int(),
})

export type UndoPreview = z.infer<typeof undoPreviewSchema>

export type UndoPreviewItem = z.infer<typeof previewItemSchema>

export const undoResultSchema = z.object({
  done: z.boolean(),
  undone: z.number().int().optional(),
  preview: undoPreviewSchema,
})

export type UndoResult = z.infer<typeof undoResultSchema>

export const setRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  kind: z.enum(['card', 'plan']),
  status: z.enum(['open', 'applied', 'undone']),
  created_at: z.string(),
  undone_at: z.string().nullable().optional(),
})

export type ChangeSetRow = z.infer<typeof setRowSchema>

export const proposeUndoSchema = z.strictObject({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
  changeSetId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'The set of changes to undo, from sheetbase.changes.recent. Leave it out to undo the latest one that can still be undone.',
    ),
})

export const recentChangesSchema = z.strictObject({
  limit: z.number().int().min(1).max(20).optional(),
})

export type UndoAction = {
  kind: 'changes.undo'
  workspaceId: string
  changeSetId: string
}

const KINDS: readonly string[] = ['changes.undo']

export function isUndoAction(action: { kind: string }): action is UndoAction {
  return KINDS.includes(action.kind)
}

/** The sentence a refusal gives, so the card and the assistant say it alike. */
export function blockedWords(preview: UndoPreview): string[] {
  return preview.items
    .filter((item) => item.state === 'blocked')
    .map((item) =>
      item.reason ? `${item.label}: ${item.reason}` : `${item.label}.`,
    )
}
