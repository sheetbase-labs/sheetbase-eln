/**
 * Saved conversations on the Agent page as operations: one declaration each
 * gives the token API entry, the MCP action and the Python SDK method. The
 * assistant gets no card for them: they are the page's own saving, and the
 * conversations are private to the person.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const DOCS = 'assistant-conversations-api.md'

const note = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
  nullable = false,
): OperationInput => ({ ...input(name, type, required, nullable), description })

export const ASSISTANT_CONVERSATION_OPERATIONS = defineOperations([
  {
    name: 'save_assistant_conversation',
    label: 'Save a conversation with the assistant',
    summary: 'Save a conversation with the assistant',
    description:
      'Starts a conversation, or replaces the messages of one of your own when you pass its id. The title is kept unless you pass one. Needs a personal token. Returns the conversation. Sends `assistant.conversation.created` for a new one.',
    kind: 'write',
    inputs: [
      note('p_messages', 'json', 'The messages, as a JSON array.'),
      note(
        'p_conversation_id',
        'uuid',
        'Your conversation to update; a new id starts one.',
        false,
        true,
      ),
      note('p_title', 'text', 'The title (200 characters).', false, true),
    ],
    result: 'row:assistant_conversations',
    docsPage: DOCS,
  },
  {
    name: 'rename_assistant_conversation',
    label: 'Rename a conversation with the assistant',
    summary: 'Rename a conversation with the assistant',
    description:
      'Gives one of your conversations a new title. Needs a personal token. Returns the conversation.',
    kind: 'write',
    inputs: [
      note('p_conversation_id', 'uuid', 'Your conversation.'),
      note('p_title', 'text', 'The new title (200 characters).'),
    ],
    result: 'row:assistant_conversations',
    docsPage: DOCS,
  },
  {
    name: 'delete_assistant_conversation',
    label: 'Delete a conversation with the assistant',
    summary: 'Delete a conversation with the assistant',
    description:
      'Deletes one of your conversations for good. Needs a personal token. Sends `assistant.conversation.deleted`.',
    kind: 'write',
    inputs: [note('p_conversation_id', 'uuid', 'Your conversation.')],
    result: 'void',
    docsPage: DOCS,
  },
])
