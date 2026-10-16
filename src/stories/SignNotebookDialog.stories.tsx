import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { SignNotebookDialog } from '#/components/notebook/sign-notebook-dialog'
import { reviewWorkspaceQueryKeys } from '#/lib/review-workspace'

/**
 * The notebook's signing entry point. Opening it reads the revision's
 * submission, revision and signatures, so the stories seed those reads (or
 * leave them pending) — in every case the dialog renders the shared signing
 * form, which is covered in full by `ESignDialog.stories.tsx`.
 */
const REVISION_ID = '0198d970-e266-4000-8000-000000000071'

function client(state: 'ready' | 'loading' | 'error') {
  if (state === 'error') {
    return new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: () => Promise.reject(new Error('offline')),
        },
      },
    })
  }
  const instance = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  if (state === 'ready') {
    instance.setQueryData(
      reviewWorkspaceQueryKeys.submissionForRevision(REVISION_ID),
      null,
    )
    instance.setQueryData(reviewWorkspaceQueryKeys.revision(REVISION_ID), {
      id: REVISION_ID,
      record_id: '0198d970-e266-4000-8000-0000000000a1',
      structure_version: 4,
      metadata_version: 2,
      metadata_snapshot: { title: 'Virus stability at 4 °C' },
      block_snapshot: [],
      reason: 'Submitted for scientific review',
      superseded_by_revision_id: null,
      created_at: '2026-07-29T14:03:00Z',
      created_by_user_id: 'user-1',
    })
  }
  return instance
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
        Sign notebook
      </button>
      <SignNotebookDialog
        open={open}
        onOpenChange={setOpen}
        revisionId={REVISION_ID}
        currentUserId="user-1"
        currentUserName="Ava Chen"
      />
    </div>
  )
}

function withClient(state: 'ready' | 'loading' | 'error') {
  return (Story: () => React.ReactNode) => (
    <QueryClientProvider client={client(state)}>
      <div className="p-6">
        <Story />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Notebook/Sign notebook dialog',
  component: SignNotebookDialog,
  tags: ['autodocs'],
  decorators: [withClient('ready')],
  args: {
    open: false,
    onOpenChange: () => {},
    revisionId: REVISION_ID,
    currentUserId: 'user-1',
    currentUserName: 'Ava Chen',
  },
} satisfies Meta<typeof SignNotebookDialog>
export default meta
type Story = StoryObj<typeof meta>

/** Closed: the dialog renders nothing until the writer asks to sign. */
export const Default: Story = { render: () => <Harness /> }

/** Opened against a revision whose submission and signatures were read. */
export const Open: Story = { render: () => <Harness initiallyOpen /> }

/** While the revision read is in flight the dialog states it. */
export const Loading: Story = {
  decorators: [withClient('loading')],
  render: () => <Harness initiallyOpen />,
}

/** A refused read leaves signing unavailable rather than silently so. */
export const ReadError: Story = {
  decorators: [withClient('error')],
  render: () => <Harness initiallyOpen />,
}
