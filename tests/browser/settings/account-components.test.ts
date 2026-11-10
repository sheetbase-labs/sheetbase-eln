import { expect, test } from 'playwright/test'
import type { Page } from 'playwright/test'
import { z } from 'zod'
import { serverFixtures } from './transport'
import type { MySession } from '../../../src/components/settings/settings-sessions-data'
import type { TwoFactorStatus } from '../../../src/components/settings/settings-two-factor-data'

async function openComponent(page: Page, view: 'sessions' | 'two-factor' | 'notifications' | 'passkeys') {
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):3100\/\?token=/, (socket) =>
    socket.send(JSON.stringify({ type: 'connected' })),
  )
  await page.route('**/settings-component-fixture?*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><div id="root"></div>
    <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
    <script type="module" src="/@vite/client"></script>
    <script type="module" src="/tests/browser/settings/component-fixture.tsx"></script>
    </body></html>`,
    }),
  )
  await page.goto(`${view === 'passkeys' ? 'http://localhost:3100' : ''}/settings-component-fixture?view=${view}`)
}

const sessions: MySession[] = [
  {
    id: 's1',
    token: null,
    userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120.0',
    ipAddress: '10.0.0.1',
    createdAt: '2026-09-25T08:00:00Z',
    expiresAt: '2026-10-25T08:00:00Z',
    current: true,
  },
  {
    id: 's2',
    token: 't2',
    userAgent: 'Mozilla/5.0 (Windows) Firefox/121.0',
    ipAddress: '10.0.0.2',
    createdAt: '2026-09-24T08:00:00Z',
    expiresAt: '2026-10-24T08:00:00Z',
    current: false,
  },
]

test('sessions lists devices and offers sign-out only for another session', async ({
  page,
}) => {
  const transport = await serverFixtures(page, [
    {
      file: 'components/settings/settings-sessions-data.ts',
      name: 'listMySessionsFn',
      method: 'GET',
      result: sessions,
    },
  ])

  await openComponent(page, 'sessions')
  await expect(page.getByText(/Chrome · macOS/)).toBeVisible()
  await expect(page.getByText(/this device/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(1)
  expect(transport.calls.map((call) => call.name)).toEqual(['listMySessionsFn'])
  transport.assertExpected()
})

test('sessions reports a deployment session without an impossible sign-out', async ({
  page,
}) => {
  const transport = await serverFixtures(page, [
    {
      file: 'components/settings/settings-sessions-data.ts',
      name: 'listMySessionsFn',
      method: 'GET',
      result: [
        {
          id: 'dev-auth-free-session',
          token: null,
          userAgent: null,
          ipAddress: null,
          createdAt: '2026-09-25T08:00:00Z',
          expiresAt: '2026-09-25T08:30:00Z',
          current: true,
        },
      ],
    },
  ])

  await openComponent(page, 'sessions')
  await expect(page.getByText(/this device/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
  expect(transport.calls.map((call) => call.name)).toEqual(['listMySessionsFn'])
  transport.assertExpected()
})

const initialStatus: TwoFactorStatus = {
  available: true,
  enabled: false,
  needsPassword: false,
  emailLinkEnabled: true,
}

const enableSchema = z.strictObject({
  password: z.string(),
  method: z.literal('totp'),
})

const verifySchema = z.strictObject({ code: z.string() })
const disableSchema = z.strictObject({ password: z.string() })

async function twoFactor(
  page: Page,
  changes: Partial<TwoFactorStatus> = {},
  refusal = false,
) {
  const status: TwoFactorStatus = { ...initialStatus, ...changes }
  const enableCalls: z.infer<typeof enableSchema>[] = []
  const verifyCalls: z.infer<typeof verifySchema>[] = []
  const disableCalls: z.infer<typeof disableSchema>[] = []
  const unexpected: string[] = []
  await page.route('**/api/auth/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname

    if (request.method() !== 'POST') {
      unexpected.push(`${request.method()} ${path}`)
      await route.abort('blockedbyclient')

      return
    }

    switch (path) {
      case '/api/auth/two-factor/enable':
        enableCalls.push(enableSchema.parse(request.postDataJSON()))
        await route.fulfill({
          json: {
            method: 'totp',
            totpURI:
              'otpauth://totp/Sheetbase:a@b.test?secret=JBSWY3DPEHPK3PXP&issuer=Sheetbase',
            backupCodes: ['aaaa-bbbb', 'cccc-dddd'],
          },
        })

        return
      case '/api/auth/two-factor/verify-totp':
        verifyCalls.push(verifySchema.parse(request.postDataJSON()))

        if (refusal)
          await route.fulfill({
            status: 400,
            json: { code: 'INVALID_CODE', message: 'Invalid code' },
          })
        else {
          status.enabled = true
          await route.fulfill({ json: { status: true } })
        }

        return
      case '/api/auth/two-factor/disable':
        disableCalls.push(disableSchema.parse(request.postDataJSON()))
        status.enabled = false
        await route.fulfill({ json: { status: true } })

        return
      default:
        unexpected.push(`${request.method()} ${path}`)
        await route.abort('blockedbyclient')
    }
  })

  const transport = await serverFixtures(page, [
    {
      file: 'components/settings/settings-two-factor-data.ts',
      name: 'getTwoFactorStatusFn',
      method: 'GET',
      result: status,
    },
  ])

  await openComponent(page, 'two-factor')

  return {
    ...transport,
    enableCalls,
    verifyCalls,
    disableCalls,
    assertRequests: () => {
      transport.assertExpected()
      expect(unexpected).toEqual([])
    },
  }
}

test('two-factor explains an auth-free environment has nothing to protect', async ({
  page,
}) => {
  const transport = await twoFactor(page, { available: false })
  await expect(page.getByText(/Sign-in isn’t set up here/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /Set up/ })).toHaveCount(0)
  expect(transport.calls.map((call) => call.name)).toEqual([
    'getTwoFactorStatusFn',
  ])
  transport.assertRequests()
})

test('two-factor is off until a code is accepted and reveals backup codes once', async ({
  page,
}) => {
  const transport = await twoFactor(page)
  await page.getByRole('button', { name: 'Set up two-factor' }).click()
  await expect(
    page.getByText('JBSWY3DPEHPK3PXP', { exact: true }),
  ).toBeVisible()
  const qr = page.getByRole('img', { name: /QR code/i })
  await expect(qr).toBeVisible()
  await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/)
  await expect(page.getByText(/aaaa-bbbb/)).toHaveCount(0)
  await page.getByLabel('6-digit code').fill('123 456')
  await page.getByRole('button', { name: 'Turn on two-factor' }).click()
  await expect(page.getByText(/Save your backup codes now/)).toBeVisible()
  await expect(
    page.getByText('Two-factor is on for your account.', { exact: true }),
  ).toBeVisible()
  expect(transport.verifyCalls).toEqual([{ code: '123456' }])
  await expect(page.getByText(/aaaa-bbbb/)).toBeVisible()
  await page.getByRole('button', { name: /I’ve saved/ }).click()
  await expect(page.getByText(/aaaa-bbbb/)).toHaveCount(0)
  transport.assertRequests()
})

test('two-factor reports a refused code and stays in setup', async ({
  page,
}) => {
  const transport = await twoFactor(page, {}, true)
  await page.getByRole('button', { name: 'Set up two-factor' }).click()
  await page.getByLabel('6-digit code').fill('000000')
  await page.getByRole('button', { name: 'Turn on two-factor' }).click()
  await expect(page.getByRole('alert')).toContainText('Invalid code')
  await expect(page.getByText(/Two-factor is on/)).toHaveCount(0)
  await expect(page.getByLabel('6-digit code')).toBeVisible()
  expect(transport.verifyCalls).toEqual([{ code: '000000' }])
  transport.assertRequests()
})

test('two-factor asks for an existing signing password before setup', async ({
  page,
}) => {
  const transport = await twoFactor(page, { needsPassword: true })
  const start = page.getByRole('button', { name: 'Set up two-factor' })
  await expect(start).toBeDisabled()
  await page.getByLabel(/Signing password/).fill('pw')
  await start.click()
  await expect(page.getByLabel('6-digit code')).toBeVisible()
  expect(transport.enableCalls).toEqual([{ password: 'pw', method: 'totp' }])
  transport.assertRequests()
})

test('two-factor turns off an enabled account', async ({ page }) => {
  const transport = await twoFactor(page, { enabled: true })
  await page.getByRole('button', { name: 'Turn off two-factor' }).click()
  await expect(
    page.getByRole('button', { name: 'Set up two-factor' }),
  ).toBeVisible()
  expect(transport.disableCalls).toEqual([{ password: '' }])
  transport.assertRequests()
})

const preferenceSchema = z.strictObject({
  p_event_type: z.string(),
  p_in_app: z.boolean(),
  p_email: z.boolean(),
  p_digest: z.boolean(),
  p_push: z.boolean(),
})

const timingSchema = z.strictObject({
  p_quiet_start: z.string().nullable(),
  p_quiet_end: z.string().nullable(),
  p_digest_time: z.string().nullable(),
})

async function notifications(page: Page, configured = true, refusal = false) {
  const preferences = [
    { event_type: 'review_requested', in_app: true, email: true, digest: false, push: true },
    { event_type: 'material_expiring', in_app: true, email: true, digest: false, push: false },
  ]

  const timing = { quiet_hours_start: '22:00', quiet_hours_end: '07:00', digest_time: '08:00' }
  const writes: z.infer<typeof preferenceSchema>[] = []
  const timingWrites: z.infer<typeof timingSchema>[] = []
  const unexpected: string[] = []
  await page.route('**/api/db/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname

    if (request.method() === 'GET') {
      switch (path) {
        case '/api/db/notification_preferences':
          await route.fulfill({ json: preferences })

          return
        case '/api/db/user_preferences':
          await route.fulfill({ json: [timing] })

          return
      }
    }

    if (request.method() === 'POST') {
      switch (path) {
        case '/api/db/rpc/save_notification_preference': {
          const write = preferenceSchema.parse(request.postDataJSON())
          writes.push(write)
          const saved = preferences.find((row) => row.event_type === write.p_event_type)

          if (saved) Object.assign(saved, { in_app: write.p_in_app, email: write.p_email, digest: write.p_digest, push: write.p_push })
          await route.fulfill({ json: null })

          return
        }

        case '/api/db/rpc/set_notification_timing':
          timingWrites.push(timingSchema.parse(request.postDataJSON()))

          if (refusal) await route.fulfill({ status: 403, json: { error: { code: 'denied', message: 'Could not save the digest time.' } } })
          else await route.fulfill({ json: null })

          return
      }
    }

    unexpected.push(`${request.method()} ${path}`)
    await route.abort('blockedbyclient')
  })

  const transport = await serverFixtures(page, [{ file: 'lib/email-status.ts', name: 'fetchEmailStatusFn', method: 'GET', result: { configured } }])
  await openComponent(page, 'notifications')
  await expect(page.getByLabel('Digest time')).toHaveValue('08:00')

  return { writes, timingWrites, assertRequests: () => { transport.assertExpected(); expect(unexpected).toEqual([]); expect(transport.calls.map((call) => call.name)).toEqual(['fetchEmailStatusFn']) } }
}

test('notifications saves a changed preference and timing with visible confirmation', async ({ page }) => {
  const transport = await notifications(page)
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Review requested from you email', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Notification settings saved', { exact: true })).toBeVisible()
  expect(transport.writes).toEqual([{ p_event_type: 'review_requested', p_in_app: true, p_email: false, p_digest: false, p_push: true }])
  expect(transport.timingWrites).toEqual([{ p_quiet_start: '22:00', p_quiet_end: '07:00', p_digest_time: '08:00' }])
  transport.assertRequests()
})

test('notifications does not confirm a failed timing save', async ({ page }) => {
  const transport = await notifications(page, true, true)
  await page.getByRole('checkbox', { name: 'Review requested from you email', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Could not save the digest time.', { exact: true })).toBeVisible()
  await expect(page.getByText('Notification settings saved', { exact: true })).toHaveCount(0)
  transport.assertRequests()
})

test('notifications treats changed timing alone as unsaved work', async ({ page }) => {
  const transport = await notifications(page)
  await page.getByLabel('Quiet hours end').fill('06:30')
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
  expect(transport.writes).toEqual([])
  transport.assertRequests()
})

test('notifications writes only the changed row', async ({ page }) => {
  const transport = await notifications(page)
  await page.getByRole('checkbox', { name: 'Review requested from you email', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Notification settings saved', { exact: true })).toBeVisible()
  expect(transport.writes).toHaveLength(1)
  expect(transport.writes[0]?.p_event_type).toBe('review_requested')
  transport.assertRequests()
})

test('notifications groups every event including Inbox-only events', async ({ page }) => {
  const transport = await notifications(page)
  await expect(page.getByText('Reviews and signatures', { exact: true })).toBeVisible()
  await expect(page.getByText('Samples, materials and instruments', { exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'An instrument run fails email', exact: true })).toHaveAttribute('aria-checked', 'false')
  transport.assertRequests()
})

test('notifications allows digest for Inbox-only events', async ({ page }) => {
  const transport = await notifications(page)
  await expect(page.getByRole('checkbox', { name: 'An instrument run fails digest', exact: true })).toBeEnabled()
  transport.assertRequests()
})

test('notifications explains when email is not configured', async ({ page }) => {
  const transport = await notifications(page, false)
  await expect(page.getByText(/Email isn’t set up on this server yet/)).toBeVisible()
  transport.assertRequests()
})

const passkeyRegistrationSchema = z.object({
  name: z.string(),
  response: z.object({
    id: z.string(), rawId: z.string(), type: z.literal('public-key'),
    response: z.object({ clientDataJSON: z.string(), attestationObject: z.string() }),
  }),
})

const deletePasskeySchema = z.strictObject({ id: z.string() })

async function passkeys(page: Page, existing = false) {
  const unexpected: string[] = []
  // WebAuthn rejects IP relying-party domains. Keep a localhost document
  // origin while forwarding module requests to the existing IPv4 Vite server.
  await page.route('http://localhost:3100/**', async (route) => {
    const path = new URL(route.request().url()).pathname

    if (route.request().method() !== 'GET' || !['/@', '/src/', '/tests/browser/settings/', '/node_modules/'].some((prefix) => path.startsWith(prefix))) {
      unexpected.push(`${route.request().method()} ${path}`)
      await route.abort('blockedbyclient')

      return
    }

    const response = await route.fetch({ url: route.request().url().replace('http://localhost:3100', 'http://127.0.0.1:3100') })
    await route.fulfill({ response })
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
  let keys = existing ? [{ id: 'pk1', name: 'Phone', backedUp: true, createdAt: '2026-11-01T09:00:00Z' }] : []
  const registrations: z.infer<typeof passkeyRegistrationSchema>[] = []
  const removals: z.infer<typeof deletePasskeySchema>[] = []
  const optionNames: (string | null)[] = []
  await page.route('**/api/auth/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (request.method() === 'GET' && url.pathname === '/api/auth/passkey/list-user-passkeys') {
      await route.fulfill({ json: keys })

      return
    }

    if (request.method() === 'GET' && url.pathname === '/api/auth/passkey/generate-register-options') {
      optionNames.push(url.searchParams.get('name'))
      await route.fulfill({ json: {
        challenge: 'dGVzdC1jaGFsbGVuZ2UtMzItYnl0ZXMtc2V0dGluZ3M',
        rp: { name: 'Sheetbase' },
        user: { id: 'Zml4dHVyZS11c2Vy', name: 'fixture@example.test', displayName: 'Fixture user' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        timeout: 60000, attestation: 'none', excludeCredentials: [],
      } })

      return
    }

    if (request.method() === 'POST' && url.pathname === '/api/auth/passkey/verify-registration') {
      const registration = passkeyRegistrationSchema.parse(request.postDataJSON())
      registrations.push(registration)
      keys = [{ id: registration.response.id, name: registration.name, backedUp: false, createdAt: '2026-11-01T09:00:00Z' }]
      await route.fulfill({ json: keys[0] })

      return
    }

    if (request.method() === 'POST' && url.pathname === '/api/auth/passkey/delete-passkey') {
      const removal = deletePasskeySchema.parse(request.postDataJSON())
      removals.push(removal)
      keys = keys.filter((key) => key.id !== removal.id)
      await route.fulfill({ json: { status: true } })

      return
    }

    unexpected.push(`${request.method()} ${url.pathname}`)
    await route.abort('blockedbyclient')
  })
  await openComponent(page, 'passkeys')

  return { registrations, removals, optionNames, assertRequests: () => expect(unexpected).toEqual([]) }
}

test('passkeys explains an empty account', async ({ page }) => {
  const transport = await passkeys(page)
  await expect(page.getByText('You have not added a passkey yet.', { exact: true })).toBeVisible()
  transport.assertRequests()
})

test('passkeys creates a credential under the chosen name through native WebAuthn', async ({ page }) => {
  const transport = await passkeys(page)
  await page.getByPlaceholder('For example, Work laptop').fill('Work laptop')
  await page.getByRole('button', { name: 'Add a passkey' }).click()
  await expect(page.getByText('Work laptop', { exact: true })).toBeVisible()
  expect(transport.optionNames).toEqual(['Work laptop'])
  expect(transport.registrations).toHaveLength(1)
  expect(transport.registrations[0]?.name).toBe('Work laptop')
  const clientData = z.object({ type: z.literal('webauthn.create'), origin: z.literal('http://localhost:3100') }).parse(JSON.parse(Buffer.from(transport.registrations[0]?.response.response.clientDataJSON ?? '', 'base64url').toString('utf8')))
  expect(clientData.type).toBe('webauthn.create')
  transport.assertRequests()
})

test('passkeys lists a synced credential and removes it', async ({ page }) => {
  const transport = await passkeys(page, true)
  await expect(page.getByText('Phone', { exact: true })).toBeVisible()
  await expect(page.getByText('Synced across your devices', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByText('You have not added a passkey yet.', { exact: true })).toBeVisible()
  expect(transport.removals).toEqual([{ id: 'pk1' }])
  transport.assertRequests()
})
