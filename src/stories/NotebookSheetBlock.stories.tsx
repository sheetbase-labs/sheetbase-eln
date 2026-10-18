import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { NotebookSheetBlock } from '#/components/notebook/notebook-sheet-block'
import type { NotebookBlock, NotebookRecord } from '#/lib/notebook-data'

/**
 * The `sheet` notebook block. It renders frozen evidence when the revision
 * pinned some, states plainly when historical evidence is missing, and only
 * then embeds the live Sheet. The stories cover the first two paths fully and
 * the embed's opening state — the live grid needs a Sheet Instance read.
 */
const block: NotebookBlock = {
  id: '0198d970-e266-4000-8000-0000000000b9',
  recordId: '0198d970-e266-4000-8000-0000000000a1',
  type: 'sheet',
  payload: { instanceId: '0198d970-e266-4000-8000-000000000030' },
  payloadSchemaVersion: 1,
  order: 4,
  version: 1,
}

const record: NotebookRecord = {
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

const meta = {
  title: 'Notebook/Sheet block',
  component: NotebookSheetBlock,
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
        <div className="w-[880px] max-w-full">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: { block, record },
} satisfies Meta<typeof NotebookSheetBlock>
export default meta
type Story = StoryObj<typeof meta>

/** A live block: the Sheet is read from its instance. */
export const LiveEmbed: Story = {}

/** A block whose payload carries no instance says so. */
export const NoInstance: Story = { args: { block: { ...block, payload: {} } } }

/** A locked record must not show live values: evidence or nothing. */
export const LockedWithoutEvidence: Story = {
  args: { record: { ...record, lockedAt: '2026-07-30T09:00:00Z' } },
}

/** Historical evidence was expected but could not be read. */
export const EvidenceUnavailable: Story = {
  args: { frozenEvidence: null },
}

/** Read-only: the live embed is editable only for writers. */
export const ReadOnly: Story = { args: { readOnly: true } }
