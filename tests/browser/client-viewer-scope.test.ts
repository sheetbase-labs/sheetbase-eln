/**
 * Role contrast — what a client account may see and do.
 *
 * ADR-0049 isolates a `client_viewer` from the internal read surface: the seed
 * carries two client accounts (Ana C. and Ben D., both `client_viewer` for
 * CL-017) and `tests/visual/sign-in.ts` signs in as one. This spec drives that
 * identity against the workspace administration surfaces, which the settings
 * navigation already omits for it, and asserts the portal stands in for them
 * rather than a configuration form or an empty roster being rendered, plus the one
 * surface that is the client's own — the portal, whose access panel states the
 * client's limits.
 */
import { expect, test } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

/** Ana C. (CL-017) — `client_viewer` of Process Development (DESIGN_USER_IDS). */
const CLIENT = '00000000-0000-4000-8000-000000000316'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signInAsDesignUser(page, CLIENT)
})

/**
 * A client account has one surface, the portal. Every internal page (settings,
 * the roster, usage) opens the portal instead of an admin form, a roster that
 * reads "0 members", or a settings rail.
 */
for (const path of [
  '/settings/account/profile',
  '/settings/workspace',
  '/settings/workspace/members',
  '/settings/workspace/usage',
]) {
  test(`${path} opens the client portal, not workspace administration`, async ({
    page,
  }) => {
    await page.goto(path)
    await expect(
      page.getByRole('heading', { name: 'Client portal', level: 1 }),
    ).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Portal' })).toBeVisible()
    // The portal's own content has loaded, so the checks below look at the
    // finished page rather than passing on one still loading.
    await expect(
      page.getByRole('heading', { name: 'Your access' }),
    ).toBeVisible()
    // None of the CDMO's configuration or roster is on the page.
    await expect(
      page.getByRole('navigation', { name: 'Settings sections' }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Save changes' }),
    ).toHaveCount(0)
    await expect(page.getByLabel('Time zone')).toHaveCount(0)
    await expect(page.getByRole('table', { name: 'Members' })).toHaveCount(0)
    // The portal names its CDMO lead (Gareth P.) on purpose; the roster's
    // other members are what must stay hidden.
    await expect(page.getByText('Priya S.')).toHaveCount(0)
    await expect(page.getByText('Mei L.')).toHaveCount(0)
    await expect(page.getByText('Seats', { exact: true })).toHaveCount(0)
  })
}

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
  await expect(page.getByText('EXP-0138')).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Open PDF' }).first(),
  ).toBeVisible()
})
