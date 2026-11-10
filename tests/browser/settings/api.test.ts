import { expect, test } from 'playwright/test'
import type { PersonalTokenWire } from '#/lib/personal-api-tokens'
import type { CredentialWire } from '#/lib/api-credential-admin'
import { openSettings, serverFixtures } from './transport'

const personal: PersonalTokenWire = {
  id: 'tok-1',
  workspaceId: 'ws',
  displayPrefix: 'sbp_1',
  name: 'Local Jupyter',
  scopes: ['projects:read'],
  createdAt: '2026-09-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
  createdByUserId: 'gareth',
}

const credential: CredentialWire = {
  ...personal,
  id: 'cred-1',
  kind: 'service',
  displayPrefix: 'sbs_1',
  name: 'Nightly import',
}

test('reports a refused personal-token revoke', async ({ page }) => {
  const transport = await serverFixtures(page, [
    {
      file: 'lib/personal-api-tokens.ts',
      name: 'listPersonalTokensFn',
      result: [personal],
    },
    {
      file: 'lib/api-credential-admin.ts',
      name: 'listApiCredentialsFn',
      result: [],
    },
    {
      file: 'lib/personal-api-tokens.ts',
      name: 'revokePersonalTokenFn',
      result: new Error('Revoking that token is not allowed.'),
    },
  ])

  await openSettings(page, 'api')
  await page
    .getByRole('table', { name: 'Personal tokens' })
    .getByRole('button', { name: 'Revoke' })
    .click()
  await page.getByRole('button', { name: 'Revoke token', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Revoking that token is not allowed.',
  )
  transport.assertExpected()
})

test('reports a refused service-credential rotate', async ({ page }) => {
  const transport = await serverFixtures(page, [
    {
      file: 'lib/personal-api-tokens.ts',
      name: 'listPersonalTokensFn',
      result: [],
    },
    {
      file: 'lib/api-credential-admin.ts',
      name: 'listApiCredentialsFn',
      result: [credential],
    },
    {
      file: 'lib/api-credential-admin.ts',
      name: 'rotateApiCredentialFn',
      result: new Error('Only an owner may rotate this credential.'),
    },
  ])

  await openSettings(page, 'api')
  await page.getByRole('tab', { name: /^Service/ }).click()
  await page
    .getByRole('table', { name: 'Workspace service credentials' })
    .getByRole('button', { name: 'Rotate' })
    .click()
  await page
    .getByRole('button', { name: 'Rotate credential', exact: true })
    .click()
  await expect(page.getByRole('alert')).toContainText(
    'Only an owner may rotate this credential.',
  )
  transport.assertExpected()
})
