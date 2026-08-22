import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SignNotebookDialog } from './sign-notebook-dialog'
import { notebookQueryKeys } from '#/lib/notebook-data'
import { sign002QueryKeys } from '#/lib/sign-002'

const fetchReviewSubmissionByRevision = vi.fn()
const fetchRevisionRow = vi.fn()
const fetchSignaturesForSubmission = vi.fn()
const signRevision = vi.fn()

vi.mock('#/lib/review-workspace', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchReviewSubmissionByRevision: (...args: unknown[]) =>
    fetchReviewSubmissionByRevision(...args),
  fetchRevisionRow: (...args: unknown[]) => fetchRevisionRow(...args),
}))

vi.mock('#/lib/signatures', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchSignaturesForSubmission: (...args: unknown[]) =>
    fetchSignaturesForSubmission(...args),
  signRevision: (...args: unknown[]) => signRevision(...args),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('SignNotebookDialog', () => {
  it('signs an approved revision when the name confirmation matches', async () => {
    const user = userEvent.setup()
    fetchReviewSubmissionByRevision.mockResolvedValue({
      id: 'sub1',
      record_id: 'r1',
      state: 'approved',
      assigned_reviewer_user_ids: ['u1'],
    })
    fetchRevisionRow.mockResolvedValue({
      id: 'rev1',
      integrity_digest: 'abc123digest',
    })
    fetchSignaturesForSubmission.mockResolvedValue([])
    signRevision.mockResolvedValue({ signatureId: 'sig1' })

    renderWithQuery(
      <SignNotebookDialog
        open
        onOpenChange={vi.fn()}
        revisionId="rev1"
        currentUserId="u1"
        currentUserName="Ada Lovelace"
      />,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Signature confirmation')).toBeTruthy()
    })
    await user.type(
      screen.getByLabelText('Signature confirmation'),
      'Ada Lovelace',
    )
    await user.click(screen.getByRole('button', { name: 'Sign' }))
    await waitFor(() => {
      expect(signRevision).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          submissionId: 'sub1',
          confirmationPhrase: 'Ada Lovelace',
          expectedRevisionDigest: 'abc123digest',
        }),
      )
    })
  })

  it('invalidates record, blocks and review queries after a successful signature', async () => {
    const user = userEvent.setup()
    fetchReviewSubmissionByRevision.mockResolvedValue({
      id: 'sub1',
      record_id: 'r1',
      state: 'approved',
      assigned_reviewer_user_ids: ['u1'],
    })
    fetchRevisionRow.mockResolvedValue({
      id: 'rev1',
      integrity_digest: 'abc123digest',
    })
    fetchSignaturesForSubmission.mockResolvedValue([])
    signRevision.mockResolvedValue({ signatureId: 'sig1' })

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    render(
      <QueryClientProvider client={client}>
        <SignNotebookDialog
          open
          onOpenChange={vi.fn()}
          revisionId="rev1"
          currentUserId="u1"
          currentUserName="Ada Lovelace"
        />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Signature confirmation')).toBeTruthy()
    })
    await user.type(
      screen.getByLabelText('Signature confirmation'),
      'Ada Lovelace',
    )
    await user.click(screen.getByRole('button', { name: 'Sign' }))
    await waitFor(() => {
      const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey)
      expect(keys).toContainEqual(notebookQueryKeys.record('r1'))
      expect(keys).toContainEqual(notebookQueryKeys.blocks('r1'))
      expect(keys).toContainEqual(notebookQueryKeys.review('r1'))
      expect(keys).toContainEqual(sign002QueryKeys.timeline('r1'))
    })
  })

  it('explains when review has not finished', async () => {
    fetchReviewSubmissionByRevision.mockResolvedValue({
      id: 'sub1',
      state: 'submitted',
      assigned_reviewer_user_ids: ['u1'],
    })
    fetchRevisionRow.mockResolvedValue({
      id: 'rev1',
      integrity_digest: 'abc123digest',
    })
    fetchSignaturesForSubmission.mockResolvedValue([])

    renderWithQuery(
      <SignNotebookDialog
        open
        onOpenChange={vi.fn()}
        revisionId="rev1"
        currentUserId="u1"
        currentUserName="Ada Lovelace"
      />,
    )

    await waitFor(() => {
      expect(
        screen.getByText(
          'Review must finish before this Notebook can be signed.',
        ),
      ).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull()
  })
})
