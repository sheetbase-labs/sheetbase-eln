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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { BlockEditor } from './block-editor'
import type * as notebookDataModule from '#/lib/notebook-data'
import type { NotebookBlock } from '#/lib/notebook-data'
import type { RichTextPayload } from '#/lib/blocks'

vi.mock('#/lib/notebook-data', async (importOriginal) => {
  const actual = await importOriginal<typeof notebookDataModule>()
  return {
    ...actual,
    notebookDataClient: {
      ...actual.notebookDataClient,
      list: vi.fn().mockResolvedValue([]),
    },
  }
})

vi.mock('#/lib/dataset-explorer-data', () => ({
  fetchDatasetSummaries: vi.fn().mockResolvedValue([]),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children?: ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

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
    renderWithQuery(
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
    renderWithQuery(
      <BlockEditor
        block={block({ type: 'rich_text', payload: richText('') })}
        save={save}
      />,
    )
    const editor = await screen.findByRole('textbox', { name: 'Text content' })
    editor.focus()
    await user.paste('result')
    await user.keyboard('{Control>}a{/Control}')
    // The floating BubbleMenu toolbar appears when text is selected.
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
    renderWithQuery(
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
    renderWithQuery(
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
    renderWithQuery(
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
    renderWithQuery(
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
    renderWithQuery(
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

  it('lists scientist-facing target kinds including Dataset, sample and reagent', () => {
    renderWithQuery(
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
        save={vi.fn(async () => ({ ok: true }))}
      />,
    )
    const kindSelect = screen.getByLabelText('Target kind')
    expect(
      [...kindSelect.querySelectorAll('option')].map((o) => o.textContent),
    ).toEqual([
      'Experiment',
      'Dataset',
      'Sample',
      'Reagent',
      'Protocol template',
      'Report',
    ])
    expect(
      [...kindSelect.querySelectorAll('option')].map((o) =>
        o.getAttribute('value'),
      ),
    ).toEqual([
      'experiment',
      'dataset',
      'sample',
      'reagent',
      'protocol_template',
      'report',
    ])
    expect(screen.getByLabelText('Search records or Datasets')).toBeTruthy()
  })
})

describe('BlockEditor — linked_record stable identity (NOTE-03)', () => {
  const SAMPLE_ROW = {
    id: '7dc5c1a4-9f3e-4c8b-9a44-2f1b6c9d5e10',
    identifier: 'SMP-2025-0001',
    title: 'Sample A',
  }

  it('issues a proxy-safe or() ilike filter for the record search', async () => {
    const user = userEvent.setup()
    const { notebookDataClient } = await import('#/lib/notebook-data')
    const list = notebookDataClient.list as ReturnType<typeof vi.fn>
    list.mockReset().mockResolvedValue([])
    renderWithQuery(
      <BlockEditor
        block={block({
          type: 'linked_record',
          payload: {
            targetKind: 'sample',
            targetIdentifier: '',
            linkType: 'general',
            label: '',
          },
        })}
        save={vi.fn(async () => ({ ok: true }))}
      />,
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Search records or Datasets' }),
      'SMP',
    )
    await waitFor(() => expect(list).toHaveBeenCalled())
    const query = list.mock.calls.at(-1)?.[1] as string
    expect(query).toContain('or=(identifier.ilike.SMP*,title.ilike.SMP*)')
    const { sanitizeQuery } = await import('#/lib/postgrest-path')
    expect(() => sanitizeQuery(query)).not.toThrow()
  })

  it('captures the canonical UUID when a record is picked from search', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    const { notebookDataClient } = await import('#/lib/notebook-data')
    ;(notebookDataClient.list as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue([SAMPLE_ROW])
    renderWithQuery(
      <BlockEditor
        block={block({
          type: 'linked_record',
          payload: {
            targetKind: 'sample',
            targetIdentifier: '',
            linkType: 'general',
            label: '',
          },
        })}
        save={save}
      />,
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Search records or Datasets' }),
      'SMP',
    )
    await user.click(await screen.findByText('SMP-2025-0001'))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          targetIdentifier: 'SMP-2025-0001',
          targetId: '7dc5c1a4-9f3e-4c8b-9a44-2f1b6c9d5e10',
        }),
      ),
    )
  })

  it('drops the stored UUID when the identifier is retyped by hand', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    renderWithQuery(
      <BlockEditor
        block={block({
          type: 'linked_record',
          payload: {
            targetKind: 'sample',
            targetIdentifier: 'SMP-2025-0001',
            targetId: '7dc5c1a4-9f3e-4c8b-9a44-2f1b6c9d5e10',
            linkType: 'general',
            label: '',
          },
        })}
        save={save}
      />,
    )
    const idInput = screen.getByPlaceholderText('EXP-2025-0001')
    await user.type(idInput, 'X')
    await user.tab()
    await waitFor(() => expect(save).toHaveBeenCalled())
    // A manually typed identifier is a label, not identity — the payload
    // must not keep a UUID it no longer corresponds to.
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: undefined }),
    )
  })

  it('offers the canonical Open affordance in read-only mode', () => {
    renderWithQuery(
      <BlockEditor
        block={block({
          type: 'linked_record',
          payload: {
            targetKind: 'dataset',
            targetIdentifier: 'Stability readings',
            targetId: '00000000-0000-4000-8000-000000000170',
            linkType: 'dataset',
            label: '',
          },
        })}
        save={okSave}
        readOnly
      />,
    )
    const open = screen.getByRole('link', { name: 'Open' })
    expect(open.getAttribute('href')).toBe(
      '/datasets?dataset=00000000-0000-4000-8000-000000000170',
    )
  })

  it('offers no Open affordance when only a label is stored', () => {
    renderWithQuery(
      <BlockEditor
        block={block({
          type: 'linked_record',
          payload: {
            targetKind: 'sample',
            targetIdentifier: 'SMP-2025-0001',
            linkType: 'general',
            label: '',
          },
        })}
        save={okSave}
        readOnly
      />,
    )
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull()
  })
})

describe('BlockEditor — unsupported type', () => {
  it('renders a readable placeholder and never calls save', () => {
    const save = vi.fn(async () => ({ ok: true }))
    renderWithQuery(
      <BlockEditor
        block={block({
          type: 'unknown_future_type',
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
    renderWithQuery(
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
    renderWithQuery(
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

describe('BlockEditor — explain surface (ASSIST-01)', () => {
  it('offers a grounded explanation for a validation failure', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({ ok: true }))
    renderWithQuery(
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
    // Touch the draft then leave the identifier blank: client validation
    // rejects the save and the footer surfaces the Explain affordance.
    const idInput = screen.getByPlaceholderText('EXP-2025-0001')
    await user.click(idInput)
    await user.type(idInput, 'X')
    await user.keyboard('{Control>}a{/Control}{Backspace}')
    await user.tab()
    expect(save).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Explain' }))
    // Grounded explanation: what failed, a cited rule, and the
    // assistive-not-authoritative marking. No mutation path.
    expect(
      await screen.findByText(/Why this linked_record block cannot save/),
    ).toBeTruthy()
    expect(screen.getByText(/Nothing was written/)).toBeTruthy()
    expect(screen.getAllByText(/\[Block rule/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Not authoritative/)).toBeTruthy()
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
    renderWithQuery(
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
    renderWithQuery(
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
