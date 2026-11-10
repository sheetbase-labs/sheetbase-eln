import { expect, test } from 'playwright/test'
import { z } from 'zod'
import { openSettings, serverData, serverFixtures } from './transport'
import type { ServerFixture } from './transport'

const profileFile = 'components/settings/settings-profile-data.ts'

async function profile(
  page: Parameters<typeof openSettings>[0],
  failure?: Error,
) {
  const writes: Array<z.infer<typeof writeSchema>> = []
  await page.route('**/api/db/rpc/my_profile', (route) =>
    route.fulfill({ json: [{ initials: 'GP', job_title: '' }] }),
  )
  await page.route('**/api/db/rpc/set_user_profile', async (route) => {
    writes.push(writeSchema.parse(route.request().postDataJSON()))
    await route.fulfill({ json: null })
  })
  await page.route('**/api/auth/passkey/list-user-passkeys', (route) =>
    route.fulfill({ json: [] }),
  )

  const fixtures: ServerFixture[] = [
    {
      file: profileFile,
      name: 'updateProfileNameFn',
      result: failure ?? { name: 'Gareth P. QA3' },
    },
    {
      file: 'components/settings/settings-sessions-data.ts',
      name: 'listMySessionsFn',
      method: 'GET',
      result: [],
    },
    {
      file: 'components/settings/settings-two-factor-data.ts',
      name: 'getTwoFactorStatusFn',
      method: 'GET',
      result: {
        available: false,
        enabled: false,
        needsPassword: false,
        emailLinkEnabled: false,
      },
    },
  ]

  const transport = await serverFixtures(page, fixtures)
  await openSettings(page, 'profile')
  await expect(page.getByRole('textbox', { name: /Initials/ })).toHaveValue(
    'GP',
  )

  return { ...transport, writes }
}

const writeSchema = z.object({
  p_timezone: z.string().optional(),
  p_initials: z.string().nullable().optional(),
  p_job_title: z.string().nullable().optional(),
})

test('shows a read-only username and saves initials and job title', async ({
  page,
}) => {
  const transport = await profile(page)
  await expect(
    page.getByRole('textbox', { name: /Username/ }),
  ).toHaveJSProperty('readOnly', true)
  await page.getByRole('textbox', { name: /Job title/ }).fill('Chemist')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible()
  expect(transport.writes).toEqual([
    { p_initials: 'GP', p_job_title: 'Chemist' },
  ])
  transport.assertExpected()
})

test('saves the name and re-resolves the shell context', async ({ page }) => {
  const transport = await profile(page)
  await expect(page.locator('html')).toHaveAttribute('data-context-reads', '1')
  await page.getByRole('textbox', { name: /Full name/ }).fill('Gareth P. QA3')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible()

  const call = transport.calls.find(
    (entry) => entry.name === 'updateProfileNameFn',
  )

  if (!call) throw new Error('Name save required')
  expect(serverData(call.body)).toEqual({ name: 'Gareth P. QA3' })
  await expect(page.locator('html')).toHaveAttribute('data-context-reads', '2')
  transport.assertExpected()
})

test('states why a refused save did not happen without refreshing context', async ({
  page,
}) => {
  const transport = await profile(
    page,
    new Error('Your session has ended. Sign in again to change your name.'),
  )

  await page.getByRole('textbox', { name: /Full name/ }).fill('Gareth P. QA3')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(
    page.getByText('Couldn’t save your profile', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText(
      'Your session has ended. Sign in again to change your name.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-context-reads', '1')
  transport.assertExpected()
})

test('saves the time zone to the person’s own profile', async ({ page }) => {
  const transport = await profile(page)
  const zone = page.getByRole('combobox', { name: /Time zone/ })
  await expect(zone).toHaveValue('Europe/London')
  await zone.fill('America/New_York')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Changes saved', { exact: true })).toBeVisible()
  expect(transport.writes).toEqual([{ p_timezone: 'America/New_York' }])
  transport.assertExpected()
})

test('refuses a time zone name that does not exist', async ({ page }) => {
  const transport = await profile(page)
  await page.getByRole('combobox', { name: /Time zone/ }).fill('Mars/Olympus')
  await expect(page.getByText(/Use a time zone name such as/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Save changes' }),
  ).toBeDisabled()
  expect(transport.writes).toEqual([])
  expect(
    transport.calls.filter((call) => call.name === 'updateProfileNameFn'),
  ).toEqual([])
  transport.assertExpected()
})
