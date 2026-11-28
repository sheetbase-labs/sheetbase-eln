/**
 * Role contrast — what a non-admin workspace member may see and do.
 *
 * The audit recorded "anything requiring a second identity (role contrast,
 * permission denial)" as untestable. The design seed carries a workspace member
 * (Priya S., `member`), and `tests/visual/sign-in.ts` signs in as her, so the
 * denial can be driven and read: the settings navigation that is not offered,
 * the control that is not rendered, the surfaces that state their refusal
 * instead of rendering a form.
 *
 * The refusal surfaces are asserted as text, not merely as absence: a surface
 * that keeps looking normal while its reads are refused is the harm here. An
 * admin chooses which roles open each settings section, and a member's own
 * default is the account sections only, so every workspace section refuses.
 */
import { expect, test } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

/** Priya S. — `member` of Process Development (see DESIGN_USER_IDS). */
const MEMBER = '00000000-0000-4000-8000-000000000311'

const ADMIN_SECTIONS = [
  'General',
  'Members and roles',
  'Project access',
  'Audit and retention',
  'Diagnostics',
  'Usage',
  'Instruments and parsers',
  'Integrations',
]

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signInAsDesignUser(page, MEMBER)
})

const REFUSAL = 'Your role can’t open this section'

test('the settings navigation offers a member no workspace administration', async ({
  page,
}) => {
  await page.goto('/settings/account/profile')
  const nav = page.getByRole('navigation', { name: 'Settings sections' })
  await expect(nav.getByRole('link', { name: 'Profile' })).toBeVisible()
  for (const label of ADMIN_SECTIONS) {
    await expect(
      nav.getByRole('link', { name: label }),
      `${label} is workspace administration`,
    ).toHaveCount(0)
  }
  // The member's own sections survive: the omission is role-aware, not a blank
  // settings rail.
  for (const label of ['API and SDK', 'Notifications']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible()
  }
})

test('the usage figures are refused with a reason, not rendered', async ({
  page,
}) => {
  await page.goto('/settings/workspace/usage')
  await expect(
    page.getByRole('heading', { name: REFUSAL, level: 2 }),
  ).toBeVisible()
  await expect(
    page.getByText('An admin chooses which roles can open each settings section.'),
  ).toBeVisible()
  // No figure of the admin surface is rendered alongside the refusal.
  await expect(page.getByText('Seats', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0)
})

test('workspace settings are not shown as an unsaveable form', async ({
  page,
}) => {
  await page.goto('/settings/workspace')
  await expect(
    page.getByRole('heading', {
      name: /Your role can’t open this section|Only admins can see workspace settings/,
      level: 2,
    }),
  ).toBeVisible()
  // The SET-01 RPCs refuse a non-admin, so the configuration must not be on
  // screen at all: not the fields, not the prefixes, not the save action.
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(
    0,
  )
  await expect(page.getByLabel('Time zone')).toHaveCount(0)
  await expect(page.getByText('Record IDs')).toHaveCount(0)
  // The refusal is not a dead end: it names the section the member does have.
  await expect(
    page.getByRole('button', { name: 'Open your profile settings' }),
  ).toBeVisible()
})

test('a member is offered no way to change the roster', async ({ page }) => {
  await page.goto('/settings/workspace/members')
  await expect(
    page.getByRole('heading', { name: REFUSAL, level: 2 }),
  ).toBeVisible()
  // Roles, invitations and suspension are owner/admin writes: the controls are
  // not rendered at all for a member.
  await expect(page.getByRole('table', { name: 'Members' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Invite people' })).toHaveCount(
    0,
  )
  await expect(page.getByRole('button', { name: 'Groups' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Manage / })).toHaveCount(0)
})
