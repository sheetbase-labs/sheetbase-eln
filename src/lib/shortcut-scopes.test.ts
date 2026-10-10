import { describe, expect, it, vi } from 'vitest'

import {
  listShortcuts,
  notebookShortcuts,
  reviewShortcuts,
} from './shortcut-scopes'
import type { ShortcutDefinition } from './shortcuts'

function event(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent
}

function byId(definitions: ShortcutDefinition[], id: string) {
  const found = definitions.find((d) => d.id === id)
  if (!found) throw new Error(`missing definition ${id}`)
  return found
}

describe('listShortcuts (SHELL-03.3)', () => {
  const handlers = {
    moveUp: vi.fn(),
    moveDown: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    open: vi.fn(),
    select: vi.fn(),
    addToSelection: vi.fn(),
    filter: vi.fn(),
  }

  it('transcribes the design’s Lists rows', () => {
    const definitions = listShortcuts(handlers)
    expect(definitions.map((d) => d.description)).toEqual([
      'Move between rows',
      'Next and previous item',
      'Open',
      'Select',
      'Add to selection',
      'Filter this list',
    ])
    expect(definitions.map((d) => d.keys)).toEqual([
      ['arrowup', 'arrowdown'],
      ['j', 'k'],
      ['enter'],
      ['space'],
      ['x'],
      ['/'],
    ])
    expect(definitions.every((d) => d.scope === 'list')).toBe(true)
  })

  it('dispatches a two-direction row by key', () => {
    const definitions = listShortcuts(handlers)
    byId(definitions, 'list-move').handler?.(event('ArrowUp'))
    byId(definitions, 'list-move').handler?.(event('ArrowDown'))
    byId(definitions, 'list-next-previous').handler?.(event('j'))
    byId(definitions, 'list-next-previous').handler?.(event('k'))
    expect(handlers.moveUp).toHaveBeenCalledOnce()
    expect(handlers.moveDown).toHaveBeenCalledOnce()
    expect(handlers.next).toHaveBeenCalledOnce()
    expect(handlers.previous).toHaveBeenCalledOnce()
  })

  it('omits a row the screen cannot honour', () => {
    const definitions = listShortcuts({ next: vi.fn(), previous: vi.fn() })
    expect(definitions.map((d) => d.id)).toEqual(['list-next-previous'])
  })
})

describe('notebookShortcuts (SHELL-03.3)', () => {
  const handlers = {
    insertBlock: vi.fn(),
    editCell: vi.fn(),
    cancelEdit: vi.fn(),
    nextCell: vi.fn(),
    saveRow: vi.fn(),
    commentSelection: vi.fn(),
  }

  it('transcribes the design’s Notebook and sheets rows', () => {
    const definitions = notebookShortcuts(handlers)
    expect(definitions.map((d) => d.description)).toEqual([
      'Insert a block',
      'Edit the cell',
      'Cancel the edit',
      'Next cell',
      'Save the row',
      'Comment on selection',
    ])
    expect(definitions.map((d) => d.keys)).toEqual([
      ['/'],
      ['enter'],
      ['escape'],
      ['tab'],
      ['mod+enter'],
      ['alt+mod+m'],
    ])
    expect(definitions.every((d) => d.scope === 'notebook')).toBe(true)
  })

  it('allows Esc inside a field so an edit can be abandoned', () => {
    const definitions = notebookShortcuts(handlers)
    expect(byId(definitions, 'notebook-cancel-edit').allowInInput).toBe(true)
    expect(byId(definitions, 'notebook-insert-block').allowInInput).toBeFalsy()
  })

  it('prevents the browser default for the row-save binding', () => {
    const e = event('Enter')
    byId(notebookShortcuts(handlers), 'notebook-save-row').handler?.(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(handlers.saveRow).toHaveBeenCalledOnce()
  })
})

describe('reviewShortcuts (SHELL-03.3)', () => {
  const handlers = {
    nextChange: vi.fn(),
    previousChange: vi.fn(),
    reply: vi.fn(),
    approveAndSign: vi.fn(),
  }

  it('transcribes the design’s Review rows', () => {
    const definitions = reviewShortcuts(handlers)
    expect(definitions.map((d) => d.description)).toEqual([
      'Next and previous change',
      'Reply to comment',
      'Approve and sign…',
    ])
    expect(definitions.map((d) => d.keys)).toEqual([
      ['n', 'p'],
      ['r'],
      ['mod+shift+enter'],
    ])
    expect(definitions.every((d) => d.scope === 'review')).toBe(true)
  })

  it('dispatches the change row by key', () => {
    const definitions = reviewShortcuts(handlers)
    byId(definitions, 'review-next-previous-change').handler?.(event('n'))
    byId(definitions, 'review-next-previous-change').handler?.(event('p'))
    expect(handlers.nextChange).toHaveBeenCalledOnce()
    expect(handlers.previousChange).toHaveBeenCalledOnce()
  })
})
