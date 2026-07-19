/**
 * BlockEditor component tests (ELN-005). Covers read/edit behaviour for the
 * four editable block types, payload validation preventing mutation, the
 * server-error surface, and read-only mode.
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

describe('BlockEditor — heading', () => {
  it('renders the existing text and level', () => {
    const { container } = render(
      <BlockEditor
        block={block({
          type: 'heading',
          payload: { level: 3, text: 'Methods' },
        })}
        onSave={vi.fn()}
      />,
    )
    expect(screen.getByDisplayValue('Methods')).toBeTruthy()
    const select = container.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('3')
  })

  it('saves on blur when the payload is valid', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <BlockEditor
        block={block({
          type: 'heading',
          payload: { level: 2, text: 'Methods' },
        })}
        onSave={onSave}
      />,
    )
    const input = screen.getByDisplayValue('Methods')
    await user.clear(input)
    await user.type(input, 'Results')
    await user.tab()
    expect(onSave).toHaveBeenCalledWith({ level: 2, text: 'Results' })
  })

  it('does not call onSave when the text is blank', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <BlockEditor
        block={block({
          type: 'heading',
          payload: { level: 2, text: 'Methods' },
        })}
        onSave={onSave}
      />,
    )
    const input = screen.getByDisplayValue('Methods')
    await user.clear(input)
    await user.tab()
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('BlockEditor — rich_text', () => {
  it('saves a valid body on blur', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <BlockEditor
        block={block({ type: 'rich_text', payload: { body: 'old' } })}
        onSave={onSave}
      />,
    )
    const textarea = screen.getByDisplayValue('old')
    await user.clear(textarea)
    await user.type(textarea, 'new body')
    await user.tab()
    expect(onSave).toHaveBeenCalledWith({ body: 'new body' })
  })
})

describe('BlockEditor — checklist', () => {
  it('renders existing items and toggles a checkbox into a save', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
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
        onSave={onSave}
      />,
    )
    const checkbox = screen.getAllByRole('checkbox')[0]
    await user.click(checkbox)
    await user.tab()
    expect(onSave).toHaveBeenCalled()
    const saved = onSave.mock.calls[0][0] as {
      items: Array<{ checked: boolean }>
    }
    expect(saved.items[0].checked).toBe(true)
  })

  it('adds a new item through the Add item button', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <BlockEditor
        block={block({
          type: 'checklist',
          payload: { items: [{ text: 'only', checked: false }] },
        })}
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Add item/ }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })
})

describe('BlockEditor — linked_record', () => {
  it('saves a complete linked-record payload via the Save button', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
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
        onSave={onSave}
      />,
    )
    const idInput = screen.getByPlaceholderText('EXP-2025-0001')
    await user.type(idInput, 'EXP-2025-0042')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({
      targetKind: 'experiment',
      targetIdentifier: 'EXP-2025-0042',
      linkType: 'general',
      label: '',
    })
  })

  it('does not save when the identifier is blank', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
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
        onSave={onSave}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('BlockEditor — unsupported type', () => {
  it('renders a readable placeholder and never calls onSave', () => {
    const onSave = vi.fn()
    render(
      <BlockEditor
        block={block({
          type: 'chart',
          payload: { title: 'X', spec: '{}' },
        })}
        onSave={onSave}
      />,
    )
    expect(screen.getByText(/not editable here/)).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
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
        onSave={vi.fn()}
        readOnly
      />,
    )
    expect(screen.getByText('Locked')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('BlockEditor — server error surface', () => {
  it('renders the server error message', () => {
    render(
      <BlockEditor
        block={block({
          type: 'heading',
          payload: { level: 2, text: 'Hi' },
        })}
        onSave={vi.fn()}
        serverError="This notebook was edited elsewhere."
      />,
    )
    expect(screen.getByText('This notebook was edited elsewhere.')).toBeTruthy()
  })
})
