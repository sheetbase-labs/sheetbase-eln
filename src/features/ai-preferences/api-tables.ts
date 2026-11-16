import type { LabTable } from '#/lib/lab-api-surface'

/**
 * Tokens read the lab's preferences and, for a personal token, the person's
 * own. Another person's personal preferences never show.
 */
export const AI_PREFERENCE_LAB_TABLES = {
  ai_preferences: {
    summary:
      'What the assistant remembers about how the lab works: short notes the people confirmed. `scope` is `workspace` (the whole lab, set by an admin) or `user` (yours alone). Change them with `save_ai_preference`, `update_ai_preference` and `delete_ai_preference`.',
    columns: [
      ['id', 'uuid', 1],
      ['workspace_id', 'uuid', 1],
      ['scope', 'text', 1],
      ['user_id', 'text', 0],
      ['topic', 'text', 1],
      ['body', 'text', 1],
      ['created_by_user_id', 'text', 0],
      ['created_at', 'ts', 1],
      ['updated_at', 'ts', 1],
    ],
  },
} as const satisfies Record<string, LabTable>
