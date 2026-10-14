import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceCertification } from '#/lib/signature-certification'
import { Route } from './signatures'

const mocks = vi.hoisted(() => {
  const certifications: WorkspaceCertification[] = []
  return {
    certifications,
    role: 'owner',
    signInAvailable: true,
    certify: vi.fn(),
    practice: vi.fn(),
    verify: vi.fn(),
    request: vi.fn(),
    credential: vi.fn(),
    withdraw: vi.fn(),
  }
})
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({
    options,
    useRouteContext: () => ({
      context: {
        user: { id: 'me', name: 'Ada Lovelace', email: 'ada@sheetbase.test' },
        workspace: { id: 'ws', name: 'Test workspace', role: mocks.role },
      },
    }),
    useLoaderData: () => ({ signInAvailable: mocks.signInAvailable }),
  }),
}))
vi.mock('#/lib/signature-certification', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceCertifications: async () => mocks.certifications,
  certifySignature: (...args: unknown[]) => mocks.certify(...args),
  practiceSignature: (...args: unknown[]) => mocks.practice(...args),
  verifySignatureIdentity: (...args: unknown[]) => mocks.verify(...args),
  requestIdentityVerification: () => mocks.request(),
  withdrawSignatureCertification: (...args: unknown[]) => mocks.withdraw(...args),
}))
vi.mock('#/lib/workspace-admin', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchWorkspaceSettings: async () => ({
    signaturePolicy: { reauth: 'batch' },
  }),
}))
vi.mock('#/lib/signatures', async (importOriginal) => ({
  ...(await importOriginal()),
  requestSignatureCredential: (...args: unknown[]) => mocks.credential(...args),
}))
vi.mock('#/components/v3/ui/sonner', () => ({ toast: vi.fn() }))

