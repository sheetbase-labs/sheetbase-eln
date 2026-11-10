import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WithdrawReviewDialog } from './withdraw-review-dialog'
import { createDataClient } from '#/lib/data-client'
import type { ReviewSubmissionWire } from '#/lib/reviews'

const transport = vi.fn<typeof fetch>()
let refused = false

beforeEach(() => {
  refused = false
  transport.mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    switch (url.pathname) {
      case '/api/db/revisions':
        return Response.json([{ integrity_digest: 'a'.repeat(64) }])
      case '/api/db/revision_sheet_evidence':
        return Response.json([])
      case '/api/db/rpc/withdraw_review':
        return refused
          ? Response.json(
              { error: { code: 'conflict', message: 'Review already decided' } },
              { status: 409 },
            )
          : Response.json({})
      default:
        throw new Error(`Unexpected request: ${url.pathname}`)
    }
  })
})

const submission: ReviewSubmissionWire = {
  id: 'sub-1',
  workspace_id: 'workspace-1',
  record_id: 'rec-1',
  revision_id: 'rev-1',
  state: 'submitted',
  workflow_definition_key: 'scientific-review',
  workflow_definition_version: 1,
  assigned_reviewer_user_ids: ['reviewer-1'],
  submitted_by_user_id: 'author-1',
  submitted_session_id: 'session-1',
  submitted_role: 'member',
  submitted_at: '2026-10-02T09:00:00Z',
  due_at: null,
  idempotency_key: 'submission-1',
  created_at: '2026-10-02T09:00:00Z',
  updated_at: '2026-10-02T09:00:00Z',
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WithdrawReviewDialog
        open
        onOpenChange={onOpenChange}
        submission={submission}
        client={createDataClient(transport)}
      />
    </QueryClientProvider>,
  )

  return onOpenChange
}

describe('WithdrawReviewDialog', () => {
  it('states what withdrawing does before it happens', () => {
    renderDialog()
    expect(
      screen.getByText(/Withdraws the submission from review/),
    ).toBeTruthy()
    expect(screen.getByText(/disappear from their Inbox/)).toBeTruthy()
  })

  it('withdraws against the digest of the revision under review and closes', async () => {
    const onOpenChange = renderDialog()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Withdraw note'), 'Wrong plate map')
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))
    await waitFor(() =>
      expect(transport).toHaveBeenCalledWith(
        '/api/db/rpc/withdraw_review',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            p_submission_id: 'sub-1',
            p_note: 'Wrong plate map',
            p_expected_state: 'submitted',
            p_expected_revision_digest: 'a'.repeat(64),
          }),
        }),
      ),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('stays open and says why when the server refuses', async () => {
    refused = true
    const onOpenChange = renderDialog()
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Withdraw' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Review already decided',
    )
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
