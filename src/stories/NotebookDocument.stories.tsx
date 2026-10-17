import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotebookDocument } from '#/components/notebook/notebook-document'
import type { SaveResult } from '#/components/notebook/use-autosave'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

/**
 * The notebook canvas. It renders the record's blocks and hands every write
 * to the route through its callbacks — the stories supply those callbacks and
 * resolve them locally, so the document below is a real render of static
 * blocks with no request issued.
 */
const RECORD_ID = '0198d970-e266-4000-8000-0000000000a1'

const record: NotebookRecord = {
  id: RECORD_ID,
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

function prose(id: string, order: number, text: string): NotebookBlock {
  return {
    id,
    recordId: RECORD_ID,
    type: 'rich_text',
    payload: {
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    },
    payloadSchemaVersion: 1,
    order,
    version: 1,
  }
}

const blocks: NotebookBlock[] = [
  prose(
    '0198d970-e266-4000-8000-0000000000b1',
    0,
    'Cells were seeded at 2.0 × 10⁶ cells/mL and incubated at 37 °C.',
  ),
  {
    id: '0198d970-e266-4000-8000-0000000000b2',
    recordId: RECORD_ID,
    type: 'metric',
    payload: { label: 'Viability', value: 91.4, unit: '%' },
    payloadSchemaVersion: 1,
    order: 1,
    version: 1,
  },
  {
    id: '0198d970-e266-4000-8000-0000000000b3',
    recordId: RECORD_ID,
    type: 'callout',
    payload: {
      text: 'Control wells remained below the detection threshold.',
      variant: 'info',
    },
    payloadSchemaVersion: 1,
    order: 2,
    version: 1,
  },
  prose(
    '0198d970-e266-4000-8000-0000000000b4',
    3,
    'Harvest at 72 h and measure genome titre.',
  ),
]

async function onSaveBlock(): Promise<SaveResult<Record<string, unknown>>> {
  return { ok: true }
}

const meta = {
  title: 'Notebook/Document',
  component: NotebookDocument,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false, queryFn: () => new Promise(() => {}) },
            },
          })
        }
      >
        <div className="w-[820px] max-w-full rounded-md border border-border">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    record,
    blocks,
    onSaveBlock,
    onInsertBlock: async () => undefined,
    onDuplicateBlock: async () => undefined,
    onDeleteBlock: async () => {},
  },
} satisfies Meta<typeof NotebookDocument>
export default meta
type Story = StoryObj<typeof meta>

/** A short document: prose, a metric and a callout. */
export const Default: Story = {}

/** An empty notebook states that it has no blocks yet. */
export const Empty: Story = { args: { blocks: [] } }

/** Read-only: a submitted or archived notebook renders without editing. */
export const ReadOnly: Story = { args: { readOnly: true } }

/** Offline holds autosaves rather than losing the writer's edits. */
export const Offline: Story = { args: { offline: true } }

/** Movement affordances (drag and keyboard) appear only when the route can
 * move blocks. */
export const Movable: Story = {
  args: { onMoveBlock: async () => {} },
}

/** A locked record is read-only however the route mounts the canvas. */
export const Locked: Story = {
  args: { record: { ...record, lockedAt: '2026-07-30T09:00:00Z' } },
}
