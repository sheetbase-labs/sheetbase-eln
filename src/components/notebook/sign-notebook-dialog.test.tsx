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
const fetchWorkspaceCertifications = vi.fn()
const signRevision = vi.fn()
const requestSignatureStepUp = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to?: string
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={typeof to === 'string' ? to : '#'} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('#/lib/signature-certification', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceCertifications: (...args: unknown[]) =>
    fetchWorkspaceCertifications(...args),
}))

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

function certifiedCertification(userId: string) {
  return {
    userId,
    name: 'Ada Lovelace',
    statementVersion: 1,
    certifiedAt: '2026-10-04T12:01:00Z',
    revokedAt: null,
    identityVerifiedAt: '2026-10-04T12:00:00Z',
    identityVerifiedBy: 'admin',
    verifiedEmail: 'ada@sheetbase.test',
    verificationRequested: false,
    authMethod: 'password',
  }
}

beforeEach(() => {
  fetchSignatureEligibility.mockResolvedValue({ writer: true, requests: [] })
  fetchWorkspaceCertifications.mockResolvedValue([certifiedCertification('u1')])
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
  // R5-NOTE-02: the Notebook flow now renders the one shared ESignDialog. The
  // step-up and the sign_revision write are unchanged; this pins the shared
  // affordances (attestation statement + server time) onto the flow.
  it('renders the shared e-sign dialog affordances', async () => {
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

    renderWithQuery(
      <SignNotebookDialog
        open
        onOpenChange={vi.fn()}
        revisionId="rev1"
        currentUserId="u1"
        currentUserName="Ada Lovelace"
      />,
    )

    expect(
      await screen.findByText('Recorded as server time when you sign'),
    ).toBeTruthy()
    expect(
      await screen.findByText(/internal attestation, not a regulatory compliance/),
    ).toBeTruthy()
  })

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

  function mockSignableSubmission() {
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
  }

  function renderSignDialog(onOpenChange: (open: boolean) => void = vi.fn()) {
    return renderWithQuery(
      <SignNotebookDialog
        open
        onOpenChange={onOpenChange}
        revisionId="rev1"
        currentUserId="u1"
        currentUserName="Ada Lovelace"
      />,
    )
  }

  it('REV-03.4 puts initial focus in the signing password field when it opens', async () => {
    mockSignableSubmission()
    renderSignDialog()

    const password = await screen.findByLabelText('Signing password')
    await waitFor(() => {
      expect(document.activeElement).toBe(password)
    })
  })

  it('REV-03.4 shows the meaning, the bound revision and the password re-entry requirement', async () => {
    mockSignableSubmission()
    renderSignDialog()

    const select = await screen.findByLabelText('Signature meaning')
    expect(select).toHaveProperty('value', 'reviewed-and-approved')
    expect(screen.getByText('Meaning').nextElementSibling?.textContent).toBe(
      'Reviewed and approved',
    )
    expect(
      screen.getByText(/approve it as the authoritative record for locking/),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /Re-enter your local signing password for this signature/,
      ),
    ).toBeTruthy()
    // The revision the signature binds is identified by digest as well as id.
    expect(screen.getByText('abc123digest')).toBeTruthy()
  })

  it('REV-03.4 submits on Enter from the confirmation field', async () => {
    const user = userEvent.setup()
    mockSignableSubmission()
    renderSignDialog()

    await user.type(
      await screen.findByLabelText('Signing password'),
      'local-signing-password',
    )
    await user.type(
      screen.getByLabelText('Signature confirmation'),
      'Ada Lovelace',
    )
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(signRevision).toHaveBeenCalledTimes(1)
    })
    expect(requestSignatureStepUp).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'sign',
        password: 'local-signing-password',
      }),
    )
  })

  it('REV-03.4 cancels on Escape without signing', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    mockSignableSubmission()
    renderSignDialog(onOpenChange)

    await screen.findByLabelText('Signing password')
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
    expect(signRevision).not.toHaveBeenCalled()
  })

  it('REV-03.4 traps focus inside the dialog while open', async () => {
    const user = userEvent.setup()
    mockSignableSubmission()
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    render(
      <QueryClientProvider client={client}>
        <button type="button">Outside the dialog</button>
        <SignNotebookDialog
          open
          onOpenChange={vi.fn()}
          revisionId="rev1"
          currentUserId="u1"
          currentUserName="Ada Lovelace"
        />
      </QueryClientProvider>,
    )

    const password = await screen.findByLabelText('Signing password')
    const dialog = screen.getByRole('dialog')
    const outside = screen.getByRole('button', {
      name: 'Outside the dialog',
      hidden: true,
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(password)
    })

    for (let index = 0; index < 8; index += 1) {
      await user.tab()
      await waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true)
      })
      expect(document.activeElement).not.toBe(outside)
    }
  })

  it('REV-03.3 tells an uncertified signer certification is required before signing', async () => {
    mockSignableSubmission()
    fetchWorkspaceCertifications.mockResolvedValue([
      {
        ...certifiedCertification('u1'),
        statementVersion: null,
        certifiedAt: null,
        identityVerifiedAt: null,
        authMethod: null,
      },
    ])
    renderSignDialog()

    await screen.findByText(/Certification is required before you can sign/)
    expect(
      screen
        .getByRole('link', { name: 'Open signature settings' })
        .getAttribute('href'),
    ).toBe('/settings/signatures')
    // No password field and no Sign button: the attempt cannot be started.
    expect(screen.queryByLabelText('Signing password')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull()
    expect(signRevision).not.toHaveBeenCalled()
  })

  it('REV-03.3 does not treat a revoked certification as current before signing', async () => {
    mockSignableSubmission()
    fetchWorkspaceCertifications.mockResolvedValue([
      {
        ...certifiedCertification('u1'),
        revokedAt: '2026-10-05T09:00:00Z',
      },
    ])
    renderSignDialog()

    await screen.findByText(/Certification is required before you can sign/)
    expect(screen.queryByLabelText('Signing password')).toBeNull()
    expect(signRevision).not.toHaveBeenCalled()
  })
})
