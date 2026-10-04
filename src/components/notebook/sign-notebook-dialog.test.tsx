import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SignNotebookDialog } from './sign-notebook-dialog'
import { notebookQueryKeys } from '#/lib/notebook-data'
import { sign002QueryKeys } from '#/lib/sign-002'

const fetchReviewSubmissionByRevision = vi.fn()
const fetchRevisionRow = vi.fn()
const fetchSignaturesForSubmission = vi.fn()
const fetchSignatureEligibility = vi.fn()
const signRevision = vi.fn()
const requestSignatureStepUp = vi.fn()

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
  fetchSignatureEligibility: (...args: unknown[]) =>
    fetchSignatureEligibility(...args),
  signRevision: (...args: unknown[]) => signRevision(...args),
  requestSignatureStepUp: (...args: unknown[]) =>
    requestSignatureStepUp(...args),
}))

beforeEach(() => {
  fetchSignatureEligibility.mockResolvedValue({ writer: true, requests: [] })
  requestSignatureStepUp.mockResolvedValue({
    token: 'one-use-password-token',
    authMethod: 'password',
    expiresAt: '2026-10-04T14:00:00Z',
  })
})
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
  it('focuses password and signs only after password step-up and matching confirmation', async () => {
    const user = userEvent.setup()
    fetchReviewSubmissionByRevision.mockResolvedValue({
      id: 'sub1',
      workspace_id: 'ws1',
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
    expect(document.activeElement).toBe(
      screen.getByLabelText('Signing password'),
    )
    expect(
      screen.queryByRole('option', { name: 'Approve for record' }),
    ).toBeNull()
    expect(screen.queryByRole('option', { name: /^Witness$/ })).toBeNull()
    await user.selectOptions(
      screen.getByLabelText('Signature meaning'),
      'reviewed',
    )
    await user.type(
      screen.getByLabelText('Signature confirmation'),
      'Ada Lovelace',
    )
    expect(
      screen.getByRole('button', { name: 'Sign' }).hasAttribute('disabled'),
    ).toBe(true)
    await user.type(
      screen.getByLabelText('Signing password'),
      'local-signing-password',
    )
    await user.click(screen.getByRole('button', { name: 'Sign' }))
    await waitFor(() => {
      expect(signRevision).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          submissionId: 'sub1',
          signatureMeaning: 'reviewed',
          confirmationPhrase: 'Ada Lovelace',
          expectedRevisionDigest: 'abc123digest',
          signingToken: 'one-use-password-token',
        }),
      )
    })
    expect(requestSignatureStepUp).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      purpose: 'sign',
      submissionId: 'sub1',
      revisionDigest: 'abc123digest',
      signatureMeaning: 'reviewed',
      password: 'local-signing-password',
    })
    expect(screen.getByLabelText('Signing password')).toHaveProperty(
      'value',
      '',
    )
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
    await user.type(
      screen.getByLabelText('Signing password'),
      'local-signing-password',
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

  it('offers Reviewed without approval or witness authority while review is active', async () => {
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

    await screen.findByRole('option', { name: 'Reviewed' })
    expect(screen.getByLabelText('Signature meaning')).toHaveProperty(
      'value',
      'reviewed',
    )
    expect(
      screen.queryByRole('option', {
        name: 'Reviewed and approved',
      }),
    ).toBeNull()
    expect(screen.queryByRole('option', { name: 'Witnessed' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('never sends a signing RPC after password denial and clears the attempted password', async () => {
    const user = userEvent.setup()
    fetchReviewSubmissionByRevision.mockResolvedValue({
      id: 'sub1',
      workspace_id: 'ws1',
      record_id: 'r1',
      state: 'approved',
      assigned_reviewer_user_ids: ['u1'],
    })
    fetchRevisionRow.mockResolvedValue({
      id: 'rev1',
      integrity_digest: 'abc123digest',
    })
    fetchSignaturesForSubmission.mockResolvedValue([])
    requestSignatureStepUp.mockRejectedValue(
      new Error(
        'Signing is locked for 15 minutes after three failed attempts.',
      ),
    )
    renderWithQuery(
      <SignNotebookDialog
        open
        onOpenChange={vi.fn()}
        revisionId="rev1"
        currentUserId="u1"
        currentUserName="Ada Lovelace"
      />,
    )
    await screen.findByLabelText('Signing password')
    await user.type(
      screen.getByLabelText('Signing password'),
      'not-the-password',
    )
    await user.type(
      screen.getByLabelText('Signature confirmation'),
      'Ada Lovelace',
    )
    await user.click(screen.getByRole('button', { name: 'Sign' }))
    await screen.findByText(
      'Signing is locked for 15 minutes after three failed attempts.',
    )
    expect(signRevision).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Signing password')).toHaveProperty(
      'value',
      '',
    )
  })
})
