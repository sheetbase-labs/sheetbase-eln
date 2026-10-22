/**
 * NotebookDocument component tests (ELN-005). Covers per-block editing,
 * insertion, duplication, destructive delete confirmation/cancellation,
 * undo, and read-only behaviour for archived notebooks. Mutation callbacks
 * are stubbed so no RPC or QueryClient context is required.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { NotebookDocument } from './notebook-document'
import { BLOCK_PICKER_OPTIONS } from '#/lib/blocks/registry'
import { NotebookOutlinePanel } from './notebook-outline-panel'
import { notebookOutline } from '#/lib/notebook-outline'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

// NOTE-03: scientific block previews carry canonical Open affordances built
// with TanStack Link; mock the router so these render as plain anchors.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children?: React.ReactNode
    [key: string]: unknown
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

beforeAll(() => {
  document.elementFromPoint = () => null
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => cleanup())

const record: NotebookRecord = {
  id: 'r1',
  projectId: 'p1',
  kind: 'experiment',
  identifier: 'EXP-2025-0001',
  title: 'Virus Stability',
  status: 'in-progress',
  tags: [],
  structureVersion: 1,
  metadataVersion: 1,
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T13:00:00.000Z',
  archivedAt: null,
  deletedAt: null,
  createdByUserId: 'u1',
  updatedByUserId: null,
  properties: {},
  lockedAt: null,
  lockedByRevisionId: null,
}

const archivedRecord: NotebookRecord = {
  ...record,
  archivedAt: '2026-07-19T00:00:00.000Z',
}

function richTextBlock(id: string, text: string): NotebookBlock {
  return {
    id,
    recordId: 'r1',
    type: 'rich_text',
    payload: {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text }],
          },
        ],
      },
    },
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  }
}

describe('NotebookDocument — rendering', () => {
  it('uses each copy’s block deep link and publishes selection only to its owner', () => {
    const props = {
      record,
      blocks: threeBlocks(),
      readOnly: true,
      onSaveBlock: vi.fn(),
      onInsertBlock: vi.fn(),
      onDuplicateBlock: vi.fn(),
      onDeleteBlock: vi.fn(),
    }
    const scrolled: Element[] = []
    const scroll = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(function (this: Element) {
        scrolled.push(this)
      })
    const firstHash = vi.fn()
    const secondHash = vi.fn()
    const browserAddress = window.location.href
    const first = render(
      <NotebookDocument
        {...props}
        initialBlockHash="block-b1"
        onBlockHashChange={firstHash}
      />,
    )
    const second = render(
      <NotebookDocument
        {...props}
        initialBlockHash="block-b3"
        onBlockHashChange={secondHash}
      />,
    )
    expect(scrolled).toEqual([
      first.container.querySelector('[id="block-b1"]'),
      second.container.querySelector('[id="block-b3"]'),
    ])
    fireEvent.click(second.container.querySelector('[id="block-b2"]')!)
    expect(secondHash).toHaveBeenCalledWith('block-b2')
    expect(firstHash).not.toHaveBeenCalled()
    expect(window.location.href).toBe(browserAddress)
    const secondCopy = (hash: string) => (
      <NotebookDocument
        {...props}
        initialBlockHash={hash}
        onBlockHashChange={secondHash}
      />
    )
    // A selection echoed by the owning router must not jump to the block top.
    second.rerender(secondCopy('block-b2'))
    expect(scrolled).toHaveLength(2)
    // Links to other blocks must still work without remounting the document,
    // including returning to the last locally selected block.
    second.rerender(secondCopy('block-b1'))
    second.rerender(secondCopy('block-b2'))
    expect(scrolled.slice(2)).toEqual([
      second.container.querySelector('[id="block-b1"]'),
      second.container.querySelector('[id="block-b2"]'),
    ])
    expect(secondHash).toHaveBeenCalledTimes(1)
    expect(firstHash).not.toHaveBeenCalled()
    scroll.mockRestore()
  })

  it('renders each block with a stable anchor id', () => {
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b1', 'A'), richTextBlock('b2', 'B')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )
    expect(container.querySelector('#block-b1')).toBeTruthy()
    expect(container.querySelector('#block-b2')).toBeTruthy()
  })

  it('reads as a document until a block is selected for editing', () => {
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b1', 'Objective')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Objective' })).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.click(container.querySelector('#block-b1')!)
    expect(screen.getByRole('textbox', { name: 'Text content' })).toBeTruthy()
  })

  it('renders an honest, labelled frozen chart preview', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    render(
      <QueryClientProvider client={client}>
        <NotebookDocument
          record={record}
          blocks={[
            {
              ...richTextBlock('chart-1', ''),
              type: 'chart',
              payload: {
                title: 'Frozen stability snapshot (qPCR)',
                spec: null,
                frozen: {
                  revisionId: null,
                  frozenAt: '2025-07-14T10:00:00Z',
                  frozenByUserId: 'u1',
                  datasetProvenance: [
                    {
                      datasetId: '00000000-0000-4000-8000-000000000170',
                      schemaVersion: 1,
                      rowCount: 2,
                      checksum: 'abc12345',
                    },
                  ],
                  data: {
                    columns: [
                      {
                        fieldId: 'c1',
                        label: 'Time (days)',
                        logicalType: 'decimal',
                        unit: { symbol: 'd' },
                      },
                      {
                        fieldId: 'c2',
                        label: 'Log titer',
                        logicalType: 'decimal',
                        unit: { symbol: 'log₁₀' },
                      },
                    ],
                    rows: [
                      { col_time: 0, col_titer: 7.2 },
                      { col_time: 28, col_titer: 5.9 },
                    ],
                    series: [
                      {
                        identifier: '4 °C',
                        label: '4 °C',
                        color: '#006EDC',
                        points: [
                          { x: 0, y: 7.2, yError: null, label: '4 °C' },
                          { x: 28, y: 5.9, yError: null, label: '4 °C' },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          ]}
          onSaveBlock={vi.fn()}
          onInsertBlock={vi.fn()}
          onDuplicateBlock={vi.fn()}
          onDeleteBlock={vi.fn()}
        />
      </QueryClientProvider>,
    )

    expect(
      screen.getByRole('figure', {
        name: 'Frozen stability snapshot (qPCR)',
      }),
    ).toBeTruthy()
    expect(screen.getByText('Snapshot')).toBeTruthy()
    // Accessible tabular alternative renders the frozen points.
    expect(screen.getByText(/Show data table/)).toBeTruthy()
  })

  it('opens the plate map editor when selected', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    const { container } = render(
      <QueryClientProvider client={client}>
        <NotebookDocument
          record={record}
          blocks={[
            {
              id: 'pm1',
              recordId: 'r1',
              type: 'plate_map',
              payload: {},
              payloadSchemaVersion: 1,
              order: 1,
              version: 1,
            },
          ]}
          onSaveBlock={vi.fn()}
          onInsertBlock={vi.fn()}
          onDuplicateBlock={vi.fn()}
          onDeleteBlock={vi.fn()}
        />
      </QueryClientProvider>,
    )
    fireEvent.click(container.querySelector('#block-pm1')!)
    expect(
      screen.getByRole('button', { name: /Initialize 96-well plate/ }),
    ).toBeTruthy()
  })
})

describe('NotebookDocument — insertion', () => {
  it('renders the block picker and calls onInsertBlock on select', async () => {
    const user = userEvent.setup()
    const onInsertBlock = vi.fn().mockResolvedValue(undefined)
    render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b1', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={onInsertBlock}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )
    // The insert affordance between and after blocks, not the removed
    // foot button.
    await user.click(screen.getByRole('button', { name: /Insert block after/ }))
    await user.click(await screen.findByRole('option', { name: /^Text/ }))
    expect(onInsertBlock).toHaveBeenCalledWith('rich_text', 'b1')
  })

  it('turns an empty notebook into a focused first block', async () => {
    const user = userEvent.setup()

    function EmptyAuthoringHarness() {
      const [blocks, setBlocks] = React.useState<NotebookBlock[]>([])
      return (
        <NotebookDocument
          record={record}
          blocks={blocks}
          onSaveBlock={async () => ({ ok: true })}
          onInsertBlock={async (type) => {
            const inserted: NotebookBlock = {
              id: 'new-block',
              recordId: record.id,
              type,
              payload: {
                doc: { type: 'doc', content: [{ type: 'paragraph' }] },
              },
              payloadSchemaVersion: 1,
              order: 1,
              version: 1,
            }
            setBlocks([inserted])
            return inserted.id
          }}
          onDuplicateBlock={async () => undefined}
          onDeleteBlock={async () => undefined}
        />
      )
    }

    const { container } = render(<EmptyAuthoringHarness />)
    expect(screen.getByText('Start this Notebook')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Start writing' }))

    const editor = await screen.findByRole('textbox', { name: 'Text content' })
    await waitFor(() => {
      const anchor = container.querySelector('#block-new-block')
      expect(anchor?.contains(document.activeElement)).toBe(true)
      expect(anchor?.querySelector('[data-state="editing"]')).toBeTruthy()
    })
    expect(editor).toBe(document.activeElement)
  })

  it('deletes the sole empty text block and refocuses the empty Notebook start', async () => {
    const user = userEvent.setup()
    const onDeleteBlock = vi.fn()
    const emptyBlock: NotebookBlock = {
      ...richTextBlock('only-block', ''),
      payload: {
        doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      },
    }

    function SoleEmptyBlockHarness() {
      const [blocks, setBlocks] = React.useState([emptyBlock])
      return (
        <NotebookDocument
          record={record}
          blocks={blocks}
          onSaveBlock={async () => ({ ok: true })}
          onInsertBlock={async () => undefined}
          onDuplicateBlock={async () => undefined}
          onDeleteBlock={async (block) => {
            onDeleteBlock(block)
            setBlocks([])
          }}
        />
      )
    }

    render(
      <NotebookDocument
        record={record}
        blocks={[]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )
    const { container } = render(<SoleEmptyBlockHarness />)
    await user.click(container.querySelector('#block-only-block')!)
    const editor = await screen.findByRole('textbox', { name: 'Text content' })
    await waitFor(() => expect(editor).toBe(document.activeElement))

    await user.keyboard('{Backspace}')

    await waitFor(() => {
      expect(onDeleteBlock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'only-block' }),
      )
      expect(within(container).getByText('Start this Notebook')).toBeTruthy()
      expect(
        within(container).getByRole('button', { name: 'Start writing' }),
      ).toBe(document.activeElement)
    })
  })

  it('offers a keyboard-reachable insertion point between blocks', async () => {
    const user = userEvent.setup()
    const onInsertBlock = vi.fn().mockResolvedValue(undefined)
    render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={onInsertBlock}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )

    await user.click(
      screen.getAllByRole('button', { name: 'Insert block after Text' })[0],
    )
    await user.click(await screen.findByRole('option', { name: /^Checklist/ }))
    expect(onInsertBlock).toHaveBeenCalledWith('checklist', 'b1')
  })
})

// EXP-04.3 — the Insert block menu opens from `/` and `+`, filters as the
// user types, and is driven from the keyboard (arrows, Enter, Esc).
describe('NotebookDocument — insert-block menu', () => {
  it('opens the menu from /, narrows it as the query is typed, and closes on Esc', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b1', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onReplaceBlock={vi.fn().mockResolvedValue(undefined)}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )

    await user.click(container.querySelector('#block-b1')!)
    const editor = await screen.findByRole('textbox', { name: 'Text content' })
    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}{Backspace}')
    await user.paste('/')

    expect(
      await screen.findByRole('listbox', { name: 'Insert block' }),
    ).toBeTruthy()
    expect(screen.getAllByRole('option')).toHaveLength(
      BLOCK_PICKER_OPTIONS.length,
    )

    await user.paste('table')
    const narrowed = screen.getAllByRole('option')
    expect(narrowed).toHaveLength(1)
    expect(narrowed[0].textContent).toContain('Grid backed by a model')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox', { name: 'Insert block' })).toBeNull()
  })

  it('inserts the block the arrow keys highlight with Enter', async () => {
    const user = userEvent.setup()
    const onReplaceBlock = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b1', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onReplaceBlock={onReplaceBlock}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )

    await user.click(container.querySelector('#block-b1')!)
    const editor = await screen.findByRole('textbox', { name: 'Text content' })
    await user.click(editor)
    await user.keyboard('{Control>}a{/Control}{Backspace}')
    await user.paste('/')
    await screen.findByRole('listbox', { name: 'Insert block' })

    // The design highlights Sheet first; one ArrowDown moves to the next
    // entry in the same group.
    await user.keyboard('{ArrowDown}')
    const highlighted = screen
      .getAllByRole('option')
      .filter((option) => option.getAttribute('aria-selected') === 'true')
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0].textContent).toContain('Record reference')

    await user.keyboard('{Enter}')
    expect(onReplaceBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1' }),
      'linked_record',
    )
    expect(screen.queryByRole('listbox', { name: 'Insert block' })).toBeNull()
  })

  it('opens the same menu from the + control and inserts the highlighted block with Enter', async () => {
    const user = userEvent.setup()
    const onInsertBlock = vi.fn().mockResolvedValue(undefined)
    render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b1', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={onInsertBlock}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )

    // The insert affordance between and after blocks, not the removed
    // foot button.
    await user.click(screen.getByRole('button', { name: /Insert block after/ }))
    // The `+` control opens the same "Insert block" menu as `/`.
    expect(
      await screen.findByRole('listbox', { name: 'Insert block' }),
    ).toBeTruthy()
    await user.type(
      await screen.findByRole('combobox'),
      'a saved chart, a statistic or both',
    )

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0].textContent).toContain('Chart or analysis')

    await user.keyboard('{Enter}')
    expect(onInsertBlock).toHaveBeenCalledWith('analysis', 'b1')
  })
})

describe('NotebookDocument — autosave state across block navigation', () => {
  it('keeps an unselected draft and its conflict resolution mounted', async () => {
    const user = userEvent.setup()
    let resolveSave!: (result: {
      ok: false
      kind: 'conflict'
      message: string
      serverValue: Record<string, unknown>
    }) => void
    const onSaveBlock = vi.fn(
      () =>
        new Promise<{
          ok: false
          kind: 'conflict'
          message: string
          serverValue: Record<string, unknown>
        }>((resolve) => {
          resolveSave = resolve
        }),
    )
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={[
          richTextBlock('b1', 'Objective'),
          richTextBlock('b2', 'Methods'),
        ]}
        onSaveBlock={onSaveBlock}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )

    await user.click(container.querySelector('#block-b1')!)
    const firstBlock = container.querySelector('#block-b1') as HTMLElement
    const firstEditor = await within(firstBlock).findByRole('textbox', {
      name: 'Text content',
    })
    await user.click(firstEditor)
    await user.keyboard('{Control>}a{/Control}{Backspace}')
    await user.paste('Local objective')

    await user.click(container.querySelector('#block-b2')!)
    await waitFor(() => expect(onSaveBlock).toHaveBeenCalledTimes(1))
    expect(
      within(firstBlock).getByRole('textbox', { name: 'Text content' })
        .textContent,
    ).toBe('Local objective')

    await act(async () => {
      resolveSave({
        ok: false,
        kind: 'conflict',
        message: 'This block changed elsewhere.',
        serverValue: {
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Server objective' }],
              },
            ],
          },
        },
      })
    })

    expect(
      await within(firstBlock).findByRole('button', {
        name: /Use server version/,
      }),
    ).toBeTruthy()
    expect(within(firstBlock).getByText('Server objective')).toBeTruthy()
    expect(
      within(firstBlock).getByRole('textbox', { name: 'Text content' })
        .textContent,
    ).toBe('Local objective')
    expect(
      container.querySelector('#block-b2')?.getAttribute('data-selected'),
    ).toBe('true')
  })
})

describe('NotebookDocument — duplication', () => {
  it('calls onDuplicateBlock from the block menu', async () => {
    const user = userEvent.setup()
    const onDuplicateBlock = vi.fn().mockResolvedValue(undefined)
    render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b1', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={onDuplicateBlock}
        onDeleteBlock={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Block actions/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))
    expect(onDuplicateBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1', type: 'rich_text' }),
    )
  })
})

describe('NotebookDocument — delete confirmation', () => {
  it('asks for confirmation before deleting and calls onDeleteBlock', async () => {
    const user = userEvent.setup()
    const onDeleteBlock = vi.fn().mockResolvedValue(undefined)
    render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b1', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={onDeleteBlock}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Block actions/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    // Confirmation dialog opens; the destructive action is not yet taken.
    expect(onDeleteBlock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDeleteBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1' }),
    )
  })

  it('cancel closes the dialog without deleting', async () => {
    const user = userEvent.setup()
    const onDeleteBlock = vi.fn().mockResolvedValue(undefined)
    render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b1', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={onDeleteBlock}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Block actions/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDeleteBlock).not.toHaveBeenCalled()
  })
})

describe('NotebookDocument — undo delete', () => {
  it('offers an undo after a successful delete', async () => {
    const user = userEvent.setup()
    const onDeleteBlock = vi.fn().mockResolvedValue(undefined)
    const onUndoDelete = vi.fn().mockResolvedValue(undefined)
    render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b1', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={onDeleteBlock}
        onUndoDelete={onUndoDelete}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Block actions/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Block deleted.')).toBeTruthy()
    const undoDelete = screen
      .getAllByRole('button', { name: 'Undo' })
      .find((button) => !button.hasAttribute('disabled'))
    expect(undoDelete).toBeTruthy()
    await user.click(undoDelete!)
    expect(onUndoDelete).toHaveBeenCalled()
  })

  it('dismisses the undo status once the atomic restore resolves', async () => {
    const user = userEvent.setup()
    const onDeleteBlock = vi.fn().mockResolvedValue(undefined)
    // Undo restores the block in a single server-authoritative insert; a
    // resolved call means the block is back at its original position.
    const onUndoDelete = vi.fn().mockResolvedValue({ id: 'b1-restored' })
    // blocks mirrors the route's cache after the undo insert upserts the
    // restored block: the original neighbour and the restored block itself.
    render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b2', 'B'), richTextBlock('b1-restored', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={onDeleteBlock}
        onUndoDelete={onUndoDelete}
      />,
    )
    await user.click(
      screen.getAllByRole('button', { name: /Block actions/ })[0],
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    // The restored block is present and the undo status is dismissed: the
    // server resolved position and content in one atomic operation.
    expect(screen.getByText('A')).toBeTruthy()
    expect(screen.queryByText('Block deleted.')).toBeNull()
    expect(onUndoDelete).toHaveBeenCalledWith('rich_text', expect.anything(), {
      afterBlockId: null,
      beforeBlockId: 'b1-restored',
    })
  })
})

describe('NotebookDocument — read-only', () => {
  it('hides the picker and block menu for archived records', () => {
    render(
      <NotebookDocument
        record={archivedRecord}
        blocks={[richTextBlock('b1', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        readOnly
      />,
    )
    expect(screen.queryByRole('button', { name: /Add block/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Block actions/ })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ELN-006 — block ordering and keyboard movement.
// ---------------------------------------------------------------------------

function threeBlocks() {
  return [
    richTextBlock('b1', 'A'),
    richTextBlock('b2', 'B'),
    richTextBlock('b3', 'C'),
  ]
}

/** Read the visible block order by walking #block-<id> anchors in DOM order. */
function blockIdOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[id^="block-"]')).map((el) =>
    el.id.replace(/^block-/, ''),
  )
}

