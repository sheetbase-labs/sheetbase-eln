import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WithdrawReviewDialog } from './withdraw-review-dialog'
import type * as ReviewWorkspace from '#/lib/review-workspace'
import type { ReviewSubmissionWire } from '#/lib/reviews'

const { withdraw, fetchRevision } = vi.hoisted(() => ({
  withdraw: vi.fn(async () => ({})),
  fetchRevision: vi.fn(async () => ({ integrity_digest: 'a'.repeat(64) })),
}))

vi.mock('#/lib/review-workspace', async (importOriginal) => ({
  ...(await importOriginal<typeof ReviewWorkspace>()),
  withdrawReview: withdraw,
  fetchRevisionRow: fetchRevision,
}))

const submission = {
  id: 'sub-1',
  record_id: 'rec-1',
  revision_id: 'rev-1',
  state: 'submitted',
} as ReviewSubmissionWire

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
      expect(withdraw).toHaveBeenCalledWith(expect.anything(), {
        submissionId: 'sub-1',
        note: 'Wrong plate map',
        expectedRevisionDigest: 'a'.repeat(64),
      }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('stays open and says why when the server refuses', async () => {
    withdraw.mockRejectedValueOnce(new Error('Review already decided'))
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
