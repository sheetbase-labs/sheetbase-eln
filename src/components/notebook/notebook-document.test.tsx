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
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

beforeAll(() => {
  document.elementFromPoint = () => null
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
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
    await user.click(screen.getByRole('button', { name: /Add block/ }))
    await user.click(screen.getByRole('menuitem', { name: /^Text/ }))
    expect(onInsertBlock).toHaveBeenCalledWith('rich_text', undefined)
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

    const { container } = render(<SoleEmptyBlockHarness />)
    await user.click(container.querySelector('#block-only-block')!)
    const editor = await screen.findByRole('textbox', { name: 'Text content' })
    await waitFor(() => expect(editor).toBe(document.activeElement))

    await user.keyboard('{Backspace}')

    await waitFor(() => {
      expect(onDeleteBlock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'only-block' }),
      )
      expect(screen.getByText('Start this Notebook')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Start writing' })).toBe(
        document.activeElement,
      )
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
    await user.click(screen.getByRole('menuitem', { name: /^Checklist/ }))
    expect(onInsertBlock).toHaveBeenCalledWith('checklist', 'b1')
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
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
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
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
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
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
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
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Block deleted.')).toBeTruthy()
    const undoDelete = screen
      .getAllByRole('button', { name: 'Undo' })
      .find((button) => !button.hasAttribute('disabled'))
    expect(undoDelete).toBeTruthy()
    await user.click(undoDelete!)
    expect(onUndoDelete).toHaveBeenCalled()
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

function moveMenuItems(): HTMLElement[] {
  return screen.getAllByRole('menuitem', { name: /^Move (up|down)$/ })
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
    const moves = moveMenuItems()
    expect(moves.length).toBeGreaterThanOrEqual(1)
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
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
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }))
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
    await user.click(screen.getByRole('menuitem', { name: 'Move up' }))
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
    const up = screen.getByRole('menuitem', {
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
      screen.getByRole('menuitem', { name: 'Insert text below' }),
    )
    expect(onInsertBlock).toHaveBeenCalledWith('rich_text', 'b2')
  })
})

describe('NotebookDocument — movement via keyboard', () => {
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
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
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
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
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
    await user.click(screen.getByRole('menuitem', { name: 'Move down' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('[data-move-error="generic"]')).toBeTruthy()
    expect(screen.getByText('network down')).toBeTruthy()
  })
})

describe('NotebookDocument — drag and drop', () => {
  /** Minimal DataTransfer stub jsdom does not provide. */
  function makeDataTransfer() {
    const store = new Map<string, string>()
    return {
      effectAllowed: 'uninitialized',
      dropEffect: 'none',
      setData: (t: string, v: string) => store.set(t, v),
      getData: (t: string) => store.get(t) ?? '',
      types: Array.from(store.keys()),
    }
  }

  /** Build a drag-event MouseEvent with a clientY and dataTransfer. jsdom
   * lacks a DragEvent constructor and fireEvent.dragOver does not propagate
   * clientY, so we create a MouseEvent and pass it through fireEvent. */
  function dragEvent(type: 'dragover' | 'drop' | 'dragenter', clientY: number) {
    const evt = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientY,
    })
    Object.defineProperty(evt, 'dataTransfer', { value: makeDataTransfer() })
    return evt
  }

  function mockRect(el: HTMLElement, top: number, height: number) {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top,
      height,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => '',
    })
  }

  it('renders a drag handle on each editable block', () => {
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
    const handles = screen.getAllByRole('button', { name: 'Drag block' })
    expect(handles).toHaveLength(3)
    expect(handles[0].getAttribute('draggable')).toBe('true')
  })

  it('shows an insertion indicator above the target on drag-over and moves on drop', () => {
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
    const handleB1 = screen.getAllByRole('button', { name: 'Drag block' })[0]
    const rowB3 = container.querySelector('#block-b3') as HTMLElement
    mockRect(rowB3, 100, 50) // midpoint at y=125
    const dt1 = makeDataTransfer()
    fireEvent.dragStart(handleB1, { dataTransfer: dt1 })
    // Pointer at y=110 (top half of b3) → drop above b3 → after=b2, before=b3.
    fireEvent(rowB3, dragEvent('dragenter', 110))
    fireEvent(rowB3, dragEvent('dragover', 110))
    const indicator = container.querySelector('[data-drop-indicator="above"]')
    expect(indicator).toBeTruthy()
    fireEvent(rowB3, dragEvent('drop', 110))
    expect(onMoveBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1' }),
      expect.objectContaining({ afterBlockId: 'b2', beforeBlockId: 'b3' }),
    )
  })

  it('drops below the target when the pointer is in the bottom half', () => {
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
    const handleB1 = screen.getAllByRole('button', { name: 'Drag block' })[0]
    const rowB2 = container.querySelector('#block-b2') as HTMLElement
    mockRect(rowB2, 100, 50) // midpoint at y=125
    fireEvent.dragStart(handleB1, { dataTransfer: makeDataTransfer() })
    // Pointer at y=140 (bottom half of b2) → drop below b2 → after=b2, before=b3.
    fireEvent(rowB2, dragEvent('dragover', 140))
    fireEvent(rowB2, dragEvent('drop', 140))
    expect(onMoveBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1' }),
      expect.objectContaining({ afterBlockId: 'b2', beforeBlockId: 'b3' }),
    )
  })

  it('shows a below indicator when dropping at the end of the list', () => {
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
    const handleB1 = screen.getAllByRole('button', { name: 'Drag block' })[0]
    const rowB3 = container.querySelector('#block-b3') as HTMLElement
    mockRect(rowB3, 100, 50)
    fireEvent.dragStart(handleB1, { dataTransfer: makeDataTransfer() })
    // Pointer at y=140 (bottom half of b3, the last block) → after=b3, before=null → end.
    fireEvent(rowB3, dragEvent('dragover', 140))
    const below = container.querySelector('[data-drop-indicator="below"]')
    expect(below).toBeTruthy()
    fireEvent(rowB3, dragEvent('drop', 140))
    expect(onMoveBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1' }),
      expect.objectContaining({ afterBlockId: 'b3', beforeBlockId: null }),
    )
  })

  it('ignores drops when no drag is in flight', () => {
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
    const rowB2 = container.querySelector('#block-b2') as HTMLElement
    fireEvent(rowB2, dragEvent('drop', 0))
    expect(onMoveBlock).not.toHaveBeenCalled()
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
})
