import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SignNotebookDialog } from './sign-notebook-dialog'
import { notebookQueryKeys } from '#/lib/notebook-data'
import type { RevisionWire } from '#/lib/notebook-data'
import type { ReviewSubmissionWire } from '#/lib/reviews'
import type { WorkspaceCertification } from '#/lib/signature-certification'
import { dropSharedReads } from '#/lib/data-client'
import { sign002QueryKeys } from '#/lib/sign-002'

const transport = vi.hoisted(() => {
  const http = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', http)

  return http
})

const baseSubmission: ReviewSubmissionWire = {
  id: 'sub1',
  workspace_id: 'ws1',
  record_id: 'r1',
  revision_id: 'rev1',
  state: 'approved',
  assigned_reviewer_user_ids: ['u1'],
  workflow_definition_key: 'scientific-review',
  workflow_definition_version: 1,
  submitted_by_user_id: 'author',
  submitted_session_id: 'session',
  submitted_role: 'member',
  submitted_at: '2026-10-04T12:00:00Z',
  due_at: null,
  idempotency_key: 'submission-1',
  created_at: '2026-10-04T12:00:00Z',
  updated_at: '2026-10-04T12:00:00Z',
}

const baseRevision: RevisionWire = {
  id: 'rev1',
  record_id: 'r1',
  structure_version: 1,
  metadata_version: 1,
  metadata_snapshot: {},
  block_snapshot: [],
  reason: 'submit',
  superseded_by_revision_id: null,
  created_at: '2026-10-04T12:00:00Z',
  created_by_user_id: 'author',
  integrity_digest: 'abc123digest',
}

let submission = baseSubmission
let revision = baseRevision
let certifications: WorkspaceCertification[] = []
let checksUnavailable = true
let stepUpDenied = false

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
  dropSharedReads()
  submission = baseSubmission
  revision = baseRevision
  certifications = [certifiedCertification('u1')]
  checksUnavailable = true
  stepUpDenied = false
  transport.mockReset()
  transport.mockImplementation(async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      'http://localhost',
    )

    switch (url.pathname) {
      case '/api/db/review_submissions':
        return Response.json([submission])
      case '/api/db/revisions':
        return Response.json([revision])
      case '/api/db/revision_sheet_evidence':
      case '/api/db/signatures':
      case '/api/db/signature_witness_requests':
      case '/api/db/workspace_settings':
        return Response.json([])
      case '/api/db/review_check_results':
        if (checksUnavailable) throw new Error('checks unavailable')

        return Response.json([])
      case '/api/db/rpc/is_workspace_writer':
        return Response.json(true)
      case '/api/db/rpc/workspace_signature_certifications':
        return Response.json(
          certifications.map((c) => ({
            user_id: c.userId,
            name: c.name,
            statement_version: c.statementVersion,
            certified_at: c.certifiedAt,
            revoked_at: c.revokedAt,
            identity_verified_at: c.identityVerifiedAt,
            identity_verified_by: c.identityVerifiedBy,
            verified_email: c.verifiedEmail,
            verification_requested: c.verificationRequested,
            auth_method: c.authMethod,
          })),
        )
      case '/api/db/rpc/run_revision_checks':
        return Response.json({})
      case '/api/db/rpc/sign_revision':
        return Response.json({ signatureId: 'sig1' })
      case '/api/signatures/step-up':
        return stepUpDenied
          ? Response.json(
              {
                message:
                  'Signing is locked for 15 minutes after three failed attempts.',
              },
              { status: 423 },
            )
          : Response.json({
              token: 'one-use-password-token',
              authMethod: 'password',
              expiresAt: '2026-10-04T14:00:00Z',
            })
      default:
        throw new Error(`Unexpected request: ${url.pathname}`)
    }
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

  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })

  return render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>{ui}</RouterContextProvider>
    </QueryClientProvider>,
  )
}