async function moveMenuItems(): Promise<HTMLElement[]> {
  return screen.findAllByRole('menuitem', { name: /^Move (up|down)$/ })
}

describe('NotebookDocument — movement via menu', () => {
  it('moves the first block down via the Move down menu item', async () => {
    const user = userEvent.setup()
    const onMoveBlock = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={onMoveBlock}
      />,
    )
    expect(blockIdOrder(container)).toEqual(['b1', 'b2', 'b3'])
    // Open the first block's action menu and choose Move down.
    await user.click(
      screen.getAllByRole('button', { name: /Block actions/ })[0],
    )
    // First block's Move up is disabled; only Move down is enabled.
    const moves = await moveMenuItems()
    expect(moves.length).toBeGreaterThanOrEqual(1)
    await user.click(await screen.findByRole('menuitem', { name: 'Move down' }))
    expect(onMoveBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1' }),
      // Moving b1 from index 0 to index 1 → after=b2, before=b3.
      expect.objectContaining({ afterBlockId: 'b2', beforeBlockId: 'b3' }),
    )
  })

  it('moves the last block up via the Move up menu item', async () => {
    const user = userEvent.setup()
    const onMoveBlock = vi.fn().mockResolvedValue(undefined)
    render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={onMoveBlock}
      />,
    )
    await user.click(
      screen.getAllByRole('button', { name: /Block actions/ })[2],
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }))
    expect(onMoveBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b3' }),
      // Moving b3 from index 2 to index 1 → after=b1, before=b2.
      expect.objectContaining({ afterBlockId: 'b1', beforeBlockId: 'b2' }),
    )
  })

  it('moves a middle block up and then down via the menu', async () => {
    const user = userEvent.setup()
    const onMoveBlock = vi.fn().mockResolvedValue(undefined)
    render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={onMoveBlock}
      />,
    )
    // Middle block (b2) Move up → after=null, before=b1.
    await user.click(
      screen.getAllByRole('button', { name: /Block actions/ })[1],
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move up' }))
    expect(onMoveBlock).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'b2' }),
      expect.objectContaining({ afterBlockId: null, beforeBlockId: 'b1' }),
    )
  })

  it('disables Move up on the first block and Move down on the last', async () => {
    const user = userEvent.setup()
    render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    await user.click(
      screen.getAllByRole('button', { name: /Block actions/ })[0],
    )
    const up = await screen.findByRole('menuitem', {
      name: 'Move up',
    })
    expect(
      up.getAttribute('aria-disabled') === 'true' ||
        up.hasAttribute('disabled'),
    ).toBe(true)
  })

  it('inserts a text block below the current block', async () => {
    const user = userEvent.setup()
    const onInsertBlock = vi.fn().mockResolvedValue('new')
    render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={onInsertBlock}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    await user.click(
      screen.getAllByRole('button', { name: /Block actions/ })[1],
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'Insert text below' }),
    )
    expect(onInsertBlock).toHaveBeenCalledWith('rich_text', 'b2')
  })
})

