/**
 * The sets of changes the assistant made, readable with a personal token
 * (`lab:read`). They are one person's own, so a service credential, which has
 * no person, reads none.
 */
import type { LabTable } from '#/lib/lab-api-surface'

export const AI_UNDO_LAB_TABLES = {
  ai_change_sets: {
    summary:
      'What the assistant changed for you, one row per card or plan you approved, newest first, with its `status` (`applied` or `undone`). Only you can read them. See what undoing one would do with `preview_ai_undo`, and do it with `undo_ai_change_set`.',
    personal: true,
    columns: [
      ['id', 'uuid', 0],
      ['workspace_id', 'uuid', 1],
      ['user_id', 'text', 1],
      ['title', 'text', 1],
      ['kind', 'text', 1],
      ['status', 'text', 1],
      ['created_at', 'ts', 1],
      ['undone_at', 'ts', 1],
    ],
  },
} as const satisfies Readonly<Record<string, LabTable>>
