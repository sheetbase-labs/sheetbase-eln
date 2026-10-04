import type { ShortcutDefinition } from './shortcuts'

/** The supported catalogue. Routes attach handlers only in applicable states. */
export const SCOPED_SHORTCUTS: ShortcutDefinition[] = [
  {
    id: 'list-move',
    scope: 'list',
    keys: ['arrowup', 'arrowdown'],
    description: 'Move between rows',
  },
  {
    id: 'list-next-previous',
    scope: 'list',
    keys: ['j', 'k'],
    description: 'Next and previous item',
  },
  { id: 'list-open', scope: 'list', keys: ['enter'], description: 'Open' },
  { id: 'list-select', scope: 'list', keys: ['space'], description: 'Select' },
  {
    id: 'list-add-to-selection',
    scope: 'list',
    keys: ['x'],
    description: 'Add to selection',
  },
  {
    id: 'list-filter',
    scope: 'list',
    keys: ['/'],
    description: 'Filter this list',
  },
  {
    id: 'notebook-insert-block',
    scope: 'notebook',
    keys: ['/'],
    description: 'Insert a block',
  },
  {
    id: 'notebook-edit-cell',
    scope: 'notebook',
    keys: ['enter'],
    description: 'Edit the cell',
  },
  {
    id: 'notebook-cancel-edit',
    scope: 'notebook',
    keys: ['escape'],
    description: 'Cancel the edit',
    allowInInput: true,
  },
  {
    id: 'notebook-next-cell',
    scope: 'notebook',
    keys: ['tab'],
    description: 'Next cell',
  },
  {
    id: 'notebook-save-row',
    scope: 'notebook',
    keys: ['mod+enter'],
    description: 'Save the row',
    allowInInput: true,
  },
  {
    id: 'notebook-comment-selection',
    scope: 'notebook',
    keys: ['alt+mod+m'],
    description: 'Comment on selection',
  },
  {
    id: 'review-next-previous-change',
    scope: 'review',
    keys: ['n', 'p'],
    description: 'Next and previous change',
  },
  {
    id: 'review-reply',
    scope: 'review',
    keys: ['r'],
    description: 'Reply to comment',
  },
  {
    id: 'review-approve-and-sign',
    scope: 'review',
    keys: ['mod+shift+enter'],
    description: 'Approve and sign…',
  },
]

function attachHandlers(
  handlers: Record<string, ShortcutDefinition['handler']>,
): ShortcutDefinition[] {
  return SCOPED_SHORTCUTS.flatMap((definition) => {
    const handler = handlers[definition.id]
    return handler ? [{ ...definition, handler }] : []
  })
}

export interface ListShortcutHandlers {
  moveUp?: () => void
  moveDown?: () => void
  next?: () => void
  previous?: () => void
  open?: () => void
  select?: () => void
  addToSelection?: () => void
  filter?: () => void
}

export function listShortcuts(
  handlers: ListShortcutHandlers,
): ShortcutDefinition[] {
  return attachHandlers({
    'list-move':
      handlers.moveUp && handlers.moveDown
        ? (event) =>
            event.key.toLowerCase() === 'arrowup'
              ? handlers.moveUp?.()
              : handlers.moveDown?.()
        : undefined,
    'list-next-previous':
      handlers.next && handlers.previous
        ? (event) =>
            event.key.toLowerCase() === 'j'
              ? handlers.next?.()
              : handlers.previous?.()
        : undefined,
    'list-open': handlers.open,
    'list-select': handlers.select,
    'list-add-to-selection': handlers.addToSelection,
    'list-filter': handlers.filter,
  })
}

export interface NotebookShortcutHandlers {
  insertBlock?: () => void
  editCell?: () => void
  cancelEdit?: () => void
  nextCell?: () => void
  saveRow?: () => void
  commentSelection?: () => void
}

export function notebookShortcuts(
  handlers: NotebookShortcutHandlers,
): ShortcutDefinition[] {
  return attachHandlers({
    'notebook-insert-block': handlers.insertBlock,
    'notebook-edit-cell': handlers.editCell,
    'notebook-cancel-edit': handlers.cancelEdit,
    'notebook-next-cell': handlers.nextCell,
    'notebook-save-row': handlers.saveRow
      ? (event) => {
          event.preventDefault()
          handlers.saveRow?.()
        }
      : undefined,
    'notebook-comment-selection': handlers.commentSelection,
  })
}

export interface ReviewShortcutHandlers {
  nextChange?: () => void
  previousChange?: () => void
  reply?: () => void
  approveAndSign?: () => void
}

export function reviewShortcuts(
  handlers: ReviewShortcutHandlers,
): ShortcutDefinition[] {
  return attachHandlers({
    'review-next-previous-change':
      handlers.nextChange && handlers.previousChange
        ? (event) =>
            event.key.toLowerCase() === 'n'
              ? handlers.nextChange?.()
              : handlers.previousChange?.()
        : undefined,
    'review-reply': handlers.reply,
    'review-approve-and-sign': handlers.approveAndSign,
  })
}