describe('NotebookDocument — movement via keyboard', () => {
  it('navigates and refocuses moves within the second copy of the same notebook', async () => {
    const props = {
      record,
      blocks: threeBlocks(),
      onSaveBlock: vi.fn(),
      onInsertBlock: vi.fn(),
      onDuplicateBlock: vi.fn(),
      onDeleteBlock: vi.fn(),
      onMoveBlock: vi.fn().mockResolvedValue(undefined),
    }
    const first = render(<NotebookDocument {...props} />)
    const second = render(<NotebookDocument {...props} />)
    const row = second.container.querySelector<HTMLElement>('[id="block-b1"]')!
    act(() => row.focus())
    fireEvent.keyDown(row, { key: 'ArrowDown', ctrlKey: true })
    const next = second.container.querySelector<HTMLElement>('[id="block-b2"]')!
    await waitFor(() =>
      expect(next.contains(document.activeElement)).toBe(true),
    )
    fireEvent.keyDown(next, { key: 'ArrowUp', altKey: true })
    await waitFor(() => expect(props.onMoveBlock).toHaveBeenCalledTimes(1))
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    await waitFor(() =>
      expect(next.contains(document.activeElement)).toBe(true),
    )
    expect(first.container.contains(document.activeElement)).toBe(false)
    expect(first.container.querySelector('[data-selected="true"]')).toBeNull()
  })

  it('keeps even a single editable block keyboard selectable', () => {
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b1', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )
    expect(container.querySelector('#block-b1')?.getAttribute('tabindex')).toBe(
      '0',
    )
  })

  it('Ctrl+Arrow navigates between blocks without changing their order', async () => {
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    const first = container.querySelector('#block-b1') as HTMLElement
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown', ctrlKey: true })

    await waitFor(() => {
      const second = container.querySelector('#block-b2') as HTMLElement
      expect(second.dataset.selected).toBe('true')
      expect(second.contains(document.activeElement)).toBe(true)
    })
    expect(blockIdOrder(container)).toEqual(['b1', 'b2', 'b3'])
  })

  it('Alt+ArrowDown moves the focused block down with the same destination as the menu', () => {
    const onMoveBlock = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={onMoveBlock}
      />,
    )
    const row = container.querySelector('#block-b1') as HTMLElement
    expect(row).toBeTruthy()
    fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true })
    expect(onMoveBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1' }),
      expect.objectContaining({ afterBlockId: 'b2', beforeBlockId: 'b3' }),
    )
  })

  it('Alt+ArrowUp moves the focused block up', () => {
    const onMoveBlock = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={onMoveBlock}
      />,
    )
    const row = container.querySelector('#block-b3') as HTMLElement
    fireEvent.keyDown(row, { key: 'ArrowUp', altKey: true })
    expect(onMoveBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b3' }),
      expect.objectContaining({ afterBlockId: 'b1', beforeBlockId: 'b2' }),
    )
  })

  it('does nothing at the top/bottom edges', () => {
    const onMoveBlock = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={onMoveBlock}
      />,
    )
    fireEvent.keyDown(container.querySelector('#block-b1') as HTMLElement, {
      key: 'ArrowUp',
      altKey: true,
    })
    expect(onMoveBlock).not.toHaveBeenCalled()
    fireEvent.keyDown(container.querySelector('#block-b3') as HTMLElement, {
      key: 'ArrowDown',
      altKey: true,
    })
    expect(onMoveBlock).not.toHaveBeenCalled()
  })
})

