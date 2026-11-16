/**
 * Undo for what the assistant changed: open and close a change set around a
 * card or plan, preview what undoing would do, and undo it. One declaration
 * each gives the token API entry, the MCP action, the SDK methods and the
 * pipeline action.
 *
 * Undo acts as the person the token belongs to, and the database still decides
 * what that person may do. It never touches anything signed, locked or
 * submitted for review, anything someone has changed since, or anything that
 * cannot be taken back, and then it touches nothing at all.
 */
import { defineOperations, input } from '#/lib/operations/descriptor'
import type { OperationInput } from '#/lib/operations/descriptor'

const DOCS = 'ai-undo-api.md'

const note = (
  name: string,
  type: OperationInput['type'],
  description: string,
  required = true,
  nullable = false,
): OperationInput => ({ ...input(name, type, required, nullable), description })

export const AI_UNDO_OPERATIONS = defineOperations([
  {
    name: 'begin_ai_change_set',
    label: 'Start recording what an assistant card changes',
    summary: 'Start a set of changes that can be undone',
    description:
      'Opens a window on the audit trail so what you change next can be undone as one set. Pass `p_set_id` to open another window on a set you already have (a plan that paused and carries on). Needs a personal token. Returns the set.',
    kind: 'write',
    inputs: [
      note(
        'p_title',
        'text',
        'What the set is, in a few words (200 characters).',
      ),
      note('p_kind', 'text', '`card` or `plan`. Defaults to `plan`.', false),
      note('p_set_id', 'uuid', 'A set of yours to carry on.', false, true),
    ],
    result: 'row:ai_change_sets',
    docsPage: DOCS,
  },
  {
    name: 'finish_ai_change_set',
    label: 'Stop recording what an assistant card changes',
    summary: 'Close a set of changes',
    description:
      'Closes the window. A set that changed nothing is dropped and null comes back. `p_untracked` lists steps whose changes the audit trail does not carry, as `[{"title": "…"}]`, so the preview says they stay. Needs a personal token. Returns the set.',
    kind: 'write',
    inputs: [
      note('p_set_id', 'uuid', 'Your set.'),
      note('p_untracked', 'json', 'Steps that cannot be undone.', false),
    ],
    result: 'row:ai_change_sets',
    docsPage: DOCS,
  },
  {
    name: 'preview_ai_undo',
    label: 'Preview undoing what the assistant changed',
    summary: 'Preview undoing a set of changes',
    description:
      'Says what undoing a set would do, item by item, and what stops it. Each item is `ok` (it will be put back), `already` (nothing to do) or `blocked` with a `reason` (signed, locked, submitted, changed by someone else, or a kind that cannot be taken back). `canUndo` is true only when nothing is blocked. Changes nothing. Needs a personal token.',
    kind: 'read',
    inputs: [note('p_set_id', 'uuid', 'Your set.')],
    result: 'json',
    docsPage: DOCS,
  },
  {
    name: 'undo_ai_change_set',
    label: 'Undo what the assistant changed',
    summary: 'Undo a set of changes',
    description:
      'Puts back everything the set changed, all or nothing: records and projects it made are archived, bookings cancelled, blocks it added removed and fields it edited restored. If anything is blocked nothing is touched and `done` is false with the preview. Each thing runs as you, so your permissions apply and each writes its own audit entry. Needs a personal token. Sends `assistant.changes.undone`.',
    kind: 'write',
    inputs: [note('p_set_id', 'uuid', 'Your set.')],
    result: 'json',
    assistant: {
      tool: 'sheetbase.changes.undo',
      presentation: 'card',
      vocabulary: 'propose',
    },
    pipeline: {},
    docsPage: DOCS,
  },
])
