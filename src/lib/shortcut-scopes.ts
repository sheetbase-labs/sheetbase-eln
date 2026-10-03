import type { ShortcutDefinition } from './shortcuts'

/**
 * SHELL-03.3 — the `list`, `notebook` and `review` scopes, transcribed
 * one-to-one from `canvas/Shortcuts.dc.html`.
 *
 * Each builder takes the screen's real handlers and returns the bindings that
 * screen can actually honour: a row with no handler is omitted rather than
 * registered as a no-op, so the generated help dialog never advertises a
 * shortcut that does nothing. `global` lives in `global-shortcuts.ts`.
 *
 * A design row whose keys are two directions of one action (↑ ↓, J K, N P)
 * is a single definition whose handler reads `event.key`.
 */

/** Lists — Inbox, dataset rows, samples, and any recorded table. */
export interface ListShortcutHandlers {
  /** ↑ */
  moveUp?: () => void
  /** ↓ */
  moveDown?: () => void
  /** J */
  next?: () => void
  /** K */
  previous?: () => void
  /** ↵ */
  open?: () => void
  /** Space */
  select?: () => void
  /** X */
  addToSelection?: () => void
  /** / */
  filter?: () => void
}

export function listShortcuts(
  handlers: ListShortcutHandlers,
): ShortcutDefinition[] {
  const definitions: ShortcutDefinition[] = []

  if (handlers.moveUp || handlers.moveDown) {
    definitions.push({
      id: 'list-move',
      scope: 'list',
      keys: ['arrowup', 'arrowdown'],
      description: 'Move between rows',
      handler: (event) =>
        event.key.toLowerCase() === 'arrowup'
          ? handlers.moveUp?.()
          : handlers.moveDown?.(),
    })
  }
  if (handlers.next || handlers.previous) {
    definitions.push({
      id: 'list-next-previous',
      scope: 'list',
      keys: ['j', 'k'],
      description: 'Next and previous item',
      handler: (event) =>
        event.key.toLowerCase() === 'j'
          ? handlers.next?.()
          : handlers.previous?.(),
    })
  }
  if (handlers.open) {
    definitions.push({
      id: 'list-open',
      scope: 'list',
      keys: ['enter'],
      description: 'Open',
      handler: () => handlers.open?.(),
    })
  }
  if (handlers.select) {
    definitions.push({
      id: 'list-select',
      scope: 'list',
      keys: ['space'],
      description: 'Select',
      handler: () => handlers.select?.(),
    })
  }
  if (handlers.addToSelection) {
    definitions.push({
      id: 'list-add-to-selection',
      scope: 'list',
      keys: ['x'],
      description: 'Add to selection',
      handler: () => handlers.addToSelection?.(),
    })
  }
  if (handlers.filter) {
    definitions.push({
      id: 'list-filter',
      scope: 'list',
      keys: ['/'],
      description: 'Filter this list',
      handler: () => handlers.filter?.(),
    })
  }
  return definitions
}

/** Notebook and sheets — the block document and the sheet grid. */
export interface NotebookShortcutHandlers {
  /** / */
  insertBlock?: () => void
  /** ↵ */
  editCell?: () => void
  /** Esc */
  cancelEdit?: () => void
  /** Tab */
  nextCell?: () => void
  /** ⌘↵ */
  saveRow?: () => void
  /** ⌥⌘M */
  commentSelection?: () => void
}

export function notebookShortcuts(
  handlers: NotebookShortcutHandlers,
): ShortcutDefinition[] {
  const definitions: ShortcutDefinition[] = []
  if (handlers.insertBlock) {
    definitions.push({
      id: 'notebook-insert-block',
      scope: 'notebook',
      keys: ['/'],
      description: 'Insert a block',
      handler: () => handlers.insertBlock?.(),
    })
  }
  if (handlers.editCell) {
    definitions.push({
      id: 'notebook-edit-cell',
      scope: 'notebook',
      keys: ['enter'],
      description: 'Edit the cell',
      handler: () => handlers.editCell?.(),
    })
  }
  if (handlers.cancelEdit) {
    definitions.push({
      id: 'notebook-cancel-edit',
      scope: 'notebook',
      keys: ['escape'],
      description: 'Cancel the edit',
      // The design's Esc abandons the edit while the editor still has focus,
      // so it must fire inside a field.
      allowInInput: true,
      handler: () => handlers.cancelEdit?.(),
    })
  }
  if (handlers.nextCell) {
    definitions.push({
      id: 'notebook-next-cell',
      scope: 'notebook',
      keys: ['tab'],
      description: 'Next cell',
      handler: () => handlers.nextCell?.(),
    })
  }
  if (handlers.saveRow) {
    definitions.push({
      id: 'notebook-save-row',
      scope: 'notebook',
      keys: ['mod+enter'],
      description: 'Save the row',
      handler: (event) => {
        event.preventDefault()
        handlers.saveRow?.()
      },
    })
  }
  if (handlers.commentSelection) {
    definitions.push({
      id: 'notebook-comment-selection',
      scope: 'notebook',
      keys: ['alt+mod+m'],
      description: 'Comment on selection',
      handler: () => handlers.commentSelection?.(),
    })
  }
  return definitions
}

/** Review — the revision comparison and its decision actions. */
export interface ReviewShortcutHandlers {
  /** N */
  nextChange?: () => void
  /** P */
  previousChange?: () => void
  /** R */
  reply?: () => void
  /** ⌘⇧↵ */
  approveAndSign?: () => void
}

export function reviewShortcuts(
  handlers: ReviewShortcutHandlers,
): ShortcutDefinition[] {
  const definitions: ShortcutDefinition[] = []
  if (handlers.nextChange || handlers.previousChange) {
    definitions.push({
      id: 'review-next-previous-change',
      scope: 'review',
      keys: ['n', 'p'],
      description: 'Next and previous change',
      handler: (event) =>
        event.key.toLowerCase() === 'n'
          ? handlers.nextChange?.()
          : handlers.previousChange?.(),
    })
  }
  if (handlers.reply) {
    definitions.push({
      id: 'review-reply',
      scope: 'review',
      keys: ['r'],
      description: 'Reply to comment',
      handler: () => handlers.reply?.(),
    })
  }
  if (handlers.approveAndSign) {
    definitions.push({
      id: 'review-approve-and-sign',
      scope: 'review',
      keys: ['mod+shift+enter'],
      description: 'Approve and sign…',
      handler: () => handlers.approveAndSign?.(),
    })
  }
  return definitions
}