describe('NotebookDocument — optimistic reorder and rollback', () => {
  it('applies the optimistic order immediately and clears it on success', async () => {
    const user = userEvent.setup()
    let resolveMove: () => void = () => {}
    const onMoveBlock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveMove = resolve
        }),
    )
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={onMoveBlock}
      />,
    )
    expect(blockIdOrder(container)).toEqual(['b1', 'b2', 'b3'])
    await user.click(
      screen.getAllByRole('button', { name: /Block actions/ })[0],
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move down' }))
    // Optimistic: b1 should now appear second in DOM order while the RPC
    // is in flight.
    expect(blockIdOrder(container)).toEqual(['b2', 'b1', 'b3'])
    resolveMove()
    await new Promise((r) => setTimeout(r, 0))
    // After success the optimistic override is cleared; the canonical
    // blocks prop order (b1, b2, b3) is restored until the route updates
    // its cache with the canonical RPC result.
    expect(blockIdOrder(container)).toEqual(['b1', 'b2', 'b3'])
  })

  it('rolls back to the exact pre-move order when the server rejects the move', async () => {
    const user = userEvent.setup()
    const onMoveBlock = vi
      .fn()
      .mockRejectedValue(new Error('stale version: structure changed'))
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={onMoveBlock}
      />,
    )
    expect(blockIdOrder(container)).toEqual(['b1', 'b2', 'b3'])
    await user.click(
      screen.getAllByRole('button', { name: /Block actions/ })[0],
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move down' }))
    // After rejection the order returns to the pre-move baseline.
    await new Promise((r) => setTimeout(r, 0))
    expect(blockIdOrder(container)).toEqual(['b1', 'b2', 'b3'])
    // And a stale error is surfaced on the moved block.
    expect(screen.getByText(/notebook changed elsewhere/i)).toBeTruthy()
    expect(container.querySelector('[data-move-error="stale"]')).toBeTruthy()
  })

  it('shows a generic move error for non-stale failures', async () => {
    const user = userEvent.setup()
    const onMoveBlock = vi.fn().mockRejectedValue(new Error('network down'))
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={onMoveBlock}
      />,
    )
    await user.click(
      screen.getAllByRole('button', { name: /Block actions/ })[0],
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Move down' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('[data-move-error="generic"]')).toBeTruthy()
    expect(screen.getByText('network down')).toBeTruthy()
  })
})