function certification(
  userId: string,
  name: string,
  overrides: Partial<WorkspaceCertification> = {},
): WorkspaceCertification {
  return {
    userId,
    name,
    statementVersion: null,
    certifiedAt: null,
    revokedAt: null,
    identityVerifiedAt: null,
    identityVerifiedBy: null,
    verifiedEmail: null,
    verificationRequested: false,
    authMethod: null,
    ...overrides,
  }
}
function renderRoute() {
  const Component = Route.options.component
  if (!Component) throw new Error('Signatures route component required')
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <Component />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.role = 'owner'
  mocks.signInAvailable = true
  mocks.certifications = [certification('me', 'Ada Lovelace')]
  for (const mutation of [
    mocks.certify,
    mocks.practice,
    mocks.verify,
    mocks.request,
    mocks.credential,
    mocks.withdraw,
  ])
    mutation.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('REV-03 signature settings', () => {
  it('explains historical certification ineligibility without claiming the statement changed', async () => {
    mocks.certifications = [
      certification('me', 'Ada Lovelace', {
        statementVersion: 1,
        certifiedAt: '2026-09-01T12:00:00Z',
        authMethod: 'session+name-confirmation',
      }),
    ]
    renderRoute()
    await screen.findByText(/This certification is no longer eligible/)
    expect(screen.queryByText(/The statement changed/)).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Certify signature' }),
    ).toHaveProperty('disabled', true)
  })

  it('shows independent verification rather than bootstrap/self-certification or batch signing', async () => {
    const user = userEvent.setup()
    mocks.certifications = [
      certification('me', 'Ada Lovelace', { verificationRequested: true }),
      certification('other', 'Other Member', { verificationRequested: true }),
    ]
    renderRoute()
    await screen.findByText('Awaiting independent administrator verification.')
    expect(screen.queryByText('Verify Ada Lovelace independently')).toBeNull()
    expect(screen.getByText('Verify Other Member independently')).toBeTruthy()
    expect(
      screen.queryByText('Password once per 15-minute signing session'),
    ).toBeNull()
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I have read and agree to this statement',
      }),
    )
    await user.type(
      screen.getByLabelText(/Enter your signing password to certify/),
      'fixture-password',
    )
    expect(
      screen.getByText('Independent identity verification is required first'),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Certify signature' }),
    ).toHaveProperty('disabled', true)
  })
  it('requires agreement and password after verification, then clears the password', async () => {
    const user = userEvent.setup()
    mocks.certifications = [
      certification('me', 'Ada Lovelace', {
        identityVerifiedAt: '2026-10-04T12:00:00Z',
        identityVerifiedBy: 'admin',
        verifiedEmail: 'ada@sheetbase.test',
      }),
    ]
    renderRoute()
    await screen.findByText(/Verified by a different administrator/)
    await user.click(
      screen.getByRole('checkbox', {
        name: 'I have read and agree to this statement',
      }),
    )
    expect(
      screen.getByRole('button', { name: 'Certify signature' }),
    ).toHaveProperty('disabled', true)
    await user.type(
      screen.getByLabelText(/Enter your signing password to certify/),
      'fixture-password',
    )
    await user.click(screen.getByRole('button', { name: 'Certify signature' }))
    await waitFor(() =>
      expect(mocks.certify).toHaveBeenCalledWith(
        expect.anything(),
        'ws',
        'fixture-password',
        1,
      ),
    )
    expect(
      screen.getByLabelText(/Enter your signing password to certify/),
    ).toHaveProperty('value', '')
  })
  it('offers password-bound practice only for current verified certification', async () => {
    const user = userEvent.setup()
    mocks.certifications = [
      certification('me', 'Ada Lovelace', {
        identityVerifiedAt: '2026-10-04T12:00:00Z',
        identityVerifiedBy: 'admin',
        verifiedEmail: 'ada@sheetbase.test',
        certifiedAt: '2026-10-04T12:01:00Z',
        statementVersion: 1,
        authMethod: 'password',
      }),
    ]
    renderRoute()
    await screen.findByRole('button', { name: 'Try a practice signature' })
    await user.type(
      screen.getByLabelText(/Signing password/),
      'practice-password',
    )
    await user.click(
      screen.getByRole('button', { name: 'Try a practice signature' }),
    )
    await waitFor(() =>
      expect(mocks.practice).toHaveBeenCalledWith(
        expect.anything(),
        'ws',
        'practice-password',
      ),
    )
    expect(screen.getByText(/No real record signature is stored/)).toBeTruthy()
    expect(mocks.certify).not.toHaveBeenCalled()
  })
  it('requires a deliberate independent email assertion from a different administrator', async () => {
    const user = userEvent.setup()
    mocks.role = 'admin'
    mocks.certifications = [
      certification('me', 'Ada Lovelace'),
      certification('other', 'Other Member', { verificationRequested: true }),
    ]
    renderRoute()
    await user.click(
      await screen.findByText('Verify Other Member independently'),
    )
    await user.type(
      screen.getByLabelText('Independently verified email'),
      'other@sheetbase.test',
    )
    expect(
      screen.getByRole('button', { name: 'Confirm verified identity' }),
    ).toHaveProperty('disabled', true)
    await user.click(
      screen.getByRole('checkbox', { name: /I have independently confirmed/ }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Confirm verified identity' }),
    )
    await waitFor(() =>
      expect(mocks.verify).toHaveBeenCalledWith(
        expect.anything(),
        'other',
        'other@sheetbase.test',
      ),
    )
  })
  it('shows failed secure delivery and never substitutes a browser secret or a credential write', async () => {
    const user = userEvent.setup()
    mocks.certifications = [
      certification('me', 'Ada Lovelace', {
        identityVerifiedAt: '2026-10-04T12:00:00Z',
        verifiedEmail: 'ada@sheetbase.test',
        identityVerifiedBy: 'admin',
      }),
    ]
    mocks.credential.mockRejectedValue(
      new Error('Secure email delivery failed. No credential was changed.'),
    )
    renderRoute()
    await screen.findByText(/Verified by a different administrator/)
    await user.click(
      screen.getByText('Set up or recover a local signing password'),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'Send one-use secret to verified email',
      }),
    )
    await screen.findByText(
      'Secure email delivery failed. No credential was changed.',
    )
    expect(screen.getByLabelText('One-use email secret')).toHaveProperty(
      'value',
      '',
    )
    expect(mocks.credential).toHaveBeenCalledWith({
      workspaceId: 'ws',
      purpose: 'enroll-request',
    })
    expect(mocks.certify).not.toHaveBeenCalled()
  })

  it('does not offer withdrawal when certification cannot be regained without sign-in', async () => {
    mocks.signInAvailable = false
    mocks.certifications = [
      certification('me', 'Ada Lovelace', {
        statementVersion: 1,
        certifiedAt: '2026-10-04T12:01:00Z',
        identityVerifiedAt: '2026-10-04T12:00:00Z',
        identityVerifiedBy: 'admin',
        verifiedEmail: 'ada@sheetbase.test',
        authMethod: 'password',
      }),
    ]
    renderRoute()

    await screen.findByRole('button', { name: 'Try a practice signature' })
    expect(
      screen.getByRole('button', { name: 'Withdraw certification' }),
    ).toHaveProperty('disabled', true)
    expect(screen.getByText(/withdrawing it is unavailable here/)).toBeTruthy()
    expect(mocks.withdraw).not.toHaveBeenCalled()
  })

  it('asks before withdrawing a certification, which revokes signing eligibility', async () => {
    const user = userEvent.setup()
    mocks.certifications = [
      certification('me', 'Ada Lovelace', {
        statementVersion: 1,
        certifiedAt: '2026-10-04T12:01:00Z',
        identityVerifiedAt: '2026-10-04T12:00:00Z',
        identityVerifiedBy: 'admin',
        verifiedEmail: 'ada@sheetbase.test',
        authMethod: 'password',
      }),
    ]
    renderRoute()

    await user.click(
      await screen.findByRole('button', { name: 'Withdraw certification' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(mocks.withdraw).not.toHaveBeenCalled()

    await user.click(
      within(dialog).getByRole('button', { name: 'Withdraw certification' }),
    )
    await waitFor(() =>
      expect(mocks.withdraw).toHaveBeenCalledWith(expect.anything(), 'ws'),
    )
  })

  it('REV-03.3 does not treat a revoked certification as current', async () => {
    mocks.certifications = [
      certification('me', 'Ada Lovelace', {
        statementVersion: 1,
        certifiedAt: '2026-09-01T12:00:00Z',
        revokedAt: '2026-09-02T12:00:00Z',
        identityVerifiedAt: '2026-09-01T11:00:00Z',
        identityVerifiedBy: 'admin',
        verifiedEmail: 'ada@sheetbase.test',
        authMethod: 'password',
      }),
    ]
    renderRoute()

    await screen.findByText(/Verified by a different administrator/)
    expect(screen.getByText('Not certified')).toBeTruthy()
    expect(screen.queryByText('Certified')).toBeNull()
    expect(
      screen.getByText(/This certification is no longer eligible/),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Certify signature' }),
    ).toHaveProperty('disabled', true)
    expect(screen.queryByText(/Certified 2026-09-01/)).toBeNull()
  })
})
