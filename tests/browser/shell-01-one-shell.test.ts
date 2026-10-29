/**
 * R5-SHELL-01 — one shell on every product route.
 *
 * SHELL-01: there is one sidebar from tablet width up — the icon rail where
 * there is no room for the full navigation or where the person has minimised
 * it, the full sidebar otherwise. On a phone the same sidebar opens as a
 * drawer, with no bottom bar, so a route cannot show a third, width-specific
 * chrome. This checks a product route
 * renders the adopted shell at phone, laptop and desktop width and keeps its
 * section navigation, so a route cannot silently fall back to the legacy chrome
 * and lose its nav — and it pins the recorded internal reference route that
 * deliberately renders no product shell at all.
 *
 * The adopted shell's two navs both carry aria-label="Main" (the icon rail and
 * the desktop side nav), and exactly one of them is visible at any width. The
 * legacy shell's sidebar was an <aside aria-label="Application navigation">,
 * whose absence (and the product nav's absence on the reference route) is the
 * discriminator.
 */
import { test, expect } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

const user = '00000000-0000-4000-8000-000000000310'
// A project of the person's active workspace; the Projects area and its reads
// are scoped to that workspace, so a project of another one resolves to "not
// found" rather than rendering its tabs.
const project = '00000000-0000-4000-8000-000000000320'
const filesTab = `/projects/${project}/files`

const legacyShell = 'aside[aria-label="Application navigation"]'
const mainNavs = 'nav[aria-label="Main"]'
const sideNav = 'nav[aria-label="Main"].w-nav'
const iconRail = 'nav[aria-label="Main"].w-12'

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, user)
})

test('the project files tab keeps the icon rail at 1024', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto(filesTab)

  await expect(page.locator(legacyShell)).toHaveCount(0)
  // Below xl there is no room for the full sidebar, so the rail stands in.
  await expect(page.locator(iconRail)).toBeVisible()
  await expect(page.locator(sideNav)).toBeHidden()
  await expect(page.locator(`${mainNavs}:visible`)).toHaveCount(1)
})

test('the project files tab opens the sidebar as a drawer at 390', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(filesTab)

  await expect(page.locator(legacyShell)).toHaveCount(0)
  // A phone has no room for a rail, so the same sidebar opens from the header.
  await expect(page.locator(iconRail)).toBeHidden()
  await expect(page.locator(sideNav)).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const drawer = page.getByRole('dialog')
  // The same destinations the wide sidebar lists.
  for (const label of ['Home', 'Inbox', 'Projects', 'Settings']) {
    await expect(drawer.getByRole('link', { name: label })).toBeVisible()
  }
})

test('the project files tab keeps its section navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(filesTab)

  const sections = page.locator('nav[aria-label="Project sections"]')
  await expect(sections).toBeVisible()
  for (const label of [
    'Overview',
    'Milestones',
    'Folders',
    'Members',
    'Settings',
  ]) {
    await expect(sections.getByRole('link', { name: label })).toBeVisible()
  }
})

test('the recorded internal reference route renders no product shell', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto('/foundations')

  // Recorded exception (R5-SHELL-01): the legacy component gallery renders the
  // pre-port kit and is not in product nav, so neither shell is mounted for
  // it. The legacy chrome is gone, and the adopted shell keeps its navigation
  // off a route that would otherwise offer destinations it cannot reach.
  await expect(page.locator(legacyShell)).toHaveCount(0)
  await expect(page.locator(mainNavs)).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Visual rules and semantic tokens' }),
  ).toBeVisible()
})
