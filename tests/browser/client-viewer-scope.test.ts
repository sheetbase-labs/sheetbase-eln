/**
 * Role contrast — what a client account may see and do.
 *
 * ADR-0049 isolates a `client_viewer` from the internal read surface: the seed
 * carries two client accounts (Ana C. and Ben D., both `client_viewer` for
 * CL-017) and `tests/visual/sign-in.ts` signs in as one. This spec drives that
 * identity against the workspace administration surfaces, which the settings
 * navigation already omits for it, and asserts the refusals are stated rather
 * than a configuration form or an empty roster being rendered, plus the one
 * surface that is the client's own — the portal, whose access panel states the
 * client's limits.
 */
import { expect, test } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

/** Ana C. (CL-017) — `client_viewer` of Process Development (DESIGN_USER_IDS). */
const CLIENT = '00000000-0000-4000-8000-000000000316'

const ADMIN_SECTIONS = [
  'General',
  'Members and roles',
  'Electronic signatures',
  'Project access',
  'Audit and retention',
  'Diagnostics',
  'Usage',
  'Instruments and parsers',
  'Integrations',
]

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signInAsDesignUser(page, CLIENT)
})

test('the settings navigation offers a client account no workspace administration', async ({
  page,
}) => {
  await page.goto('/settings/profile')
  const nav = page.locator('nav[aria-label="Settings"]')
  await expect(nav.getByRole('link', { name: 'Profile' })).toBeVisible()
  for (const label of ADMIN_SECTIONS) {
    await expect(
      nav.getByRole('link', { name: label }),
      `${label} is workspace administration`,
    ).toHaveCount(0)
  }
  for (const label of ['API and SDK', 'Notifications']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible()
  }
})

test('the workspace configuration is refused, not shown to a client account', async ({
  page,
}) => {
  await page.goto('/settings')
  await expect(
    page.getByRole('heading', {
      name: 'Only admins can see workspace settings',
      level: 2,
    }),
  ).toBeVisible()
  // The CDMO's own configuration — name, time zone, display formats and the
  // identifier prefixes — must not be on the page at all.
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(
    0,
  )
  await expect(page.getByLabel('Time zone')).toHaveCount(0)
  await expect(page.getByText('Record IDs')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Open your profile settings' }),
  ).toHaveAttribute('href', '/settings/profile')
})

test('the members roster is refused instead of rendering as an empty list', async ({
  page,
}) => {
  await page.goto('/settings/members')
  await expect(
    page.getByRole('heading', {
      name: 'Only workspace members can see the roster',
      level: 2,
    }),
  ).toBeVisible()
  await expect(page.getByText('This is a client account.')).toBeVisible()
  // `workspace_members_list` returns nothing for a client account, so a rendered
  // roster would read "0" and claim the workspace has no members.
  await expect(page.getByRole('table', { name: 'Members' })).toHaveCount(0)
  await expect(page.getByText('Gareth P.')).toHaveCount(0)
  // The refusal offers the surface a client account does have. The kit renders
  // a link as a button, so the role is `button` and the href is the evidence.
  const portal = page.getByRole('button', { name: 'Open the client portal' })
  await expect(portal).toBeVisible()
  await expect(portal).toHaveAttribute('href', '/client-portal')
})

test('the usage figures are refused with a reason, not rendered', async ({
  page,
}) => {
  await page.goto('/settings/usage')
  await expect(
    page.getByRole('heading', {
      name: 'Only admins can see usage',
      level: 2,
    }),
  ).toBeVisible()
  await expect(page.getByText('Seats', { exact: true })).toHaveCount(0)
})

test('the portal is the client’s own surface and states its limits', async ({
  page,
}) => {
  await page.goto('/client-portal')

  // The access panel belongs to the account: a client sees its own role and
  // what it can and cannot do, not the internal "preview" framing.
  await expect(page.getByRole('heading', { name: 'Your access' })).toBeVisible()
  await expect(
    page.getByText('Read and download approved records, message the team'),
  ).toBeVisible()
  await expect(
    page.getByText('See drafts, raw data or other clients'),
  ).toBeVisible()
  await expect(page.getByText('Client view preview')).toHaveCount(0)

  // The records shared with CL-017 are the client's read surface — this is what
  // the identity can see, so the spec is not only about denials.
  await expect(page.getByText('EXP-0136')).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Open PDF' }).first(),
  ).toBeVisible()
})
