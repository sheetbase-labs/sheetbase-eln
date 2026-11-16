/**
 * AI preferences as operations: one declaration each gives the token API
 * entry, the MCP action, the assistant card name, the pipeline action and the
 * webhook event (see `docs/development/adding-an-operation.md`).
 *
 * A lab preference is an admin's choice and only a person in the app may
 * change one; a token or pipeline can keep personal ones.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const note = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
  nullable = false,
): OperationInput => ({ ...input(name, type, required, nullable), description })

const card = (tool: string) => ({
  tool,
  presentation: 'card' as const,
  vocabulary: 'propose' as const,
})

const WHO =
  'A personal preference is yours alone. A lab preference (`workspace`) is for everyone and needs AI settings (manage) and a person in the app: a token or a pipeline is refused.'

export const AI_PREFERENCE_OPERATIONS = defineOperations([
  {
    name: 'save_ai_preference',
    label: 'Remember an AI preference',
    summary: 'Save a preference for the assistant to follow',
    description: `Saves one short note about how things are done, such as "96-well plates: blanks in column 12", which the assistant reads before it plans. Up to 300 characters and 25 per scope. ${WHO} Returns the preference. Sends \`ai.preference.saved\`.`,
    kind: 'write',
    inputs: [
      note('p_body', 'text', 'The preference, in one sentence.'),
      note(
        'p_scope',
        'text',
        '`user` (the default) or `workspace` for the whole lab.',
        false,
      ),
      note(
        'p_topic',
        'text',
        'A short label such as `Plate layout`.',
        false,
        true,
      ),
    ],
    result: 'row:ai_preferences',
    assistant: card('sheetbase.ai_preference.save'),
    pipeline: {},
    docsPage: 'ai-preferences-api.md',
    events: [
      {
        name: 'ai.preference.saved',
        family: 'administration',
        summary: 'A preference was saved for the assistant to follow.',
        producer: { entityType: 'ai_preference', operation: 'create' },
        notes: 'Payload carries `preferenceId`, `scope` and `topic`.',
      },
    ],
  },
  {
    name: 'update_ai_preference',
    label: 'Change an AI preference',
    summary: 'Change a saved preference',
    description: `Rewrites the text and topic of a saved preference. ${WHO} Returns the preference. Sends \`ai.preference.updated\`.`,
    kind: 'write',
    inputs: [
      note('p_preference_id', 'uuid', 'The preference.'),
      note('p_body', 'text', 'The new text, up to 300 characters.'),
      note('p_topic', 'text', 'A short label.', false, true),
    ],
    result: 'row:ai_preferences',
    assistant: card('sheetbase.ai_preference.update'),
    pipeline: {},
    docsPage: 'ai-preferences-api.md',
    events: [
      {
        name: 'ai.preference.updated',
        family: 'administration',
        summary: 'A saved preference was changed.',
        producer: { entityType: 'ai_preference', operation: 'update' },
        notes: 'Payload carries `preferenceId`, `scope` and `topic`.',
      },
    ],
  },
  {
    name: 'delete_ai_preference',
    label: 'Forget an AI preference',
    summary: 'Delete a saved preference',
    description: `Removes a saved preference; the assistant stops following it. ${WHO} Returns the preference that was removed. Sends \`ai.preference.deleted\`.`,
    kind: 'write',
    inputs: [note('p_preference_id', 'uuid', 'The preference.')],
    result: 'row:ai_preferences',
    assistant: card('sheetbase.ai_preference.delete'),
    pipeline: {},
    docsPage: 'ai-preferences-api.md',
    events: [
      {
        name: 'ai.preference.deleted',
        family: 'administration',
        summary: 'A saved preference was removed.',
        producer: { entityType: 'ai_preference', operation: 'delete' },
        notes: 'Payload carries `preferenceId`, `scope` and `topic`.',
      },
    ],
  },
])