describe('SignNotebookDialog', () => {
  // R5-NOTE-02: the Notebook flow now renders the one shared ESignDialog. The
  // step-up and the sign_revision write are unchanged; this pins the shared
  // affordances (attestation statement + server time) onto the flow.
  it('renders the shared e-sign dialog affordances', async () => {
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
      await screen.findByText('Recorded as the time you sign'),
    ).toBeTruthy()
    expect(
      await screen.findByText(
        /internal attestation, not a regulatory compliance/,
      ),
    ).toBeTruthy()
  })

  it('focuses password and signs only after password step-up and matching confirmation', async () => {
    const user = userEvent.setup()
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
      expect(screen.getByLabelText('Type your name to confirm')).toBeTruthy()
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
      screen.getByLabelText('Type your name to confirm'),
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
      expect(transport).toHaveBeenCalledWith(
        '/api/db/rpc/sign_revision',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            p_submission_id: 'sub1',
            p_signature_meaning: 'reviewed',
            p_confirmation_phrase: 'Ada Lovelace',
            p_expected_revision_digest: 'abc123digest',
            p_signing_token: 'one-use-password-token',
          }),
        }),
      )
    })
    expect(transport).toHaveBeenCalledWith(
      '/api/signatures/step-up',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          workspaceId: 'ws1',
          password: 'local-signing-password',
          purpose: 'sign',
          submissionId: 'sub1',
          revisionDigest: 'abc123digest',
          signatureMeaning: 'reviewed',
        }),
      }),
    )
    expect(screen.getByLabelText('Signing password')).toHaveProperty(
      'value',
      '',
    )
  })

  it('invalidates record, blocks and review queries after a successful signature', async () => {
    const user = userEvent.setup()

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderWithQuery(
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
      expect(screen.getByLabelText('Type your name to confirm')).toBeTruthy()
    })
    await user.type(
      screen.getByLabelText('Type your name to confirm'),
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
    submission = { ...baseSubmission, state: 'submitted' }

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
    stepUpDenied = true
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
      screen.getByLabelText('Type your name to confirm'),
      'Ada Lovelace',
    )
    await user.click(screen.getByRole('button', { name: 'Sign' }))
    await screen.findByText(
      'Signing is locked for 15 minutes after three failed attempts.',
    )
    expect(transport.mock.calls.map(([url]) => url)).not.toContain(
      '/api/db/rpc/sign_revision',
    )
    expect(screen.getByLabelText('Signing password')).toHaveProperty(
      'value',
      '',
    )
  })

  function mockSignableSubmission() {
    submission = baseSubmission
    revision = baseRevision
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

  it('REV-03.4 shows the meaning, what is signed and the password re-entry requirement', async () => {
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
    // The signature is tied to the submitted version; the hash stays out of
    // the way, and the dialog still says what is being signed.
    expect(screen.getByText('The version submitted for review')).toBeTruthy()
    expect(screen.queryByText('abc123digest')).toBeNull()
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
      screen.getByLabelText('Type your name to confirm'),
      'Ada Lovelace',
    )
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(
        transport.mock.calls.filter(
          ([url]) => url === '/api/db/rpc/sign_revision',
        ),
      ).toHaveLength(1)
    })
    expect(transport).toHaveBeenCalledWith(
      '/api/signatures/step-up',
      expect.objectContaining({
        body: expect.stringContaining(
          '"password":"local-signing-password","purpose":"sign"',
        ),
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
    expect(transport.mock.calls.map(([url]) => url)).not.toContain(
      '/api/db/rpc/sign_revision',
    )
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

    renderWithQuery(
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
    certifications = [
      {
        ...certifiedCertification('u1'),
        statementVersion: null,
        certifiedAt: null,
        identityVerifiedAt: null,
        authMethod: null,
      },
    ]
    renderSignDialog()

    await screen.findByText(/Certification is required before you can sign/)
    expect(
      screen
        .getByRole('link', { name: 'Open signature settings' })
        .getAttribute('href'),
    ).toBe('/settings/account/signature?returnTo=%2F%3Freopen%3Dsign')
    // No password field and no Sign button: the attempt cannot be started.
    expect(screen.queryByLabelText('Signing password')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull()
    expect(transport.mock.calls.map(([url]) => url)).not.toContain(
      '/api/db/rpc/sign_revision',
    )
  })

  it('J-NBK-09 offers to run missing checks and links to the checks tab', async () => {
    mockSignableSubmission()
    checksUnavailable = false
    const user = userEvent.setup()
    renderSignDialog()

    await screen.findByText(/No checks have been run yet/)
    expect(
      screen.getByText(/author, a witness or an assigned reviewer/),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'Open the checks' })
        .getAttribute('href'),
    ).toBe('/review/rev1?tab=checks')
    await user.click(screen.getByRole('button', { name: 'Run checks' }))
    await waitFor(() =>
      expect(transport).toHaveBeenCalledWith(
        '/api/db/rpc/run_revision_checks',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"p_revision_id":"rev1"'),
        }),
      ),
    )
  })

  it('REV-03.3 does not treat a revoked certification as current before signing', async () => {
    mockSignableSubmission()
    certifications = [
      {
        ...certifiedCertification('u1'),
        revokedAt: '2026-10-05T09:00:00Z',
      },
    ]
    renderSignDialog()

    await screen.findByText(/Certification is required before you can sign/)
    expect(screen.queryByLabelText('Signing password')).toBeNull()
    expect(transport.mock.calls.map(([url]) => url)).not.toContain(
      '/api/db/rpc/sign_revision',
    )
  })
})
