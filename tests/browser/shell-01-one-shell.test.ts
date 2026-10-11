/**
 * R5-SHELL-01 — one shell on every product route.
 *
 * The adopted (v3) shell shows its icon rail from 1024px and its bottom tabs
 * below 768px; the legacy shell shows neither. This checks a product route
 * renders the adopted shell at both widths, so a route cannot silently fall
 * back to the legacy chrome and lose its rail or its bottom tabs — and it pins
 * the recorded internal reference route that deliberately keeps the legacy
 * shell.
 *
 * The adopted shell's three navs all carry aria-label="Main" (the desktop side
 * nav, the icon rail and the phone bottom bar); the legacy shell's sidebar is
 * an <aside aria-label="Application navigation">, so its absence is the
 * discriminator.
 */
import { test, expect } from 'playwright/test'

import { signInAsDesignUser } from '../visual/sign-in'

const user = '00000000-0000-4000-8000-000000000310'
// The fixture workspace's own project; the design projects are not visible to
// the fixture user through RLS.
const project = '00000000-0000-4000-8000-000000000003'
const filesTab = `/projects/${project}/files`

const legacyShell = 'aside[aria-label="Application navigation"]'
const sideNav = 'nav[aria-label="Main"].w-nav'
const iconRail = 'nav[aria-label="Main"].w-12'
const bottomTabs = 'nav[aria-label="Main"].md\\:hidden'

test.beforeEach(async ({ page }) => {
  await signInAsDesignUser(page, user)
})

test('the project files tab keeps the icon rail at 1024', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto(filesTab)

  await expect(page.locator(legacyShell)).toHaveCount(0)
  // 1024 is lg: the icon rail stands in for the side nav.
  await expect(page.locator(iconRail)).toBeVisible()
  await expect(page.locator(sideNav)).toBeHidden()
  // The phone bottom bar is not shown at laptop width.
  await expect(page.locator(bottomTabs)).toBeHidden()
})

test('the project files tab keeps the bottom tabs at 390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(filesTab)

  await expect(page.locator(legacyShell)).toHaveCount(0)
  // The phone bottom bar holds Today/Scan/Inbox and the Menu sheet trigger.
  const tabs = page.locator(bottomTabs)
  await expect(tabs).toBeVisible()
  await expect(tabs.getByRole('link', { name: 'Scan' })).toBeVisible()
  await expect(tabs.getByRole('link', { name: 'Today' })).toBeVisible()
  await expect(tabs.getByRole('button', { name: 'Menu' })).toBeVisible()
  // The laptop rail is not shown at phone width.
  await expect(page.locator(iconRail)).toBeHidden()
})

test('the project files tab keeps its section navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(filesTab)

  const sections = page.locator('nav[aria-label="Sections"]')
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

test('the recorded internal reference route keeps the legacy shell', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.goto('/foundations')

  // Recorded exception (R5-SHELL-01): the legacy component gallery.
  await expect(page.locator(legacyShell)).toBeVisible()
  await expect(page.locator(iconRail)).toHaveCount(0)
})