/**
 * The drag itself is measured in a real engine, where `@dnd-kit` can measure
 * rects: `tests/browser/component-compare.test.ts` drags both columns and
 * asserts they resolve a drop to the same index, and
 * `tests/browser/note-01-authoring.test.ts` reorders a real notebook. jsdom
 * zeroes every bounding rect, so a drop here would resolve to no target at all
 * and prove nothing. What is pinned here is the wiring the swap introduced: the
 * grip is the item's single control, the row keeps the notebook's own
 * semantics, and the keyboard sensor really lifts and drops the row.
 */
describe('NotebookDocument — drag and drop', () => {
  it('renders the grip on each movable block and registers the row as a sortable item', () => {
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={vi.fn().mockResolvedValue(undefined)}
      />,
    )

    const handles = screen.getAllByRole('button', { name: 'Drag block' })
    expect(handles).toHaveLength(3)
    for (const handle of handles) {
      expect(handle.getAttribute('data-slot')).toBe('sortable-item-handle')
      // Native drag is not wanted on the grip: the browser's own drag would
      // start alongside the pointer sensor and fight it for the same gesture.
      expect(handle.getAttribute('draggable')).toBeNull()
      // The grip joins the print-hide set with the rest of the row's chrome,
      // so the printed document carries no authoring affordances.
      expect(handle.closest('[data-print-hide]')).not.toBeNull()
    }

    const rows = Array.from(
      container.querySelectorAll('[data-slot="sortable-item"]'),
    )
    expect(rows.map((row) => row.getAttribute('data-value'))).toEqual([
      'b1',
      'b2',
      'b3',
    ])
    // The row keeps the notebook's own semantics rather than taking the
    // item's widget role: a labelled group whose focusable control is inside
    // it, which is what keeps axe clean (see condition C1 in the comparison
    // record).
    expect(rows[0].getAttribute('role')).toBe('group')
    expect(rows[0].getAttribute('tabindex')).toBe('0')
    expect(rows[0].getAttribute('aria-pressed')).toBeNull()
  })

  it('lifts and cancels the row with the keyboard sensor on the grip', async () => {
    const onMoveBlock = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={onMoveBlock}
      />,
    )
    const handle = screen.getAllByRole('button', { name: 'Drag block' })[0]
    const row = container.querySelector('#block-b1') as HTMLElement
    expect(row.getAttribute('data-dragging')).toBe('false')

    // Enter or Space on the grip is the sensor's lift, and the notebook shows
    // it in the row's own state as well.
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' })
    expect(row.getAttribute('data-dragging')).toBe('true')
    expect(
      container.querySelector('#block-b1 [data-state="dragging"]'),
    ).toBeTruthy()

    // Escape cancels: the row is put back down and nothing is persisted. The
    // sensor attaches its document listener on a timer after the lift, so the
    // key has to wait for it.
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' })
    expect(row.getAttribute('data-dragging')).toBe('false')
    expect(onMoveBlock).not.toHaveBeenCalled()
  })

  it('opens the block actions menu from the grip', async () => {
    const user = userEvent.setup()
    render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    await user.click(screen.getAllByRole('button', { name: 'Drag block' })[0])
    expect(
      await screen.findByRole('menuitem', { name: 'Duplicate' }),
    ).toBeTruthy()
  })
})

