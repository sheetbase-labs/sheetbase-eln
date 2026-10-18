import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SubmitNotebookDialog } from '#/components/notebook/submit-notebook-dialog'
import type { NotebookRecord } from '#/lib/notebook-data'

/**
 * NOTE-04 submission dialog. Opening it reads the available review workflows
 * and the workspace members, and it binds the submission to a snapshot of the
 * live record, so the stories supply both the record facts and the clients.
 */
const RECORD_ID = '0198d970-e266-4000-8000-0000000000a1'
const WORKSPACE_ID = '0198d970-e266-4000-8000-00000000ffff'

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

function Harness({ initiallyOpen }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(initiallyOpen))
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="rounded-md border px-3 py-1 text-sm"
        onClick={() => setOpen(true)}
      >
        Submit for review
      </button>
      <SubmitNotebookDialog
        open={open}
        onOpenChange={setOpen}
        recordId={RECORD_ID}
        projectId={record.projectId!}
        reviewerUserId="user-2"
        workspaceId={WORKSPACE_ID}
        record={record}
        blocks={[]}
      />
    </div>
  )
}

const meta = {
  title: 'Notebook/Submit notebook dialog',
  component: SubmitNotebookDialog,
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
        <div className="p-6">
          <Story />
        </div>
      </QueryClientProvider>
    ),
  ],
  args: {
    open: false,
    onOpenChange: () => {},
    recordId: RECORD_ID,
    projectId: '0198d970-e266-4000-8000-0000000000b1',
    reviewerUserId: 'user-2',
    workspaceId: WORKSPACE_ID,
    record,
    blocks: [],
  },
} satisfies Meta<typeof SubmitNotebookDialog>
export default meta
type Story = StoryObj<typeof meta>

/** Closed: nothing is rendered until the writer submits. */
export const Default: Story = { render: () => <Harness /> }

/** Open: the reviewer, workflow and submission reason. */
export const Open: Story = { render: () => <Harness initiallyOpen /> }

/** Unsaved work blocks a clean snapshot, and the dialog says so. */
export const WithUnsavedWork: Story = {
  args: { hasUnsavedWork: true },
  render: () => <Harness initiallyOpen />,
}

/** An archived record cannot be submitted. */
export const Archived: Story = {
  args: { archivedAt: '2026-08-01T09:00:00Z' },
  render: () => <Harness initiallyOpen />,
}

/** A record already under review says so instead of offering a second one. */
export const AlreadyInReview: Story = {
  args: { activeReview: true },
  render: () => <Harness initiallyOpen />,
}
