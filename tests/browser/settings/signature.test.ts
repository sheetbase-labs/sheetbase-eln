import { expect, test } from 'playwright/test'
import { z } from 'zod'
import type { Page } from 'playwright/test'
import type { WorkspaceCertification } from '../../../src/lib/signature-certification'
import type { WorkspaceAdminContact } from '../../../src/lib/workspace-admins'
import { openSettings, serverFixtures } from './transport'

function certification(
  overrides: Partial<WorkspaceCertification> = {},
): WorkspaceCertification {
  return {
    userId: 'me',
    name: 'Ada Lovelace',
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

const verified = {
  identityVerifiedAt: '2026-10-04T12:00:00Z',
  identityVerifiedBy: 'admin',
  verifiedEmail: 'ada@sheetbase.test',
}

const current = {
  ...verified,
  certifiedAt: '2026-10-04T12:01:00Z',
  statementVersion: 1,
  authMethod: 'password',
}

const ownAdmin: WorkspaceAdminContact = {
  name: 'Ada Lovelace',
  email: 'ada@sheetbase.test',
  role: 'owner',
}

async function signature(
  page: Page,
  options: {
    certifications?: WorkspaceCertification[]
    admins?: WorkspaceAdminContact[]
    signInAvailable?: boolean
    regulated?: boolean
    credentialFailure?: string
    returnTo?: string
  } = {},
) {
  const calls: Array<{
    path: string
    body: z.infer<ReturnType<typeof z.json>>
  }> = []

  const unexpected: string[] = []
  await page.route('**/api/db/**', async (route) => {
    const path = new URL(route.request().url()).pathname

    if (path.endsWith('/workspace_signature_certifications')) {
      await route.fulfill({
        json: (options.certifications ?? [certification()]).map((entry) => ({
          user_id: entry.userId,
          name: entry.name,
          statement_version: entry.statementVersion,
          certified_at: entry.certifiedAt,
          revoked_at: entry.revokedAt,
          identity_verified_at: entry.identityVerifiedAt,
          identity_verified_by: entry.identityVerifiedBy,
          verified_email: entry.verifiedEmail,
          verification_requested: entry.verificationRequested,
          auth_method: entry.authMethod,
        })),
      })

      return
    }

    if (path.endsWith('/workspace_settings')) {
      await route.fulfill({
        json: [
          {
            regulated_lab: options.regulated ?? true,
            signature_policy: { reauth: 'batch' },
            signature_statement: null,
            signature_statement_version: 1,
          },
        ],
      })

      return
    }

    if (
      [
        'certify_signature',
        'practice_signature',
        'withdraw_signature_certification',
        'request_signature_identity_verification',
        'self_verify_signature_identity',
      ].some((name) => path === `/api/db/rpc/${name}`) &&
      route.request().method() === 'POST'
    ) {
      calls.push({ path, body: z.json().parse(route.request().postDataJSON()) })
      await route.fulfill({ json: null })

      return
    }

    unexpected.push(`${route.request().method()} ${path}`)
    await route.abort('blockedbyclient')
  })
  await page.route('**/api/signatures/step-up', async (route) => {
    const body = z.json().parse(route.request().postDataJSON())
    calls.push({ path: '/api/signatures/step-up', body })

    if (options.credentialFailure) {
      await route.fulfill({
        status: 503,
        json: { message: options.credentialFailure },
      })

      return
    }

    await route.fulfill({
      json: {
        token: 'fixture-signing-token',
        expiresAt: '2026-11-09T23:00:00Z',
        authMethod: 'password',
      },
    })
  })

  const transport = await serverFixtures(page, [
    {
      file: 'lib/workspace-admins.ts',
      name: 'getWorkspaceAdmins',
      method: 'GET',
      result: options.admins ?? [],
    },
    {
      file: 'routes/settings/account/signature.tsx',
      name: 'getSigningAvailability',
      method: 'GET',
      result: { signInAvailable: options.signInAvailable ?? true },
    },
  ])

  await openSettings(
    page,
    'signature',
    options.returnTo ? `&returnTo=${encodeURIComponent(options.returnTo)}` : '',
  )
  await expect(
    page.getByRole('heading', { name: 'Your signature', exact: true }),
  ).toBeVisible()

  return {
    calls,
    bodies: (path: string) =>
      calls.flatMap((call) => (call.path === path ? [call.body] : [])),
    assertExpected: () => {
      transport.assertExpected()
      expect(unexpected).toEqual([])
      expect(
        transport.calls.some((call) => call.name === 'getSigningAvailability'),
      ).toBe(true)
      expect(
        transport.calls.some((call) => call.name === 'getWorkspaceAdmins'),
      ).toBe(true)
    },
  }
}

const certify = (page: Page) =>
  page.getByRole('button', { name: 'Certify signature', exact: true })

const agree = (page: Page) =>
  page.getByRole('checkbox', {
    name: 'I have read and agree to this statement',
  })

const password = (page: Page) =>
  page.getByLabel(/Enter your signing password to certify/)

test('explains historical certification ineligibility without claiming the statement changed', async ({
  page,
}) => {
  const transport = await signature(page, {
    certifications: [
      certification({
        statementVersion: 1,
        certifiedAt: '2026-09-01T12:00:00Z',
        authMethod: 'session+name-confirmation',
      }),
    ],
  })

  await expect(
    page.getByText(/This certification is no longer eligible/),
  ).toBeVisible()
  await expect(page.getByText(/The statement changed/)).toHaveCount(0)
  await expect(certify(page)).toBeDisabled()
  transport.assertExpected()
})

test('requires independent verification rather than self-certification or batch signing', async ({
  page,
}) => {
  const transport = await signature(page, {
    certifications: [
      certification({ verificationRequested: true }),
      certification({
        userId: 'other',
        name: 'Other Member',
        verificationRequested: true,
      }),
    ],
  })

  await expect(
    page.getByText('Awaiting independent admin verification.'),
  ).toBeVisible()
  await expect(page.getByText('Verify Ada Lovelace independently')).toHaveCount(
    0,
  )
  await expect(page.getByText('Verify Other Member independently')).toHaveCount(
    0,
  )
  await expect(
    page.getByText('Password once per 15-minute signing session'),
  ).toHaveCount(0)
  await agree(page).check()
  await password(page).fill('fixture-password')
  await expect(
    page.getByText('Independent identity verification is required first'),
  ).toBeVisible()
  await expect(certify(page)).toBeDisabled()
  transport.assertExpected()
})

test('requires agreement and password after verification then clears the password', async ({
  page,
}) => {
  const transport = await signature(page, {
    certifications: [certification(verified)],
  })

  await expect(page.getByText(/Verified by a different admin/)).toBeVisible()
  await agree(page).check()
  await expect(certify(page)).toBeDisabled()
  await password(page).fill('fixture-password')
  await certify(page).click()
  await expect(password(page)).toHaveValue('')
  expect(transport.bodies('/api/signatures/step-up')).toEqual([
    { workspaceId: 'ws', purpose: 'certify', password: 'fixture-password' },
  ])
  await expect
    .poll(() => transport.bodies('/api/db/rpc/certify_signature'))
    .toEqual([
      {
        p_workspace_id: 'ws',
        p_statement_version: 1,
        p_signing_token: 'fixture-signing-token',
      },
    ])
  transport.assertExpected()
})

test('offers password-bound practice only for current verified certification', async ({
  page,
}) => {
  const transport = await signature(page, {
    certifications: [certification(current)],
  })

  await page.getByLabel(/^Signing password/).fill('practice-password')
  await page.getByRole('button', { name: 'Try a practice signature' }).click()
  await expect
    .poll(() => transport.bodies('/api/db/rpc/practice_signature'))
    .toEqual([{ p_signing_token: 'fixture-signing-token' }])
  expect(transport.bodies('/api/signatures/step-up')).toEqual([
    { workspaceId: 'ws', purpose: 'practice', password: 'practice-password' },
  ])
  await expect(
    page.getByText(/No real record signature is stored/),
  ).toBeVisible()
  expect(transport.bodies('/api/db/rpc/certify_signature')).toEqual([])
  transport.assertExpected()
})

test('shows failed secure delivery without a browser secret or credential write', async ({
  page,
}) => {
  const transport = await signature(page, {
    certifications: [certification(verified)],
    credentialFailure:
      'Secure email delivery failed. No credential was changed.',
  })

  await page.getByText('Set up or recover a local signing password').click()
  await page
    .getByRole('button', { name: 'Send one-use secret to verified email' })
    .click()
  await expect(
    page.getByText('Secure email delivery failed. No credential was changed.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.getByLabel('One-use email secret')).toHaveValue('')
  expect(transport.bodies('/api/signatures/step-up')).toEqual([
    { workspaceId: 'ws', purpose: 'enroll-request' },
  ])
  expect(transport.bodies('/api/db/rpc/certify_signature')).toEqual([])
  transport.assertExpected()
})

test('disables withdrawal when certification cannot be regained without sign-in', async ({
  page,
}) => {
  const transport = await signature(page, {
    signInAvailable: false,
    certifications: [certification(current)],
  })

  await expect(
    page.getByRole('button', { name: 'Try a practice signature' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Withdraw certification' }),
  ).toBeDisabled()
  await expect(
    page.getByText(/withdrawing it is unavailable here/),
  ).toBeVisible()
  expect(
    transport.bodies('/api/db/rpc/withdraw_signature_certification'),
  ).toEqual([])
  transport.assertExpected()
})

test('asks before withdrawing a certification that revokes signing eligibility', async ({
  page,
}) => {
  const transport = await signature(page, {
    certifications: [certification(current)],
  })

  await page.getByRole('button', { name: 'Withdraw certification' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  expect(
    transport.bodies('/api/db/rpc/withdraw_signature_certification'),
  ).toEqual([])
  await dialog.getByRole('button', { name: 'Withdraw certification' }).click()
  await expect
    .poll(() =>
      transport.bodies('/api/db/rpc/withdraw_signature_certification'),
    )
    .toEqual([{ p_workspace_id: 'ws' }])
  transport.assertExpected()
})

test('does not treat a revoked certification as current', async ({ page }) => {
  const transport = await signature(page, {
    certifications: [
      certification({
        ...current,
        certifiedAt: '2026-09-01T12:00:00Z',
        revokedAt: '2026-09-02T12:00:00Z',
        identityVerifiedAt: '2026-09-01T11:00:00Z',
      }),
    ],
  })

  await expect(page.getByText(/Verified by a different admin/)).toBeVisible()
  await expect(page.getByText('Not certified', { exact: true })).toBeVisible()
  await expect(page.getByText('Certified', { exact: true })).toHaveCount(0)
  await expect(
    page.getByText(/This certification is no longer eligible/),
  ).toBeVisible()
  await expect(certify(page)).toBeDisabled()
  await expect(page.getByText(/Certified 2026-09-01/)).toHaveCount(0)
  transport.assertExpected()
})

test('tells a sole owner a second administrator is needed and offers the invite', async ({
  page,
}) => {
  const transport = await signature(page, { admins: [ownAdmin] })
  await expect(page.getByText(/Nobody can verify you yet/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Invite another admin' }),
  ).toHaveAttribute('href', '/settings/workspace/members?invite=admin')
  transport.assertExpected()
})

test('names the administrators who can verify when there are some', async ({
  page,
}) => {
  const transport = await signature(page, {
    admins: [
      ownAdmin,
      { name: 'Grace Hopper', email: 'grace@sheetbase.test', role: 'admin' },
    ],
  })

  await expect(page.getByText(/Grace Hopper/)).toBeVisible()
  await expect(page.getByText(/Nobody can verify you yet/)).toHaveCount(0)
  transport.assertExpected()
})

test('offers no way back when nothing sent the person here', async ({
  page,
}) => {
  const transport = await signature(page)
  await expect(certify(page)).toBeVisible()
  await expect(page.getByText(/Back to/)).toHaveCount(0)
  transport.assertExpected()
})

test('names and links the task that was left while still uncertified', async ({
  page,
}) => {
  const transport = await signature(page, {
    returnTo: '/records/r1?reopen=submit',
  })

  await expect(page.getByText('You came here to certify')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Back to Submit' }),
  ).toHaveAttribute('href', '/records/r1?reopen=submit')
  transport.assertExpected()
})

test('says the task can go ahead once the signature is certified', async ({
  page,
}) => {
  const transport = await signature(page, {
    certifications: [certification(current)],
    returnTo: '/records/r1?reopen=sign',
  })

  await expect(page.getByText('You can sign now')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Back to Sign' }),
  ).toHaveAttribute('href', '/records/r1?reopen=sign')
  transport.assertExpected()
})

test('refuses external return paths and accepts local record paths', async ({
  page,
}) => {
  for (const returnTo of [
    'https://example.com',
    '//example.com',
    '/records/r1',
  ]) {
    const transport = await signature(page, { returnTo })

    if (returnTo === '/records/r1')
      await expect(
        page.getByRole('button', { name: /Back to/ }),
      ).toHaveAttribute('href', returnTo)
    else
      await expect(page.getByRole('button', { name: /Back to/ })).toHaveCount(0)
    transport.assertExpected()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('lets the only administrator confirm their identity in an unregulated lab', async ({
  page,
}) => {
  const transport = await signature(page, { regulated: false })
  await expect(
    page.getByText(/you can confirm your own identity/),
  ).toBeVisible()
  await expect(page.getByText(/Nobody can verify you yet/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Confirm it’s me' }).click()
  await expect
    .poll(() =>
      transport.bodies('/api/db/rpc/request_signature_identity_verification'),
    )
    .toEqual([{}])
  await expect
    .poll(() => transport.bodies('/api/db/rpc/self_verify_signature_identity'))
    .toEqual([{ p_email: 'ada@sheetbase.test' }])
  transport.assertExpected()
})

test('keeps asking a different admin in a regulated lab', async ({ page }) => {
  const transport = await signature(page)
  await expect(
    page.getByRole('button', { name: 'Request identity verification' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Confirm it’s me' }),
  ).toHaveCount(0)
  transport.assertExpected()
})