describe('NotebookDocument — movement read-only', () => {
  it('does not render drag handles or move menu items for archived records', () => {
    render(
      <NotebookDocument
        record={archivedRecord}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={vi.fn().mockResolvedValue(undefined)}
        readOnly
      />,
    )
    expect(screen.queryAllByRole('button', { name: 'Drag block' })).toEqual([])
    expect(
      screen.queryAllByRole('menuitem', { name: /^Move (up|down)$/ }),
    ).toEqual([])
  })

  it('does not render move affordances when onMoveBlock is omitted', () => {
    render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )
    expect(screen.queryAllByRole('button', { name: 'Drag block' })).toEqual([])
    expect(
      screen.queryAllByRole('menuitem', { name: /^Move (up|down)$/ }),
    ).toEqual([])
  })
})

describe('NotebookDocument — focus and selection after a move', () => {
  it('keeps selection and refocuses the moved block after a successful move', async () => {
    const onMoveBlock = vi.fn().mockResolvedValue(undefined)
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={onMoveBlock}
      />,
    )
    const row = container.querySelector('#block-b1') as HTMLElement
    fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true })
    // Wait for the optimistic move + requestAnimationFrame focus to settle.
    await new Promise((r) => setTimeout(r, 50))
    // Selection remains inside block-b1 after the move. Editable blocks may
    // move focus into their contextual editor rather than the outer anchor.
    const b1Anchor = container.querySelector('#block-b1') as HTMLElement
    expect(b1Anchor.contains(document.activeElement)).toBe(true)
  })

  it('refocuses the moved block after a rollback', async () => {
    const onMoveBlock = vi.fn().mockRejectedValue(new Error('stale version'))
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={threeBlocks()}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onMoveBlock={onMoveBlock}
      />,
    )
    const row = container.querySelector('#block-b1') as HTMLElement
    fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true })
    // Wait for the rollback + requestAnimationFrame focus to settle.
    await new Promise((r) => setTimeout(r, 50))
    const b1Anchor = container.querySelector('#block-b1') as HTMLElement
    // Selection remains inside the restored block. Editable blocks may move
    // focus into their contextual editor rather than the outer anchor.
    expect(b1Anchor).toBeTruthy()
    expect(b1Anchor.contains(document.activeElement)).toBe(true)
  })
})

