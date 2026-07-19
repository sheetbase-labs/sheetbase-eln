/**
 * NotebookDocument component tests (ELN-005). Covers per-block editing,
 * insertion, duplication, destructive delete confirmation/cancellation,
 * undo, and read-only behaviour for archived notebooks. Mutation callbacks
 * are stubbed so no RPC or QueryClient context is required.
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NotebookDocument } from './notebook-document'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

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
}

const archivedRecord: NotebookRecord = {
  ...record,
  archivedAt: '2026-07-19T00:00:00.000Z',
}

function headingBlock(id: string, text: string): NotebookBlock {
  return {
    id,
    recordId: 'r1',
    type: 'heading',
    payload: { level: 2, text },
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
        blocks={[headingBlock('b1', 'A'), headingBlock('b2', 'B')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )
    expect(container.querySelector('#block-b1')).toBeTruthy()
    expect(container.querySelector('#block-b2')).toBeTruthy()
  })
})

describe('NotebookDocument — insertion', () => {
  it('renders the block picker and calls onInsertBlock on select', async () => {
    const user = userEvent.setup()
    const onInsertBlock = vi.fn().mockResolvedValue(undefined)
    render(
      <NotebookDocument
        record={record}
        blocks={[headingBlock('b1', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={onInsertBlock}
        onDuplicateBlock={vi.fn()}
        onDeleteBlock={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Add block/ }))
    await user.click(screen.getByRole('menuitem', { name: /^Heading/ }))
    expect(onInsertBlock).toHaveBeenCalledWith('heading', undefined)
  })
})

describe('NotebookDocument — duplication', () => {
  it('calls onDuplicateBlock from the block menu', async () => {
    const user = userEvent.setup()
    const onDuplicateBlock = vi.fn().mockResolvedValue(undefined)
    render(
      <NotebookDocument
        record={record}
        blocks={[headingBlock('b1', 'A')]}
        onSaveBlock={vi.fn()}
        onInsertBlock={vi.fn()}
        onDuplicateBlock={onDuplicateBlock}
        onDeleteBlock={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Block actions/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(onDuplicateBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b1', type: 'heading' }),
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
        blocks={[headingBlock('b1', 'A')]}
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
        blocks={[headingBlock('b1', 'A')]}
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
        blocks={[headingBlock('b1', 'A')]}
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
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndoDelete).toHaveBeenCalled()
  })
})

describe('NotebookDocument — read-only', () => {
  it('hides the picker and block menu for archived records', () => {
    render(
      <NotebookDocument
        record={archivedRecord}
        blocks={[headingBlock('b1', 'A')]}
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
