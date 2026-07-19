/**
 * BlockEditor component tests (ELN-005 / ELN-007). Covers read/edit
 * behaviour for the four editable block types, payload validation
 * preventing mutation, the failed-save and conflict surfaces, and
 * read-only mode.
 *
 * ELN-007 — the editor now drives an autosave state machine. `save`
 * returns a structured SaveResult; blur flushes the debounce immediately.
 * The default 800 ms debounce is too slow for tests, so we drive saves
 * through blur (tab) which calls `flush()` synchronously.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlockEditor } from './block-editor'
import type { NotebookBlock } from '#/lib/notebook-data'

afterEach(() => cleanup())

function block(
  overrides: Partial<NotebookBlock> & { type: NotebookBlock['type'] },
): NotebookBlock {
  return {
    id: 'b1',
    recordId: 'r1',
    payload: {},
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
    ...overrides,
  }
}

const okSave = vi.fn(async () => ({ ok: true }))

describe('BlockEditor — heading', () => {
  it('renders the existing text and level', () => {
    const { container } = render(
      <BlockEditor
        block={block({
          type: 'heading',
          payload: { level: 3, text: 'Methods' },
        })}
        save={okSave}
      />,
    )
    expect(screen.getByDisplayValue('Methods')).toBeTruthy()
    const select = container.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('3')
  })

  it('saves on blur when the payload is valid', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    render(
      <BlockEditor
        block={block({
          type: 'heading',
          payload: { level: 2, text: 'Methods' },
        })}
        save={save}
      />,
    )
    const input = screen.getByDisplayValue('Methods')
    await user.clear(input)
    await user.type(input, 'Results')
    await user.tab()
    expect(save).toHaveBeenCalledWith({ level: 2, text: 'Results' })
  })

  it('does not call save when the text is blank', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    render(
      <BlockEditor
        block={block({
          type: 'heading',
          payload: { level: 2, text: 'Methods' },
        })}
        save={save}
      />,
    )
    const input = screen.getByDisplayValue('Methods')
    await user.clear(input)
    await user.tab()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('BlockEditor — rich_text', () => {
  it('saves a valid body on blur', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    render(
      <BlockEditor
        block={block({ type: 'rich_text', payload: { body: 'old' } })}
        save={save}
      />,
    )
    const textarea = screen.getByDisplayValue('old')
    await user.clear(textarea)
    await user.type(textarea, 'new body')
    await user.tab()
    expect(save).toHaveBeenCalledWith({ body: 'new body' })
  })
})

describe('BlockEditor — checklist', () => {
  it('renders existing items and toggles a checkbox into a save', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async (_payload: Record<string, unknown>) => ({
      ok: true,
    }))
    render(
      <BlockEditor
        block={block({
          type: 'checklist',
          payload: {
            items: [
              { text: 'step one', checked: false },
              { text: 'step two', checked: true },
            ],
          },
        })}
        save={save}
      />,
    )
    const checkbox = screen.getAllByRole('checkbox')[0]
    await user.click(checkbox)
    // Tab from the checkbox to the item's text input, then tab again to
    // blur it — the text input's `onBlur` flushes the autosave.
    await user.tab()
    await user.tab()
    expect(save).toHaveBeenCalled()
    const saved = save.mock.calls[0][0] as {
      items: Array<{ checked: boolean }>
    }
    expect(saved.items[0].checked).toBe(true)
  })

  it('adds a new item through the Add item button', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    render(
      <BlockEditor
        block={block({
          type: 'checklist',
          payload: { items: [{ text: 'only', checked: false }] },
        })}
        save={save}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Add item/ }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })
})

describe('BlockEditor — linked_record', () => {
  it('saves a complete linked-record payload on blur', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    render(
      <BlockEditor
        block={block({
          type: 'linked_record',
          payload: {
            targetKind: 'experiment',
            targetIdentifier: '',
            linkType: 'general',
            label: '',
          },
        })}
        save={save}
      />,
    )
    const idInput = screen.getByPlaceholderText('EXP-2025-0001')
    await user.type(idInput, 'EXP-2025-0042')
    await user.tab()
    expect(save).toHaveBeenCalledWith({
      targetKind: 'experiment',
      targetIdentifier: 'EXP-2025-0042',
      linkType: 'general',
      label: '',
    })
  })

  it('does not save when the identifier is blank', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    render(
      <BlockEditor
        block={block({
          type: 'linked_record',
          payload: {
            targetKind: 'experiment',
            targetIdentifier: '',
            linkType: 'general',
            label: '',
          },
        })}
        save={save}
      />,
    )
    // The initial draft already has a blank identifier; blur without
    // typing. Validation should reject it and never call save.
    await user.tab()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('BlockEditor — unsupported type', () => {
  it('renders a readable placeholder and never calls save', () => {
    const save = vi.fn(async () => ({ ok: true }))
    render(
      <BlockEditor
        block={block({
          type: 'chart',
          payload: { title: 'X', spec: '{}' },
        })}
        save={save}
      />,
    )
    expect(screen.getByText(/not editable here/)).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('BlockEditor — read-only mode', () => {
  it('renders heading text without inputs', () => {
    render(
      <BlockEditor
        block={block({
          type: 'heading',
          payload: { level: 2, text: 'Locked' },
        })}
        save={okSave}
        readOnly
      />,
    )
    expect(screen.getByText('Locked')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('BlockEditor — failed save surface', () => {
  it('renders the failure message when save returns a validation error', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({
      ok: false,
      kind: 'validation' as const,
      message: 'This notebook was edited elsewhere.',
    }))
    render(
      <BlockEditor
        block={block({
          type: 'heading',
          payload: { level: 2, text: 'Hi' },
        })}
        save={save}
      />,
    )
    const input = screen.getByDisplayValue('Hi')
    await user.clear(input)
    await user.type(input, 'X')
    await user.tab()
    // The save returns a permanent validation failure; the footer should
    // surface the message truthfully.
    expect(await screen.findByText(/edited elsewhere/)).toBeTruthy()
  })
})

describe('BlockEditor — conflict surface', () => {
  it('renders the conflict banner with a server preview', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({
      ok: false,
      kind: 'conflict' as const,
      message: 'This block was changed elsewhere.',
      serverValue: { level: 2, text: 'server version' },
    }))
    render(
      <BlockEditor
        block={block({
          type: 'heading',
          payload: { level: 2, text: 'Hi' },
        })}
        save={save}
      />,
    )
    const input = screen.getByDisplayValue('Hi')
    await user.clear(input)
    await user.type(input, 'my edit')
    await user.tab()
    // The conflict banner renders distinctive resolution buttons.
    expect(
      await screen.findByRole('button', { name: /Use server version/ }),
    ).toBeTruthy()
    // The server preview should be comprehensible — the banner shows a
    // formatted preview of the server value (H2 — server version).
    expect(screen.getByText('H2 — server version')).toBeTruthy()
  })
})