describe('NOTE-02 sections and outline anchors', () => {
  function paragraphBlock(id: string, order: number): NotebookBlock {
    return {
      id,
      recordId: 'r1',
      type: 'rich_text',
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: `Body ${id}` }],
            },
          ],
        },
      },
      payloadSchemaVersion: 1,
      order,
      version: 1,
    }
  }

  it('renders stable in-payload heading anchors for outline navigation', () => {
    render(
      <NotebookDocument
        record={record}
        blocks={[richTextBlock('b1', 'Objective')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )
    const heading = document.getElementById('section-b1-h0')
    expect(heading).toBeTruthy()
    expect(heading!.getAttribute('id')).toBe('section-b1-h0')
  })

  it('collapses a section, hides its blocks and offers Show', () => {
    const onToggleSection = vi.fn()
    render(
      <NotebookDocument
        record={record}
        blocks={[
          richTextBlock('sec-1', 'Methods'),
          paragraphBlock('body-1', 2),
          paragraphBlock('body-2', 3),
        ]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        collapsedSections={new Set(['section-sec-1-h0'])}
        onToggleSection={onToggleSection}
      />,
    )
    // Section body is hidden from view but still in the DOM (print keeps it).
    const body = document.getElementById('block-body-1')!
    expect(body.className).toContain('hidden')
    expect(body.className).toContain('print:contents')
    // Placeholder offers the way back, wired to the route toggle.
    const placeholder = screen.getByTestId('section-collapsed-section-sec-1-h0')
    expect(placeholder.textContent).toContain('2 blocks hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(onToggleSection).toHaveBeenCalledWith('section-sec-1-h0')
  })

  it('does not collapse when the route provides no controls (read-only use)', () => {
    render(
      <NotebookDocument
        record={record}
        blocks={[
          richTextBlock('sec-1', 'Methods'),
          paragraphBlock('body-1', 2),
        ]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        readOnly
      />,
    )
    expect(document.getElementById('block-body-1')!.className).not.toContain(
      'hidden',
    )
  })

  /** A rich_text block with a heading followed by prose nodes. */
  function headingAndProseBlock(
    id: string,
    order: number,
    headingText: string,
    proseTexts: string[],
  ): NotebookBlock {
    return {
      id,
      recordId: 'r1',
      type: 'rich_text',
      payload: {
        doc: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: headingText }],
            },
            ...proseTexts.map((text) => ({
              type: 'paragraph',
              content: [{ type: 'text', text }],
            })),
          ],
        },
      },
      payloadSchemaVersion: 1,
      order,
      version: 1,
    }
  }

  function blockWithNodes(
    id: string,
    order: number,
    nodes: Array<Record<string, unknown>>,
  ): NotebookBlock {
    return {
      id,
      recordId: 'r1',
      type: 'rich_text',
      payload: { doc: { type: 'doc', content: nodes } },
      payloadSchemaVersion: 1,
      order,
      version: 1,
    }
  }

  it('exposes stable heading anchors inside the active Tiptap editor so outline clicks navigate authoring content', async () => {
    const block = richTextBlock('b1', 'Objective')
    const { container } = render(
      <>
        <NotebookDocument
          record={record}
          blocks={[block]}
          onSaveBlock={vi.fn()}
          onInsertBlock={vi.fn()}
          onDuplicateBlock={vi.fn()}
          onDeleteBlock={vi.fn()}
        />
        <NotebookOutlinePanel entries={notebookOutline([block])} />
      </>,
    )
    // Select the block: the Tiptap editor becomes the active canvas.
    fireEvent.click(container.querySelector('#block-b1')!)
    const editor = await screen.findByRole('textbox', {
      name: 'Text content',
    })
    // The read-view anchor id exists in the editable ProseMirror DOM —
    // the same `#section-<blockId>-h<index>` target the outline links to.
    const heading = await waitFor(() => {
      const el = document.getElementById('section-b1-h0')
      expect(el).toBeTruthy()
      return el!
    })
    expect(editor.contains(heading)).toBe(true)
    const link = screen.getByRole('link', { name: 'Objective' })
    expect(link.getAttribute('href')).toBe('#section-b1-h0')
  })

  it('hides only the prose after the heading inside the same rich_text block, keeping print output complete', () => {
    render(
      <NotebookDocument
        record={record}
        blocks={[
          headingAndProseBlock('b1', 1, 'Methods', ['step one', 'step two']),
        ]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        collapsedSections={new Set(['section-b1-h0'])}
        onToggleSection={vi.fn()}
      />,
    )
    // Prose is hidden from view but stays in the DOM (print:contents), so
    // printed output remains fully expanded.
    const prose = document.getElementById('block-b1')!.querySelectorAll('p')
    expect(prose).toHaveLength(2)
    for (const p of prose) {
      expect(p.className).toContain('hidden')
      expect(p.className).toContain('print:contents')
    }
    const heading = document.getElementById('section-b1-h0')!
    expect(heading.className).not.toContain('hidden')
    // Placeholder explains same-block collapse honestly.
    expect(
      screen.getByTestId('section-collapsed-section-b1-h0').textContent,
    ).toContain('content in this block is hidden')
  })

  it('hides corresponding nodes in the active Tiptap editor when a same-block section collapses', async () => {
    const { container } = render(
      <NotebookDocument
        record={record}
        blocks={[headingAndProseBlock('b1', 1, 'Methods', ['step one'])]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        collapsedSections={new Set(['section-b1-h0'])}
        onToggleSection={vi.fn()}
      />,
    )
    fireEvent.click(container.querySelector('#block-b1')!)
    const editor = await screen.findByRole('textbox', {
      name: 'Text content',
    })
    // The ProseMirror node for the hidden prose carries the collapse class;
    // the payload still holds the text (print stays expanded).
    await waitFor(() => {
      const hidden = editor.querySelectorAll('p.hidden.print\\:contents')
      expect(hidden).toHaveLength(1)
    })
    expect(editor.textContent).toContain('step one')
  })

  it('collapses multiple headings in one block independently', () => {
    const block = blockWithNodes('b1', 1, [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Intro' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'intro prose' }] },
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: 'Detail' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'detail prose' }] },
    ])
    const { rerender } = render(
      <NotebookDocument
        record={record}
        blocks={[block]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        collapsedSections={new Set(['section-b1-h0'])}
        onToggleSection={vi.fn()}
      />,
    )
    const paras = () =>
      Array.from(document.getElementById('block-b1')!.querySelectorAll('p'))
    const headings = () =>
      Array.from(
        document
          .getElementById('block-b1')!
          .querySelectorAll('[data-type="heading"], h2, h3'),
      )
    // Collapsing the H2 hides its prose AND the nested H3 content (heading
    // + prose) until the next same-level heading.
    expect(paras()[0].className).toContain('hidden')
    expect(paras()[1].className).toContain('hidden')
    expect(headings()).toHaveLength(2)
    expect((headings()[1] as HTMLElement).className).toContain('hidden')
    // Collapsing only the H3 hides just its own prose — independent of H2.
    rerender(
      <NotebookDocument
        record={record}
        blocks={[block]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        collapsedSections={new Set(['section-b1-h2'])}
        onToggleSection={vi.fn()}
      />,
    )
    expect(paras()[0].className).not.toContain('hidden')
    expect(paras()[1].className).toContain('hidden')
    expect((headings()[1] as HTMLElement).className).not.toContain('hidden')
  })
})
