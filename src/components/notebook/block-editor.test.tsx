/**
 * BlockEditor component tests (ELN-005 / ELN-007). Covers read/edit
 * behaviour for the editable block types, payload validation
 * preventing mutation, the failed-save and conflict surfaces, and
 * read-only mode.
 *
 * ELN-007 — the editor now drives an autosave state machine. `save`
 * returns a structured SaveResult; blur flushes the debounce immediately.
 * The default 800 ms debounce is too slow for tests, so we drive saves
 * through blur (tab) which calls `flush()` synchronously.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { BlockEditor } from './block-editor'
import type { NotebookBlock } from '#/lib/notebook-data'
import type { RichTextPayload } from '#/lib/blocks'

beforeAll(() => {
  // ProseMirror asks the browser for caret geometry. jsdom intentionally
  // omits these layout APIs, so provide inert rectangles for interactions.
  document.elementFromPoint = () => null
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

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

function richText(text: string): RichTextPayload {
  return {
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: text ? [{ type: 'text', text }] : undefined,
        },
      ],
    },
  }
}

describe('BlockEditor — rich_text', () => {
  it('saves canonical structured JSON on blur', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    render(
      <BlockEditor
        block={block({ type: 'rich_text', payload: richText('old') })}
        save={save}
      />,
    )
    const editor = await screen.findByRole('textbox', { name: 'Text content' })
    editor.focus()
    await user.keyboard('{Control>}a{/Control}{Backspace}')
    await user.paste('new body')
    await user.tab()
    expect(save).toHaveBeenCalledWith(richText('new body'))
  })

  it('applies inline formatting and exposes the restrained toolbar', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    render(
      <BlockEditor
        block={block({ type: 'rich_text', payload: richText('') })}
        save={save}
      />,
    )
    const editor = await screen.findByRole('textbox', { name: 'Text content' })
    for (const name of [
      'Paragraph',
      'Heading 2',
      'Heading 3',
      'Bold',
      'Italic',
      'Link',
      'Subscript',
      'Superscript',
      'Inline code',
      'Bullet list',
      'Ordered list',
      'Undo',
      'Redo',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    editor.focus()
    await user.paste('result')
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: 'Bold' }))
    await user.tab()
    expect(save).toHaveBeenCalledWith({
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', marks: [{ type: 'bold' }], text: 'result' },
            ],
          },
        ],
      },
    })
  })

  it('selects and persists a restrained section heading', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    render(
      <BlockEditor
        block={block({ type: 'rich_text', payload: richText('Materials') })}
        save={save}
      />,
    )
    const editor = await screen.findByRole('textbox', { name: 'Text content' })
    editor.focus()
    await user.keyboard('{Control>}a{/Control}')
    await user.click(screen.getByRole('button', { name: 'Heading 2' }))
    await user.tab()
    expect(save).toHaveBeenCalledWith({
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Materials' }],
          },
        ],
      },
    })
  })

  it('server-renders stable structured content without starting Tiptap', () => {
    const html = renderToString(
      <BlockEditor
        block={block({ type: 'rich_text', payload: richText('SSR objective') })}
        save={okSave}
      />,
    )
    expect(html).toContain('SSR objective')
    expect(html).not.toContain('contenteditable')
  })

  it('reconciles clean server state without emitting a save loop', async () => {
    const save = vi.fn(async () => ({ ok: true }))
    const { rerender } = render(
      <BlockEditor
        block={block({ type: 'rich_text', payload: richText('first') })}
        save={save}
      />,
    )
    expect(
      (await screen.findByRole('textbox', { name: 'Text content' }))
        .textContent,
    ).toBe('first')

    rerender(
      <BlockEditor
        block={block({
          type: 'rich_text',
          payload: richText('server update'),
          version: 2,
        })}
        save={save}
      />,
    )
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: 'Text content' }).textContent,
      ).toBe('server update'),
    )
    expect(save).not.toHaveBeenCalled()
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
          type: 'unknown_future_type' as unknown as string,
          payload: { title: 'X' },
        })}
        save={save}
      />,
    )
    expect(screen.getByText(/not editable here/)).toBeTruthy()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('BlockEditor — read-only mode', () => {
  it('safely renders headings and formatted text from the structured payload', () => {
    render(
      <BlockEditor
        block={block({
          type: 'rich_text',
          payload: {
            doc: {
              type: 'doc',
              content: [
                {
                  type: 'heading',
                  attrs: { level: 2 },
                  content: [{ type: 'text', text: 'Results' }],
                },
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'assay',
                      marks: [
                        { type: 'bold' },
                        {
                          type: 'link',
                          attrs: { href: 'https://example.test/result' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        })}
        save={okSave}
        readOnly
      />,
    )
    const link = screen.getByRole('link', { name: 'assay' })
    expect(
      screen.getByRole('heading', { level: 2, name: 'Results' }),
    ).toBeTruthy()
    expect(link.getAttribute('href')).toBe('https://example.test/result')
    expect(link.querySelector('strong')).toBeTruthy()
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
          type: 'rich_text',
          payload: richText('Hi'),
        })}
        save={save}
      />,
    )
    const editor = await screen.findByRole('textbox', { name: 'Text content' })
    editor.focus()
    await user.keyboard('{Control>}a{/Control}{Backspace}')
    await user.paste('X')
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
      serverValue: richText('server version'),
    }))
    render(
      <BlockEditor
        block={block({
          type: 'rich_text',
          payload: richText('Hi'),
        })}
        save={save}
      />,
    )
    const editor = await screen.findByRole('textbox', { name: 'Text content' })
    editor.focus()
    await user.keyboard('{Control>}a{/Control}{Backspace}')
    await user.paste('my edit')
    await user.tab()
    // The conflict banner renders distinctive resolution buttons.
    expect(
      await screen.findByRole('button', { name: /Use server version/ }),
    ).toBeTruthy()
    // The server preview should be comprehensible — the banner shows a
    // formatted plain-text preview of the structured server value.
    expect(screen.getByText('server version')).toBeTruthy()
  })

  it('preserves a rich-text draft and adopts structured server content explicitly', async () => {
    const user = userEvent.setup()
    const serverValue = richText('server objective')
    const save = vi.fn(async () => ({
      ok: false,
      kind: 'conflict' as const,
      message: 'This block was changed elsewhere.',
      serverValue,
    }))
    render(
      <BlockEditor
        block={block({
          type: 'rich_text',
          payload: richText('local objective'),
        })}
        save={save}
      />,
    )
    const editor = await screen.findByRole('textbox', { name: 'Text content' })
    editor.focus()
    await user.keyboard('{Control>}a{/Control}{Backspace}')
    await user.paste('my changed objective')
    await user.tab()

    expect(await screen.findByText('server objective')).toBeTruthy()
    expect(editor.textContent).toBe('my changed objective')
    await user.click(screen.getByRole('button', { name: /Use server version/ }))
    await waitFor(() => expect(editor.textContent).toBe('server objective'))
    expect(save).toHaveBeenCalledTimes(1)
  })
})
