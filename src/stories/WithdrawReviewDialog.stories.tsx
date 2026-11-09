import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { Meta, StoryObj } from '@storybook/tanstack-react'

import { Button } from '#/components/ui/button'
import { WithdrawReviewDialog } from '#/components/notebook/withdraw-review-dialog'

import { screenQueryClient } from './screen-stories'

/**
 * Taking a notebook back out of review from the notebook itself. Confirming
 * would read the revision and write a decision, which a story never sends. The
 * dialog is portalled, so the story owns the trigger and opens it.
 */
const client = screenQueryClient()

const submission = {
  id: 'submission-1',
  workspace_id: 'workspace',
  record_id: 'record-1',
  revision_id: 'revision-1',
  state: 'submitted',
  workflow_definition_key: 'experiment-review',
  workflow_definition_version: 1,
  assigned_reviewer_user_ids: ['user-2'],
  submitted_by_user_id: 'user-1',
  submitted_session_id: 'session-1',
  submitted_role: 'scientist',
  submitted_at: '2026-10-20T09:00:00Z',
  due_at: null,
  idempotency_key: 'k1',
  created_at: '2026-10-20T09:00:00Z',
  updated_at: '2026-10-20T09:00:00Z',
}

function Harness() {
  const [open, setOpen] = useState(true)

  return (
    <QueryClientProvider client={client}>
      <Button onClick={() => setOpen(true)}>Withdraw from review</Button>
      <WithdrawReviewDialog
        open={open}
        onOpenChange={setOpen}
        submission={submission}
      />
    </QueryClientProvider>
  )
}

const meta = {
  title: 'Notebook/Withdraw review dialog',
  component: WithdrawReviewDialog,
  tags: ['autodocs'],
  args: { open: true, onOpenChange: () => {}, submission },
} satisfies Meta<typeof WithdrawReviewDialog>

export default meta

type Story = StoryObj<typeof meta>

/** Open: the optional note and the two choices. */
export const Open: Story = { render: () => <Harness /> }
