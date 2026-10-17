import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { DuplicateNotebookDialog } from '#/components/notebook/duplicate-notebook-dialog'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

/**
 * Duplicating a notebook. The dialog suggests a title derived from the source
 * and copies the blocks the caller supplies, so the stories pass a small
 * document and record what the caller receives. The copy is a mutation, so the
 * stories supply the client the router would.
 */
const source: NotebookRecord = {
  id: '0198d970-e266-4000-8000-0000000000a1',
  projectId: '0198d970-e266-4000-8000-0000000000b1',
  kind: 'experiment',
  identifier: 'EXP-2026-0042',
  title: 'Virus stability at 4 °C',
  status: 'draft',
  tags: [],
  structureVersion: 3,
  metadataVersion: 2,
  createdAt: '2026-07-29T09:00:00Z',
  updatedAt: '2026-07-29T14:00:00Z',
  archivedAt: null,
  deletedAt: null,
  createdByUserId: 'user-1',
  updatedByUserId: null,
  properties: {},
  lockedAt: null,
  lockedByRevisionId: null,
}

const blocks: NotebookBlock[] = [
  {
    id: '0198d970-e266-4000-8000-0000000000b1',
    recordId: source.id,
    type: 'rich_text',
    payload: {
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Cells were incubated at 37 °C.' }],
          },
        ],
      },
    },
    payloadSchemaVersion: 1,
    order: 0,
    version: 1,
  },
  {
    id: '0198d970-e266-4000-8000-0000000000b2',
    recordId: source.id,
    type: 'metric',
    payload: { label: 'Viability', value: 91.4, unit: '%' },
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  },
]

const meta = {
  title: 'Notebook/Duplicate notebook dialog',
  component: DuplicateNotebookDialog,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { mutations: { retry: false } } })
        }
      >
        <div className="p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    open: true,
    onOpenChange: () => {},
    source,
    blocks,
    onDuplicated: () => {},
  },
} satisfies Meta<typeof DuplicateNotebookDialog>
export default meta
type Story = StoryObj<typeof meta>

/** Open: the suggested title and the project the copy lands in. */
export const Open: Story = {
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <DuplicateNotebookDialog
        open={open}
        onOpenChange={setOpen}
        source={source}
        blocks={blocks}
        onDuplicated={() => setOpen(false)}
      />
    )
  },
}

/** An empty notebook still duplicates: the copy has no blocks to carry. */
export const NoBlocks: Story = {
  args: { blocks: [] },
  render: () => {
    const [open, setOpen] = useState(true)
    return (
      <DuplicateNotebookDialog
        open={open}
        onOpenChange={setOpen}
        source={source}
        blocks={[]}
        onDuplicated={() => setOpen(false)}
      />
    )
  },
}

/** Closed: no copy is offered until the writer asks for one. */
export const Closed: Story = {
  args: { open: false },
  render: () => {
    const [open, setOpen] = useState(false)
    return (
      <DuplicateNotebookDialog
        open={open}
        onOpenChange={setOpen}
        source={source}
        blocks={blocks}
        onDuplicated={() => {}}
      />
    )
  },
}
