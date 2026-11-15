/**
 * The Agent page's saved conversations, readable with a personal token
 * (`lab:read`). They hold one person's own chats, so a service credential,
 * which has no person, reads none.
 */
import type { LabTable } from '#/lib/lab-api-surface'

export const ASSISTANT_CONVERSATION_LAB_TABLES = {
  assistant_conversations: {
    summary:
      'Your conversations with the assistant on the Agent page: a title and the messages, newest change first. Only you can read them. Save, rename and delete with `save_assistant_conversation`, `rename_assistant_conversation` and `delete_assistant_conversation`.',
    personal: true,
    columns: [
      ['id', 'uuid', 0],
      ['workspace_id', 'uuid', 1],
      ['user_id', 'text', 1],
      ['title', 'text', 1],
      ['messages', 'json', 0],
      ['created_at', 'ts', 0],
      ['updated_at', 'ts', 1],
    ],
  },
} as const satisfies Readonly<Record<string, LabTable>>
